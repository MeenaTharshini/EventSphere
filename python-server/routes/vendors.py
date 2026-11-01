# python-server/routes/vendors.py

import re
from datetime import date, datetime, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)
from pymongo.errors import DuplicateKeyError, PyMongoError

from routes.auth import get_current_user


router = APIRouter(
    prefix="/api/vendors",
    tags=["Vendor Management"],
)


# ---------------------------------------------------------
# CONSTANTS
# ---------------------------------------------------------

VENDOR_CATEGORIES = {
    "Catering",
    "Photography",
    "Videography",
    "Decoration",
    "Entertainment",
    "音響",
    "Lighting",
    "Venue",
    "Transportation",
    "Security",
    "Other",
}

VENDOR_STATUSES = {"Pending", "Approved", "Rejected"}


# ---------------------------------------------------------
# REQUEST MODELS
# ---------------------------------------------------------

class VendorProfileCreate(BaseModel):
    """
    Request body used when a Vendor creates their profile.

    Approval status is intentionally not accepted from the client.
    New vendor profiles always start as Pending.
    """

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    business_name: str = Field(min_length=2, max_length=150)
    category: str = Field(min_length=1, max_length=50)
    contact_person: str = Field(min_length=2, max_length=100)
    email: str = Field(min_length=5, max_length=254)
    phone: str = Field(min_length=7, max_length=20)

    description: str = Field(default="", max_length=2000)
    city: str = Field(default="", max_length=100)
    state: str = Field(default="", max_length=100)
    country: str = Field(default="", max_length=100)
    address: str = Field(default="", max_length=300)

    services: list[str] = Field(
        default_factory=list,
        max_length=30,
    )

    price_from: float | None = Field(
        default=None,
        ge=0,
        allow_inf_nan=False,
    )

    website: str = Field(default="", max_length=300)

    @field_validator("business_name", "contact_person")
    @classmethod
    def validate_required_names(cls, value: str) -> str:
        value = value.strip()

        if not value or not any(char.isalpha() for char in value):
            raise ValueError("Enter a valid name.")

        return value

    @field_validator("category", mode="before")
    @classmethod
    def validate_category(cls, value) -> str:
        if not isinstance(value, str):
            raise ValueError("Select a valid vendor category.")

        allowed = {
            category.casefold(): category
            for category in VENDOR_CATEGORIES
        }

        normalized = value.strip().casefold()

        if normalized not in allowed:
            raise ValueError("Select a valid vendor category.")

        return allowed[normalized]

    @field_validator("email")
    @classmethod
    def validate_email(cls, value: str) -> str:
        value = value.strip().lower()

        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid email address.")

        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str) -> str:
        value = value.strip()

        if not re.fullmatch(r"[0-9+\-\s()]{7,20}", value):
            raise ValueError("Enter a valid phone number.")

        digits = len(re.sub(r"\D", "", value))

        if not 7 <= digits <= 15:
            raise ValueError("Enter a valid phone number.")

        return value

    @field_validator("services")
    @classmethod
    def validate_services(cls, value: list[str]) -> list[str]:
        cleaned = []

        for service in value:
            if not isinstance(service, str):
                raise ValueError(
                    "Every service must be a text value."
                )

            service = service.strip()

            if service:
                if len(service) > 100:
                    raise ValueError(
                        "Each service must be 100 characters or fewer."
                    )

                cleaned.append(service)

        return list(dict.fromkeys(cleaned))

    @field_validator("website")
    @classmethod
    def validate_website(cls, value: str) -> str:
        value = value.strip()

        if value and not re.match(
            r"^https?://",
            value,
            flags=re.IGNORECASE,
        ):
            value = f"https://{value}"

        return value


class VendorProfileUpdate(BaseModel):
    """
    Request body for updating an existing vendor profile.

    Fields are optional so the vendor can update only selected fields.
    Approval status and user_id cannot be changed here.
    """

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    business_name: str | None = Field(
        default=None,
        min_length=2,
        max_length=150,
    )

    category: str | None = Field(
        default=None,
        min_length=1,
        max_length=50,
    )

    contact_person: str | None = Field(
        default=None,
        min_length=2,
        max_length=100,
    )

    email: str | None = Field(
        default=None,
        min_length=5,
        max_length=254,
    )

    phone: str | None = Field(
        default=None,
        min_length=7,
        max_length=20,
    )

    description: str | None = Field(
        default=None,
        max_length=2000,
    )

    city: str | None = Field(
        default=None,
        max_length=100,
    )

    state: str | None = Field(
        default=None,
        max_length=100,
    )

    country: str | None = Field(
        default=None,
        max_length=100,
    )

    address: str | None = Field(
        default=None,
        max_length=300,
    )

    services: list[str] | None = Field(
        default=None,
        max_length=30,
    )

    price_from: float | None = Field(
        default=None,
        ge=0,
        allow_inf_nan=False,
    )

    website: str | None = Field(
        default=None,
        max_length=300,
    )

    @field_validator("business_name", "contact_person")
    @classmethod
    def validate_names(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return value

        value = value.strip()

        if not value or not any(char.isalpha() for char in value):
            raise ValueError("Enter a valid name.")

        return value

    @field_validator("category", mode="before")
    @classmethod
    def validate_category(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return value

        if not isinstance(value, str):
            raise ValueError("Select a valid vendor category.")

        allowed = {
            category.casefold(): category
            for category in VENDOR_CATEGORIES
        }

        normalized = value.strip().casefold()

        if normalized not in allowed:
            raise ValueError("Select a valid vendor category.")

        return allowed[normalized]

    @field_validator("email")
    @classmethod
    def validate_email(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return value

        value = value.strip().lower()

        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid email address.")

        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return value

        value = value.strip()

        if not re.fullmatch(r"[0-9+\-\s()]{7,20}", value):
            raise ValueError("Enter a valid phone number.")

        digits = len(re.sub(r"\D", "", value))

        if not 7 <= digits <= 15:
            raise ValueError("Enter a valid phone number.")

        return value

    @field_validator("services")
    @classmethod
    def validate_services(
        cls,
        value: list[str] | None,
    ) -> list[str] | None:
        if value is None:
            return value

        cleaned = []

        for service in value:
            if not isinstance(service, str):
                raise ValueError(
                    "Every service must be a text value."
                )

            service = service.strip()

            if service:
                if len(service) > 100:
                    raise ValueError(
                        "Each service must be 100 characters or fewer."
                    )

                cleaned.append(service)

        return list(dict.fromkeys(cleaned))

    @field_validator("website")
    @classmethod
    def validate_website(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return value

        value = value.strip()

        if value and not re.match(
            r"^https?://",
            value,
            flags=re.IGNORECASE,
        ):
            value = f"https://{value}"

        return value


class VendorApprovalRequest(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    status: Literal["Approved", "Rejected"]


# ---------------------------------------------------------
# DATABASE HELPERS
# ---------------------------------------------------------

def get_vendors_collection(request: Request):
    return request.app.state.db["vendors"]


def get_events_collection(request: Request):
    return request.app.state.db["events"]


def get_vendor_registrations_collection(request: Request):
    return request.app.state.db["vendor_event_registrations"]


# ---------------------------------------------------------
# AUTHORIZATION HELPERS
# ---------------------------------------------------------

def require_vendor(
    user: dict = Depends(get_current_user),
) -> dict:
    if user.get("role") != "Vendor":
        raise HTTPException(
            status_code=403,
            detail="Only vendor accounts can perform this action.",
        )

    return user


def require_approved_vendor_profile(
    request: Request,
    user: dict,
) -> dict:
    """
    Return the logged-in vendor's profile.

    Vendor event registration is allowed only for approved
    vendor profiles.
    """

    vendor = get_vendor_by_user_id(
        get_vendors_collection(request),
        str(user["_id"]),
    )

    if not vendor:
        raise HTTPException(
            status_code=404,
            detail="Vendor profile not found.",
        )

    if vendor.get("status") != "Approved":
        raise HTTPException(
            status_code=403,
            detail=(
                "Your vendor profile must be approved "
                "before registering for events."
            ),
        )

    return vendor


async def require_admin(
    current_user=Depends(get_current_user),
):
    if current_user.get("role") not in ["Admin", "Organizer"]:
        raise HTTPException(
            status_code=403,
            detail="Admin or Organizer access required.",
        )

    return current_user


# ---------------------------------------------------------
# SERIALIZATION HELPERS
# ---------------------------------------------------------

def serialize_vendor(vendor: dict) -> dict:
    result = dict(vendor)

    vendor_id = result.pop("_id", result.get("id"))

    result["id"] = (
        str(vendor_id)
        if vendor_id is not None
        else None
    )

    # Do not expose the internal user ID in public vendor responses.
    result.pop("user_id", None)

    for field in (
        "created_at",
        "updated_at",
        "approved_at",
    ):
        value = result.get(field)

        if isinstance(value, datetime):
            result[field] = value.isoformat()

    return result


def serialize_vendor_for_owner(vendor: dict) -> dict:
    result = serialize_vendor(vendor)

    # The owner can see their associated account ID.
    result["user_id"] = vendor.get("user_id")

    return result


def serialize_event_for_vendor(event: dict) -> dict:
    """
    Serialize event data for the vendor's assigned event list.
    """

    event_id = str(event.get("_id", event.get("id", "")))

    event_date = (
        event.get("event_date")
        or event.get("date")
        or ""
    )

    end_date = event.get("end_date") or event_date

    return {
        "id": event_id,
        "_id": event_id,
        "name": (
            event.get("name")
            or event.get("title")
            or event.get("event_name")
            or "Event"
        ),
        "event_type": (
            event.get("event_type")
            or event.get("type")
            or "Other"
        ),
        "event_date": str(event_date),
        "end_date": str(end_date),
        "date": str(event_date),
        "start_time": event.get("start_time") or "10:00",
        "end_time": event.get("end_time") or "16:00",
        "venue": (
            event.get("venue_name")
            or event.get("venue")
            or event.get("location")
            or ""
        ),
        "venue_name": (
            event.get("venue_name")
            or event.get("venue")
            or event.get("location")
            or ""
        ),
        "status": event.get("status") or "Scheduled",
        "organizer_id": str(event.get("organizer_id") or ""),
    }


def serialize_vendor_registration(registration: dict) -> dict:
    result = dict(registration)

    registration_id = result.pop(
        "_id",
        result.get("id"),
    )

    result["id"] = (
        str(registration_id)
        if registration_id is not None
        else None
    )

    for field in (
        "registered_at",
        "updated_at",
    ):
        value = result.get(field)

        if isinstance(value, datetime):
            result[field] = value.isoformat()

    for field in (
        "vendor_id",
        "event_id",
        "user_id",
    ):
        if result.get(field) is not None:
            result[field] = str(result[field])

    return result


# ---------------------------------------------------------
# VENDOR LOOKUP HELPERS
# ---------------------------------------------------------

def get_vendor_by_user_id(
    collection,
    user_id: str,
) -> dict | None:
    return collection.find_one(
        {"user_id": user_id}
    )


def get_vendor_or_404(
    collection,
    vendor_id: str,
) -> dict:
    if not ObjectId.is_valid(vendor_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid vendor ID.",
        )

    vendor = collection.find_one(
        {"_id": ObjectId(vendor_id)}
    )

    if not vendor:
        raise HTTPException(
            status_code=404,
            detail="Vendor not found.",
        )

    return vendor


def get_event_or_404(
    request: Request,
    event_id: str,
) -> dict:
    if not ObjectId.is_valid(event_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid event ID.",
        )

    event = get_events_collection(request).find_one(
        {"_id": ObjectId(event_id)}
    )

    if not event:
        raise HTTPException(
            status_code=404,
            detail="Event not found.",
        )

    return event


def normalize_id_list(values) -> list[str]:
    if not isinstance(values, (list, tuple, set)):
        return []

    result = []
    seen = set()

    for value in values:
        if value is None:
            continue

        normalized = str(value).strip()

        if normalized and normalized not in seen:
            seen.add(normalized)
            result.append(normalized)

    return result


def event_has_ended(event: dict) -> bool:
    """
    Determine whether the event has ended.

    Event dates in this application use YYYY-MM-DD.
    Event times use HH:MM.
    """

    event_date = (
        event.get("event_date")
        or event.get("date")
        or ""
    )

    end_date = event.get("end_date") or event_date
    end_time = event.get("end_time") or "16:00"

    try:
        event_end = datetime.strptime(
            f"{end_date} {end_time}",
            "%Y-%m-%d %H:%M",
        ).replace(tzinfo=timezone.utc)

    except (ValueError, TypeError):
        # Do not assume malformed legacy events are completed.
        return False

    return event_end <= datetime.now(timezone.utc)


def validate_event_for_vendor_registration(
    event: dict,
    vendor_id: str,
) -> None:
    """
    Validate that the event is available to this vendor.
    """

    assigned_vendor_ids = normalize_id_list(
        event.get("vendor_ids")
    )

    if vendor_id not in assigned_vendor_ids:
        raise HTTPException(
            status_code=403,
            detail=(
                "You are not assigned to this event. "
                "Only vendors assigned by the organizer can register."
            ),
        )

    event_status = str(
        event.get("status") or ""
    ).strip().casefold()

    if event_status in {"cancelled", "canceled"}:
        raise HTTPException(
            status_code=409,
            detail="Registration is unavailable for a cancelled event.",
        )

    if event_has_ended(event):
        raise HTTPException(
            status_code=409,
            detail="This event has already ended. Registration is closed.",
        )


# ---------------------------------------------------------
# CREATE VENDOR PROFILE
# POST /api/vendors/profile
# ---------------------------------------------------------

@router.post("/profile", status_code=201)
def create_vendor_profile(
    data: VendorProfileCreate,
    request: Request,
    user: dict = Depends(require_vendor),
):
    collection = get_vendors_collection(request)

    user_id = str(user["_id"])

    existing_vendor = get_vendor_by_user_id(
        collection,
        user_id,
    )

    if existing_vendor:
        raise HTTPException(
            status_code=409,
            detail=(
                "You already have a vendor profile. "
                "Use the update endpoint instead."
            ),
        )

    now = datetime.now(timezone.utc)

    vendor_data = data.model_dump()

    vendor_data.update({
        "user_id": user_id,
        "status": "Pending",
        "created_at": now,
        "updated_at": now,
        "approved_at": None,
        "rejection_reason": None,
    })

    try:
        result = collection.insert_one(vendor_data)

        created_vendor = collection.find_one(
            {"_id": result.inserted_id}
        )

        if not created_vendor:
            raise HTTPException(
                status_code=500,
                detail=(
                    "Vendor profile was created but "
                    "could not be retrieved."
                ),
            )

        return {
            "success": True,
            "message": (
                "Vendor profile submitted successfully. "
                "It is awaiting administrator approval."
            ),
            "vendor": serialize_vendor_for_owner(
                created_vendor
            ),
        }

    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail=(
                "A vendor profile already exists for this account."
            ),
        )

    except PyMongoError:
        raise HTTPException(
            status_code=500,
            detail="Unable to create vendor profile.",
        )


# ---------------------------------------------------------
# GET MY VENDOR PROFILE
# GET /api/vendors/profile/me
# ---------------------------------------------------------

@router.get("/profile/me")
def get_my_vendor_profile(
    request: Request,
    user: dict = Depends(require_vendor),
):
    collection = get_vendors_collection(request)

    vendor = get_vendor_by_user_id(
        collection,
        str(user["_id"]),
    )

    if not vendor:
        raise HTTPException(
            status_code=404,
            detail="Vendor profile not found.",
        )

    return {
        "success": True,
        "vendor": serialize_vendor_for_owner(vendor),
    }


# ---------------------------------------------------------
# UPDATE MY VENDOR PROFILE
# PUT /api/vendors/profile/me
# ---------------------------------------------------------

@router.put("/profile/me")
def update_my_vendor_profile(
    data: VendorProfileUpdate,
    request: Request,
    user: dict = Depends(require_vendor),
):
    collection = get_vendors_collection(request)

    vendor = get_vendor_by_user_id(
        collection,
        str(user["_id"]),
    )

    if not vendor:
        raise HTTPException(
            status_code=404,
            detail="Vendor profile not found.",
        )

    update_data = data.model_dump(
        exclude_unset=True,
        exclude_none=True,
    )

    if not update_data:
        raise HTTPException(
            status_code=400,
            detail="Provide at least one field to update.",
        )

    update_data["updated_at"] = datetime.now(timezone.utc)

    # Any profile edit after approval requires a fresh review.
    if vendor.get("status") == "Approved":
        update_data["status"] = "Pending"
        update_data["approved_at"] = None
        update_data["rejection_reason"] = None

    try:
        collection.update_one(
            {"_id": vendor["_id"]},
            {"$set": update_data},
        )

        updated_vendor = collection.find_one(
            {"_id": vendor["_id"]}
        )

        return {
            "success": True,
            "message": (
                "Vendor profile updated successfully. "
                "Changes may require administrator approval."
            ),
            "vendor": serialize_vendor_for_owner(
                updated_vendor
            ),
        }

    except PyMongoError:
        raise HTTPException(
            status_code=500,
            detail="Unable to update vendor profile.",
        )


# ---------------------------------------------------------
# VENDOR EVENT REGISTRATION
# ---------------------------------------------------------

# GET /api/vendors/events/assigned
#
# Returns events assigned to the logged-in vendor, including
# the vendor's registration status for each event.

@router.get("/events/assigned")
def get_assigned_vendor_events(
    request: Request,
    user: dict = Depends(require_vendor),
):
    vendor = require_approved_vendor_profile(
        request,
        user,
    )

    vendor_id = str(vendor["_id"])

    events_collection = get_events_collection(request)
    registrations_collection = (
        get_vendor_registrations_collection(request)
    )

    try:
        # Create a unique registration index.
        registrations_collection.create_index(
            [
                ("vendor_id", 1),
                ("event_id", 1),
            ],
            unique=True,
            name="unique_vendor_event_registration",
        )

        events = list(
            events_collection.find({
                "vendor_ids": vendor_id,
            }).sort(
                "event_date",
                1,
            )
        )

        registrations = list(
            registrations_collection.find({
                "vendor_id": vendor_id,
            })
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve assigned vendor events.",
        )

    registration_by_event = {
        str(registration.get("event_id")): registration
        for registration in registrations
    }

    result = []

    for event in events:
        event_id = str(event["_id"])

        registration = registration_by_event.get(event_id)

        event_data = serialize_event_for_vendor(event)

        event_data["registration"] = (
            serialize_vendor_registration(registration)
            if registration
            else None
        )

        event_data["registration_status"] = (
            registration.get("status")
            if registration
            else "Not Registered"
        )

        result.append(event_data)

    return {
        "success": True,
        "events": result,
        "count": len(result),
    }


# POST /api/vendors/events/{event_id}/register
#
# Registers the logged-in vendor for one assigned event.

@router.post(
    "/events/{event_id}/register",
    status_code=201,
)
def register_vendor_for_event(
    event_id: str,
    request: Request,
    user: dict = Depends(require_vendor),
):
    vendor = require_approved_vendor_profile(
        request,
        user,
    )

    vendor_id = str(vendor["_id"])
    user_id = str(user["_id"])

    event = get_event_or_404(
        request,
        event_id,
    )

    validate_event_for_vendor_registration(
        event,
        vendor_id,
    )

    registrations_collection = (
        get_vendor_registrations_collection(request)
    )

    try:
        # Enforce one registration per vendor/event pair.
        registrations_collection.create_index(
            [
                ("vendor_id", 1),
                ("event_id", 1),
            ],
            unique=True,
            name="unique_vendor_event_registration",
        )

        existing_registration = (
            registrations_collection.find_one({
                "vendor_id": vendor_id,
                "event_id": str(event["_id"]),
            })
        )

        if existing_registration:
            existing_status = str(
                existing_registration.get("status", "")
            ).strip().casefold()

            if existing_status == "registered":
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Your business is already registered "
                        "for this event."
                    ),
                )

            # A previously cancelled registration can be restored.
            registrations_collection.update_one(
                {"_id": existing_registration["_id"]},
                {
                    "$set": {
                        "status": "Registered",
                        "registered_at": datetime.now(timezone.utc),
                        "updated_at": datetime.now(timezone.utc),
                    },
                    "$unset": {
                        "cancelled_at": "",
                    },
                },
            )

            updated_registration = (
                registrations_collection.find_one({
                    "_id": existing_registration["_id"],
                })
            )

            return {
                "success": True,
                "message": (
                    "Your vendor registration has been restored."
                ),
                "registration": serialize_vendor_registration(
                    updated_registration
                ),
            }

        registration = {
            "vendor_id": vendor_id,
            "user_id": user_id,
            "event_id": str(event["_id"]),
            "event_name": (
                event.get("name")
                or event.get("title")
                or event.get("event_name")
                or "Event"
            ),
            "business_name": vendor.get("business_name", ""),
            "status": "Registered",
            "registered_at": datetime.now(timezone.utc),
            "updated_at": datetime.now(timezone.utc),
        }

        result = registrations_collection.insert_one(
            registration
        )

        saved_registration = (
            registrations_collection.find_one({
                "_id": result.inserted_id,
            })
        )

        return {
            "success": True,
            "message": (
                "Your business has successfully registered "
                "for this event."
            ),
            "registration": serialize_vendor_registration(
                saved_registration
            ),
        }

    except HTTPException:
        raise

    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail=(
                "Your business is already registered "
                "for this event."
            ),
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail=(
                "Unable to complete vendor registration. "
                "Please try again."
            ),
        )


# GET /api/vendors/events/registrations/me
#
# Returns all registrations belonging to the logged-in vendor.

@router.get("/events/registrations/me")
def get_my_vendor_event_registrations(
    request: Request,
    user: dict = Depends(require_vendor),
):
    vendor = require_approved_vendor_profile(
        request,
        user,
    )

    vendor_id = str(vendor["_id"])

    registrations_collection = (
        get_vendor_registrations_collection(request)
    )

    try:
        registrations = list(
            registrations_collection.find({
                "vendor_id": vendor_id,
            }).sort(
                "registered_at",
                -1,
            )
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve vendor registrations.",
        )

    return {
        "success": True,
        "registrations": [
            serialize_vendor_registration(registration)
            for registration in registrations
        ],
        "count": len(registrations),
    }


# ---------------------------------------------------------
# PUBLIC VENDOR DIRECTORY
# GET /api/vendors/
# ---------------------------------------------------------

@router.get("/")
def list_approved_vendors(
    request: Request,
    category: str | None = Query(
        default=None,
        max_length=50,
    ),
    city: str | None = Query(
        default=None,
        max_length=100,
    ),
    search: str | None = Query(
        default=None,
        max_length=150,
    ),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
):
    collection = get_vendors_collection(request)

    filters = {
        "status": "Approved",
    }

    if category:
        filters["category"] = category.strip()

    if city:
        filters["city"] = {
            "$regex": re.escape(city.strip()),
            "$options": "i",
        }

    if search:
        safe_search = re.escape(search.strip())

        filters["$or"] = [
            {
                "business_name": {
                    "$regex": safe_search,
                    "$options": "i",
                }
            },
            {
                "description": {
                    "$regex": safe_search,
                    "$options": "i",
                }
            },
            {
                "category": {
                    "$regex": safe_search,
                    "$options": "i",
                }
            },
            {
                "services": {
                    "$regex": safe_search,
                    "$options": "i",
                }
            },
        ]

    try:
        total = collection.count_documents(filters)

        vendors = collection.find(
            filters
        ).sort(
            "created_at",
            -1,
        ).skip(
            skip
        ).limit(
            limit
        )

        return {
            "success": True,
            "total": total,
            "skip": skip,
            "limit": limit,
            "vendors": [
                serialize_vendor(vendor)
                for vendor in vendors
            ],
        }

    except PyMongoError:
        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve vendors.",
        )


# ---------------------------------------------------------
# GET VENDOR DETAILS
# GET /api/vendors/{vendor_id}
# ---------------------------------------------------------

@router.get("/{vendor_id}")
def get_vendor_details(
    vendor_id: str,
    request: Request,
):
    collection = get_vendors_collection(request)

    vendor = get_vendor_or_404(
        collection,
        vendor_id,
    )

    # Public users can only see approved vendor profiles.
    if vendor.get("status") != "Approved":
        raise HTTPException(
            status_code=404,
            detail="Vendor not found.",
        )

    return {
        "success": True,
        "vendor": serialize_vendor(vendor),
    }


# ---------------------------------------------------------
# ADMIN: LIST VENDOR APPLICATIONS
# GET /api/vendors/admin/applications
# ---------------------------------------------------------

@router.get("/admin/applications")
def list_vendor_applications(
    request: Request,
    status: Literal[
        "Pending",
        "Approved",
        "Rejected",
    ] | None = Query(default=None),
    skip: int = Query(default=0, ge=0),
    limit: int = Query(default=20, ge=1, le=100),
    admin: dict = Depends(require_admin),
):
    collection = get_vendors_collection(request)

    filters = {}

    if status:
        filters["status"] = status

    try:
        total = collection.count_documents(filters)

        vendors = collection.find(
            filters
        ).sort(
            "created_at",
            -1,
        ).skip(
            skip
        ).limit(
            limit
        )

        return {
            "success": True,
            "total": total,
            "skip": skip,
            "limit": limit,
            "vendors": [
                serialize_vendor_for_owner(vendor)
                for vendor in vendors
            ],
        }

    except PyMongoError:
        raise HTTPException(
            status_code=500,
            detail="Unable to retrieve vendor applications.",
        )


# ---------------------------------------------------------
# ADMIN: APPROVE OR REJECT A VENDOR
# PUT /api/vendors/admin/{vendor_id}/approval
# ---------------------------------------------------------

@router.put("/admin/{vendor_id}/approval")
def update_vendor_approval(
    vendor_id: str,
    data: VendorApprovalRequest,
    request: Request,
    admin: dict = Depends(require_admin),
):
    collection = get_vendors_collection(request)

    vendor = get_vendor_or_404(
        collection,
        vendor_id,
    )

    now = datetime.now(timezone.utc)

    update_data = {
        "status": data.status,
        "updated_at": now,
        "approved_at": (
            now
            if data.status == "Approved"
            else None
        ),
        "rejection_reason": (
            None
            if data.status == "Approved"
            else "Application rejected by administrator."
        ),
    }

    try:
        collection.update_one(
            {"_id": vendor["_id"]},
            {"$set": update_data},
        )

        updated_vendor = collection.find_one(
            {"_id": vendor["_id"]}
        )

        return {
            "success": True,
            "message": (
                f"Vendor application {data.status.lower()} successfully."
            ),
            "vendor": serialize_vendor_for_owner(
                updated_vendor
            ),
        }

    except PyMongoError:
        raise HTTPException(
            status_code=500,
            detail="Unable to update vendor approval status.",
        )