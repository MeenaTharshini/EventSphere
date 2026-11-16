
import os
from datetime import datetime, timedelta, timezone
from typing import Literal

import bcrypt
import jwt

from bson import ObjectId

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Request,
)

from fastapi.security import (
    HTTPBearer,
    HTTPAuthorizationCredentials,
)

from pydantic import (
    BaseModel,
    ConfigDict,
    EmailStr,
    Field,
)

from pymongo.errors import DuplicateKeyError


# ---------------------------------------------------------
# ROUTER CONFIGURATION
# ---------------------------------------------------------

router = APIRouter(
    prefix="/api/auth",
    tags=["Authentication"],
)

JWT_ALGORITHM = "HS256"
JWT_EXPIRY_HOURS = 24

# Enables the Authorize button in Swagger UI.
bearer_scheme = HTTPBearer(auto_error=False)

# Public signup roles.
PublicRole = Literal["Organizer", "Vendor", "Attendee"]


# ---------------------------------------------------------
# REQUEST MODELS
# ---------------------------------------------------------

class RegisterRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
    )

    email: EmailStr

    password: str = Field(
        ...,
        min_length=8,
        max_length=128,
    )

    role: PublicRole


class LoginRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    email: EmailStr

    password: str = Field(
        ...,
        min_length=1,
        max_length=128,
    )


class AdminCreateRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)

    name: str = Field(
        ...,
        min_length=1,
        max_length=100,
    )

    email: EmailStr

    password: str = Field(
        ...,
        min_length=8,
        max_length=128,
    )


# ---------------------------------------------------------
# CONFIGURATION
# ---------------------------------------------------------

def get_jwt_secret() -> str:
    secret = os.getenv("JWT_SECRET")

    if not secret or len(secret) < 32:
        raise HTTPException(
            status_code=500,
            detail="Authentication configuration error.",
        )

    return secret


# ---------------------------------------------------------
# DATABASE HELPERS
# ---------------------------------------------------------

def get_users_collection(request: Request):
    return request.app.state.db["users"]


def normalize_role(role) -> str:
    return str(role or "").strip().lower()


def is_admin(user: dict) -> bool:
    return normalize_role(user.get("role")) in {
        "admin",
        "administrator",
    }


def serialize_user(user: dict) -> dict:
    return {
        "id": str(user["_id"]),
        "name": user.get("name", ""),
        "email": user.get("email", ""),
        "role": user.get("role", ""),
    }


# ---------------------------------------------------------
# PASSWORD HELPERS
# ---------------------------------------------------------

def hash_password(password: str) -> str:
    salt = bcrypt.gensalt(rounds=12)

    return bcrypt.hashpw(
        password.encode("utf-8"),
        salt,
    ).decode("utf-8")


def verify_password(
    password: str,
    password_hash: str,
) -> bool:

    if not isinstance(password_hash, str) or not password_hash:
        return False

    try:
        return bcrypt.checkpw(
            password.encode("utf-8"),
            password_hash.encode("utf-8"),
        )

    except (ValueError, TypeError, AttributeError):
        return False


# ---------------------------------------------------------
# JWT TOKEN CREATION
# ---------------------------------------------------------

def create_access_token(user: dict) -> str:
    now = datetime.now(timezone.utc)

    payload = {
        "id": str(user["_id"]),
        "role": user["role"],
        "iat": now,
        "exp": now + timedelta(hours=JWT_EXPIRY_HOURS),
    }

    return jwt.encode(
        payload,
        get_jwt_secret(),
        algorithm=JWT_ALGORITHM,
    )


# ---------------------------------------------------------
# AUTHENTICATION DEPENDENCY
# ---------------------------------------------------------

def get_current_user(
    request: Request,
    credentials: HTTPAuthorizationCredentials | None = Depends(
        bearer_scheme
    ),
) -> dict:

    # 1. Check Bearer token.

    if credentials is None:
        raise HTTPException(
            status_code=401,
            detail="Authentication required. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if credentials.scheme.lower() != "bearer":
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication scheme.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    token = credentials.credentials

    if not token.strip():
        raise HTTPException(
            status_code=401,
            detail="Authentication token is missing.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 2. Validate JWT.

    try:
        payload = jwt.decode(
            token,
            get_jwt_secret(),
            algorithms=[JWT_ALGORITHM],
            options={
                "require": ["exp", "iat", "id", "role"]
            },
        )

    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=401,
            detail="Token expired. Please log in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 3. Validate token fields.

    user_id = payload.get("id")
    token_role = payload.get("role")

    if (
        not isinstance(user_id, str)
        or not ObjectId.is_valid(user_id)
        or not isinstance(token_role, str)
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid authentication token.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 4. Retrieve user from MongoDB.

    try:
        user = get_users_collection(request).find_one(
            {"_id": ObjectId(user_id)}
        )

    except Exception:
        raise HTTPException(
            status_code=500,
            detail="Unable to verify the user account.",
        )

    if not user:
        raise HTTPException(
            status_code=401,
            detail="User not found. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    # 5. Ensure token role matches current database role.

    if user.get("role") != token_role:
        raise HTTPException(
            status_code=401,
            detail="User permissions have changed. Please sign in again.",
            headers={"WWW-Authenticate": "Bearer"},
        )

    return user


# ---------------------------------------------------------
# ADMIN AUTHORIZATION DEPENDENCY
# ---------------------------------------------------------

def get_current_admin(
    user: dict = Depends(get_current_user),
) -> dict:

    if not is_admin(user):
        raise HTTPException(
            status_code=403,
            detail="Administrator access required.",
        )

    return user


# ---------------------------------------------------------
# NORMAL USER REGISTRATION
# POST /api/auth/register
# ---------------------------------------------------------

@router.post(
    "/register",
    status_code=201,
)
def register(
    data: RegisterRequest,
    request: Request,
):

    users = get_users_collection(request)

    name = data.name.strip()
    email = str(data.email).strip().lower()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Name is required.",
        )

    # Check duplicate email.

    if users.find_one({"email": email}):
        raise HTTPException(
            status_code=409,
            detail="Email is already registered.",
        )

    user = {
        "name": name,
        "email": email,
        "password_hash": hash_password(data.password),
        "role": data.role,
        "created_at": datetime.now(timezone.utc),
    }

    try:
        users.insert_one(user)

    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="Email is already registered.",
        )

    return {
        "message": "Registration successful. You can now log in."
    }


# ---------------------------------------------------------
# NORMAL USER LOGIN
# POST /api/auth/login
# ---------------------------------------------------------

@router.post("/login")
def login(
    data: LoginRequest,
    request: Request,
):

    users = get_users_collection(request)

    email = str(data.email).strip().lower()

    user = users.find_one({
        "email": email
    })

    if not user or not verify_password(
        data.password,
        user.get("password_hash", ""),
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid email or password.",
        )

    # Admin accounts must use the separate Admin portal.

    if is_admin(user):
        raise HTTPException(
            status_code=403,
            detail="Please use the separate Admin login portal.",
        )

    token = create_access_token(user)

    return {
        "message": "Login successful",
        "token": token,
        "user": serialize_user(user),
    }


# ---------------------------------------------------------
# SEPARATE ADMIN LOGIN
# POST /api/auth/admin/login
# ---------------------------------------------------------

@router.post("/admin/login")
def admin_login(
    data: LoginRequest,
    request: Request,
):

    users = get_users_collection(request)

    email = str(data.email).strip().lower()

    user = users.find_one({
        "email": email
    })

    if not user or not verify_password(
        data.password,
        user.get("password_hash", ""),
    ):
        raise HTTPException(
            status_code=401,
            detail="Invalid Admin email or password.",
        )

    # Only actual Admin accounts can enter this portal.

    if not is_admin(user):
        raise HTTPException(
            status_code=403,
            detail="This account does not have Admin privileges.",
        )

    token = create_access_token(user)

    return {
        "message": "Admin login successful",
        "token": token,
        "user": serialize_user(user),
    }


# ---------------------------------------------------------
# CREATE ADDITIONAL ADMIN
# POST /api/auth/admin/create
# ADMIN ONLY
# ---------------------------------------------------------

@router.post(
    "/admin/create",
    status_code=201,
)
def create_admin(
    data: AdminCreateRequest,
    request: Request,
    current_admin: dict = Depends(get_current_admin),
):

    users = get_users_collection(request)

    name = data.name.strip()
    email = str(data.email).strip().lower()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Admin name is required.",
        )

    if users.find_one({"email": email}):
        raise HTTPException(
            status_code=409,
            detail="This email is already registered.",
        )

    admin_document = {
        "name": name,
        "email": email,
        "password_hash": hash_password(data.password),
        "role": "Admin",
        "created_at": datetime.now(timezone.utc),
        "created_by": str(current_admin["_id"]),
    }

    try:
        result = users.insert_one(admin_document)

    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="This email is already registered.",
        )

    admin_document["_id"] = result.inserted_id

    return {
        "message": "Admin account created successfully.",
        "user": serialize_user(admin_document),
    }


# ---------------------------------------------------------
# CURRENT AUTHENTICATED USER
# GET /api/auth/me
# ---------------------------------------------------------

@router.get("/me")
def get_me(
    user: dict = Depends(get_current_user),
):

    return {
        "user": serialize_user(user)
    }
