
# python-server/routes/vendors.py

import re
from datetime import datetime, timezone
from typing import Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo.errors import DuplicateKeyError, PyMongoError

from routes.auth import get_current_user
from .notifications import create_notification


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

ADMIN_ROLES = {
    "admin",
    "administrator",
    "organizer",
}


# ---------------------------------------------------------
# REQUEST MODELS
# ---------------------------------------------------------

class VendorProfileCreate(BaseModel):
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

    services: list[str] = Field(default_factory=list, max_length=30)

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
                raise ValueError("Every service must be a text value.")

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
    description: str | None = Field(default=None, max_length=2000)
    city: str | None = Field(default=None, max_length=100)
    state: str | None = Field(default=None, max_length=100)
    country: str | None = Field(default=None, max_length=100)
    address: str | None = Field(default=None, max_length=300)
    services: list[str] | None = Field(default=None, max_length=30)
    price_from: float | None = Field(
        default=None,
        ge=0,
        allow_inf_nan=False,
    )
    website: str | None = Field(default=None, max_length=300)

    @field_validator("business_name", "contact_person")
    @classmethod
    def validate_names(cls, value: str | None) -> str | None:
        if value is None:
            return value

        value = value.strip()

        if not value or not any(char.isalpha() for char in value):
            raise ValueError("Enter a valid name.")

        return value

    @field_validator("category", mode="before")
    @classmethod
    def validate_category(cls, value: str | None) -> str | None:
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
    def validate_email(cls, value: str | None) -> str | None:
        if value is None:
            return value

        value = value.strip().lower()

        if not re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", value):
            raise ValueError("Enter a valid email address.")

        return value

    @field_validator("phone")
    @classmethod
    def validate_phone(cls, value: str | None) -> str | None:
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
                raise ValueError("Every service must be a text value.")

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
    def validate_website(cls, value: str | None) -> str | None:
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
    rejection_reason: str | None = Field(default=None, max_length=500)

    @field_validator("rejection_reason")
    @classmethod
    def validate_rejection_reason(
        cls,
        value: str | None,
    ) -> str | None:
        if value is None:
            return None

        value = value.strip()
        return value or None


# ---------------------------------------------------------
# DATABASE HELPERS
# ---------------------------------------------------------

def get_vendors_collection(request: Request):
    return request.app.state.db["vendors"]


def get_events_collection(request: Request):
    return request.app.state.db["events"]


def get_vendor_registrations_collection(request: Request):
    return request.app.state.db["vendor_event_registrations"]


def get_user_id(user: dict) -> str:
    user_id = user.get("_id", user.get("id"))

    if user_id is None or not str(user_id).strip():
        raise HTTPException(
            status_code=401,
            detail="Unable to identify your account. Please log in again.",
        )

    return str(user_id)


# ---------------------------------------------------------
# NOTIFICATION HELPERS
# ---------------------------------------------------------

def send_vendor_notification(
    request,
    recipient_id,
    title,
    message,
    *,
    notification_type="info",
    category="vendor",
    related_id=None,
    related_type=None,
    metadata=None,
    dedupe_key=None,
):
    """Send a best-effort notification."""

    if not recipient_id:
        return

    try:
        create_notification(
            request.app.state.db,
            str(recipient_id),
            title,
            message,
            notification_type=notification_type,
            category=category,
            related_id=str(related_id) if related_id is not None else None,
            related_type=related_type,
            metadata=metadata or {},
            dedupe_key=dedupe_key,
        )
    except Exception:
        # A notification failure must never undo the main operation.
        return


def notify_admins_new_vendor_application(
    request,
    vendor: dict,
):
    db = request.app.state.db

    vendor_id = str(vendor.get("_id", ""))
    business_name = vendor.get("business_name") or "A vendor"
    category_name = vendor.get("category") or "Other"

    try:
        admins = db["users"].find(
            {
                "role": {
                    "$in": [
                        "Admin",
                        "admin",
                        "Administrator",
                        "administrator",
                    ]
                }
            },
            {"_id": 1},
        )

        for admin_user in admins:
            admin_id = admin_user.get("_id")

            if not admin_id:
                continue

            send_vendor_notification(
                request,
                str(admin_id),
                "New vendor application",
                (
                    f"{business_name} submitted a "
                    f"{category_name} vendor application for review."
                ),
                notification_type="info",
                category="vendor",
                related_id=vendor_id,
                related_type="vendor_application",
                metadata={
                    "vendor_id": vendor_id,
                    "business_name": business_name,
                    "category": category_name,
                    "status": "Pending",
                    "destination": "vendor-applications",
                },
                dedupe_key=f"vendor_application_submitted:{vendor_id}",
            )

    except PyMongoError:
        return


def notify_vendor_application_decision(
    request,
    vendor: dict,
    status: str,
    rejection_reason: str | None = None,
):
    vendor_id = str(vendor.get("_id", ""))
    business_name = vendor.get("business_name") or "Your vendor profile"

    if status == "Approved":
        title = "Vendor application approved"
        message = (
            f"Your vendor application for {business_name} has been approved. "
            "You can now access assigned event opportunities."
        )
        notification_kind = "success"
    else:
        title = "Vendor application rejected"
        reason = rejection_reason or "No additional reason was provided."

        message = (
            f"Your vendor application for {business_name} was rejected. "
            f"Reason: {reason}"
        )
        notification_kind = "warning"

    send_vendor_notification(
        request,
        vendor.get("user_id"),
        title,
        message,
        notification_type=notification_kind,
        category="vendor",
        related_id=vendor_id,
        related_type="vendor_application",
        metadata={
            "vendor_id": vendor_id,
            "business_name": business_name,
            "status": status,
            "rejection_reason": (
                rejection_reason if status == "Rejected" else None
            ),
            "destination": "vendor-profile",
        },
        dedupe_key=f"vendor_application_{status.lower()}:{vendor_id}",
    )


def notify_vendor_event_registration(
    request,
    registration: dict,
    restored: bool = False,
):
    event_name = registration.get("event_name") or "the event"
    business_name = registration.get("business_name") or "Your business"

    registration_id = str(registration.get("_id", ""))
    event_id = str(registration.get("event_id", ""))

    action = "restored" if restored else "confirmed"

    updated_at = registration.get("updated_at")

    if isinstance(updated_at, datetime):
        dedupe_timestamp = updated_at.isoformat()
    else:
        dedupe_timestamp = str(updated_at or "")

    send_vendor_notification(
        request,
        registration.get("user_id"),
        "Vendor registration confirmed",
        (
            f"{business_name}'s registration for {event_name} "
            f"has been {action}."
        ),
        notification_type="success",
        category="vendor",
        related_id=registration_id or event_id,
        related_type="vendor_event_registration",
        metadata={
            "registration_id": registration_id,
            "event_id": event_id,
            "event_name": event_name,
            "business_name": business_name,
            "status": "Registered",
            "destination": "vendor-events",
        },
        dedupe_key=(
            f"vendor_event_registration:{registration_id}:"
            f"{dedupe_timestamp}"
        ),
    )


# ---------------------------------------------------------
# AUTHORIZATION HELPERS
# ---------------------------------------------------------

def require_vendor(
    user: dict = Depends(get_current_user),
) -> dict:
    role = str(user.get("role", "")).strip().casefold()

    if role != "vendor":
        raise HTTPException(
            status_code=403,
            detail="Only vendor accounts can perform this action.",
        )

    return user


def require_admin(
    current_user=Depends(get_current_user),
):
    role = str(current_user.get("role", "")).strip().casefold()

    if role not in ADMIN_ROLES:
        raise HTTPException(
            status_code=403,
            detail="Admin or Organizer access required.",
        )

    return current_user


def require_approved_vendor_profile(
    request: Request,
    user: dict,
) -> dict:
    vendor = get_vendor_by_user_id(
        get_vendors_collection(request),
        get_user_id(user),
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


# ---------------------------------------------------------
# SERIALIZATION HELPERS
# ---------------------------------------------------------

def serialize_vendor(vendor: dict) -> dict:
    result = dict(vendor)

    vendor_id = result.pop("_id", result.get("id"))

    result["id"] = str(vendor_id) if vendor_id is not None else None

    # Never expose internal user IDs in public vendor responses.
    result.pop("user_id", None)

    for field in ("created_at", "updated_at", "approved_at"):
        value = result.get(field)

        if isinstance(value, datetime):
            result[field] = value.isoformat()

    return result


def serialize_vendor_for_owner(vendor: dict) -> dict:
    result = serialize_vendor(vendor)

    # Preserve the existing owner response structure.
    if vendor.get("user_id") is not None:
        result["user_id"] = str(vendor["user_id"])

    return result


def serialize_event_for_vendor(event: dict) -> dict:
    event_id = str(event.get("_id", event.get("id", "")))

    event_date = event.get("event_date") or event.get("date") or ""
    end_date = event.get("end_date") or event_date

    venue = (
        event.get("venue_name")
        or event.get("venue")
        or event.get("location")
        or ""
    )

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
        "venue": venue,
        "venue_name": venue,
        "status": event.get("status") or "Scheduled",
        "organizer_id": str(event.get("organizer_id") or ""),
    }


def serialize_vendor_registration(registration: dict | None) -> dict | None:
    if registration is None:
        return None

    result = dict(registration)

    registration_id = result.pop("_id", result.get("id"))

    result["id"] = (
        str(registration_id)
        if registration_id is not None
        else None
    )

    for field in ("registered_at", "updated_at", "cancelled_at"):
        value = result.get(field)

        if isinstance(value, datetime):
            result[field] = value.isoformat()

    for field in ("vendor_id", "event_id", "user_id"):
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
    return collection.find_one({"user_id": str(user_id)})


def get_vendor_or_404(
    collection,
    vendor_id: str,
) -> dict:
    if not ObjectId.is_valid(vendor_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid vendor ID.",
        )

    vendor = collection.find_one({"_id": ObjectId(vendor_id)})

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
    event_date = event.get("event_date") or event.get("date") or ""
    end_date = event.get("end_date") or event_date
    end_time = event.get("end_time") or "16:00"

    try:
        event_end = datetime.strptime(
            f"{end_date} {end_time}",
            "%Y-%m-%d %H:%M",
        ).replace(tzinfo=timezone.utc)
    except (ValueError, TypeError):
        return False

    return event_end <= datetime.now(timezone.utc)


def validate_event_for_vendor_registration(
    event: dict,
    vendor_id: str,
) -> None:
    assigned_vendor_ids = normalize_id_list(event.get("vendor_ids"))

    if vendor_id not in assigned_vendor_ids:
        raise HTTPException(
            status_code=403,
            detail=(
                "You are not assigned to this event. "
                "Only vendors assigned by the organizer can register."
            ),
        )

    event_status = str(event.get("status") or "").strip().casefold()

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
    user_id = get_user_id(user)

    existing_vendor = get_vendor_by_user_id(collection, user_id)

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
                detail="Vendor profile was created but could not be retrieved.",
            )

        notify_admins_new_vendor_application(request, created_vendor)

        return {
            "success": True,
            "message": (
                "Vendor profile submitted successfully. "
                "It is awaiting administrator approval."
            ),
            "vendor": serialize_vendor_for_owner(created_vendor),
        }

    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="A vendor profile already exists for this account.",
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
    vendor = get_vendor_by_user_id(
        get_vendors_collection(request),
        get_user_id(user),
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
        get_user_id(user),
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

    was_approved = vendor.get("status") == "Approved"

    if was_approved:
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

        if not updated_vendor:
            raise HTTPException(
                status_code=500,
                detail="Updated vendor profile could not be retrieved.",
            )

        # An approved vendor's edited profile needs a new review.
        if was_approved:
            notify_admins_new_vendor_application(
                request,
                updated_vendor,
            )

        return {
            "success": True,
            "message": (
                "Vendor profile updated successfully. "
                "Changes may require administrator approval."
            ),
            "vendor": serialize_vendor_for_owner(updated_vendor),
        }

    except PyMongoError:
        raise HTTPException(
            status_code=500,
            detail="Unable to update vendor profile.",
        )


# ---------------------------------------------------------
# GET ASSIGNED VENDOR EVENTS
# GET /api/vendors/events/assigned
# ---------------------------------------------------------

@router.get("/events/assigned")
def get_assigned_vendor_events(
    request: Request,
    user: dict = Depends(require_vendor),
):
    vendor = require_approved_vendor_profile(request, user)

    vendor_id = str(vendor["_id"])

    events_collection = get_events_collection(request)
    registrations_collection = get_vendor_registrations_collection(request)

    try:
        registrations_collection.create_index(
            [("vendor_id", 1), ("event_id", 1)],
            unique=True,
            name="unique_vendor_event_registration",
        )

        events = list(
            events_collection.find({
                "vendor_ids": vendor_id,
            }).sort("event_date", 1)
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

        event_data["registration"] = serialize_vendor_registration(
            registration
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


# ---------------------------------------------------------
# REGISTER VENDOR FOR EVENT
# POST /api/vendors/events/{event_id}/register
# ---------------------------------------------------------

@router.post("/events/{event_id}/register", status_code=201)
def register_vendor_for_event(
    event_id: str,
    request: Request,
    user: dict = Depends(require_vendor),
):
    vendor = require_approved_vendor_profile(request, user)

    vendor_id = str(vendor["_id"])
    user_id = get_user_id(user)

    event = get_event_or_404(request, event_id)

    validate_event_for_vendor_registration(event, vendor_id)

    registrations_collection = get_vendor_registrations_collection(request)

    try:
        registrations_collection.create_index(
            [("vendor_id", 1), ("event_id", 1)],
            unique=True,
            name="unique_vendor_event_registration",
        )

        event_id_string = str(event["_id"])

        existing_registration = registrations_collection.find_one({
            "vendor_id": vendor_id,
            "event_id": event_id_string,
        })

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

            now = datetime.now(timezone.utc)

            registrations_collection.update_one(
                {"_id": existing_registration["_id"]},
                {
                    "$set": {
                        "status": "Registered",
                        "registered_at": now,
                        "updated_at": now,
                    },
                    "$unset": {
                        "cancelled_at": "",
                    },
                },
            )

            updated_registration = registrations_collection.find_one({
                "_id": existing_registration["_id"],
            })

            if not updated_registration:
                raise HTTPException(
                    status_code=500,
                    detail="Registration was restored but could not be retrieved.",
                )

            notify_vendor_event_registration(
                request,
                updated_registration,
                restored=True,
            )

            return {
                "success": True,
                "message": "Your vendor registration has been restored.",
                "registration": serialize_vendor_registration(
                    updated_registration
                ),
            }

        now = datetime.now(timezone.utc)

        registration = {
            "vendor_id": vendor_id,
            "user_id": user_id,
            "event_id": event_id_string,
            "event_name": (
                event.get("name")
                or event.get("title")
                or event.get("event_name")
                or "Event"
            ),
            "business_name": vendor.get("business_name", ""),
            "status": "Registered",
            "registered_at": now,
            "updated_at": now,
        }

        result = registrations_collection.insert_one(registration)

        saved_registration = registrations_collection.find_one({
            "_id": result.inserted_id,
        })

        if not saved_registration:
            raise HTTPException(
                status_code=500,
                detail="Registration was created but could not be retrieved.",
            )

        notify_vendor_event_registration(
            request,
            saved_registration,
            restored=False,
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


# ---------------------------------------------------------
# GET MY VENDOR EVENT REGISTRATIONS
# GET /api/vendors/events/registrations/me
# ---------------------------------------------------------

@router.get("/events/registrations/me")
def get_my_vendor_event_registrations(
    request: Request,
    user: dict = Depends(require_vendor),
):
    vendor = require_approved_vendor_profile(request, user)

    vendor_id = str(vendor["_id"])
    registrations_collection = get_vendor_registrations_collection(request)

    try:
        registrations = list(
            registrations_collection.find({
                "vendor_id": vendor_id,
            }).sort("registered_at", -1)
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
    category: str | None = Query(default=None, max_length=50),
    city: str | None = Query(default=None, max_length=100),
    search: str | None = Query(default=None, max_length=150),
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

    vendor = get_vendor_or_404(collection, vendor_id)

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

    vendor = get_vendor_or_404(collection, vendor_id)

    previous_status = vendor.get("status")
    now = datetime.now(timezone.utc)

    rejection_reason = (
        None
        if data.status == "Approved"
        else (
            data.rejection_reason
            or "Application rejected by administrator."
        )
    )

    update_data = {
        "status": data.status,
        "updated_at": now,
        "approved_at": now if data.status == "Approved" else None,
        "rejection_reason": rejection_reason,
    }

    try:
        collection.update_one(
            {"_id": vendor["_id"]},
            {"$set": update_data},
        )

        updated_vendor = collection.find_one(
            {"_id": vendor["_id"]}
        )

        if not updated_vendor:
            raise HTTPException(
                status_code=500,
                detail="Updated vendor application could not be retrieved.",
            )

        # Only notify when the status actually changes.
        # This prevents repeated clicks from generating duplicate decisions.
        if previous_status != data.status:
            notify_vendor_application_decision(
                request,
                updated_vendor,
                data.status,
                rejection_reason,
            )

        return {
            "success": True,
            "message": (
                f"Vendor application {data.status.lower()} successfully."
            ),
            "vendor": serialize_vendor_for_owner(updated_vendor),
        }

    except PyMongoError:
        raise HTTPException(
            status_code=500,
            detail="Unable to update vendor approval status.",
        )
