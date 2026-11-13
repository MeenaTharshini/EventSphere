from datetime import datetime, timezone
from typing import Literal, Optional
import re

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, ConfigDict, Field, EmailStr, field_validator

from routes.auth import get_current_user


router = APIRouter(
    prefix="/api/sponsorships",
    tags=["Sponsorships"],
)


# =========================================================
# CONSTANTS
# =========================================================

SponsorshipTier = Literal[
    "Title",
    "Platinum",
    "Gold",
    "Silver",
    "Bronze",
    "Custom",
]

SponsorshipStatus = Literal[
    "Pending",
    "Confirmed",
    "Partially Paid",
    "Paid",
    "Cancelled",
]


# =========================================================
# REQUEST MODEL
# =========================================================

class SponsorshipInput(BaseModel):
    """
    Used for creating and updating sponsorship records.
    """

    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="ignore",
    )

    event_id: str = Field(
        ...,
        min_length=1,
        max_length=100,
    )

    sponsor_name: str = Field(
        ...,
        min_length=2,
        max_length=150,
    )

    contact_name: str = Field(
        default="",
        max_length=100,
    )

    contact_email: Optional[EmailStr] = None

    contact_phone: str = Field(
        default="",
        max_length=30,
    )

    tier: SponsorshipTier = "Custom"

    pledged_amount: float = Field(
        ...,
        gt=0,
        allow_inf_nan=False,
    )

    amount_received: float = Field(
        default=0,
        ge=0,
        allow_inf_nan=False,
    )

    status: SponsorshipStatus = "Pending"

    benefits: str = Field(
        default="",
        max_length=2000,
    )

    notes: str = Field(
        default="",
        max_length=2000,
    )

    @field_validator("event_id")
    @classmethod
    def validate_event_id(cls, value: str) -> str:
        value = value.strip()

        if not ObjectId.is_valid(value):
            raise ValueError("Invalid event ID.")

        return value

    @field_validator(
        "sponsor_name",
        "contact_name",
        "contact_phone",
        "benefits",
        "notes",
    )
    @classmethod
    def normalize_text_fields(cls, value: str) -> str:
        return value.strip()

    @field_validator("contact_email")
    @classmethod
    def normalize_email(
        cls,
        value: Optional[str],
    ) -> Optional[str]:
        if value is None:
            return None

        value = value.strip().lower()

        return value or None


# =========================================================
# DATABASE HELPERS
# =========================================================

def get_sponsorships_collection(request: Request):
    return request.app.state.db["sponsorships"]


def get_events_collection(request: Request):
    return request.app.state.db["events"]


# =========================================================
# AUTHORIZATION HELPERS
# =========================================================

def get_user_id(user: dict) -> str:
    value = user.get("_id", user.get("id"))

    if value is None:
        raise HTTPException(
            status_code=401,
            detail="Unable to identify the logged-in user.",
        )

    return str(value)


def get_role(user: dict) -> str:
    return str(
        user.get("role", "")
    ).strip().lower()


def require_manager(user: dict) -> None:
    if get_role(user) not in (
        "admin",
        "administrator",
        "organizer",
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Only organizers and administrators "
                "can manage sponsorships."
            ),
        )


def get_event_owner_id(event: dict) -> Optional[str]:
    owner = event.get("organizer_id")

    if isinstance(owner, dict):
        owner = owner.get(
            "_id",
            owner.get("id"),
        )

    return str(owner) if owner is not None else None


def check_event_access(
    user: dict,
    event: dict,
) -> None:
    """
    Admins can manage sponsorships for every event.

    Organizers can manage sponsorships only for events
    that belong to their account.
    """

    role = get_role(user)

    if role in ("admin", "administrator"):
        return

    if role != "organizer":
        raise HTTPException(
            status_code=403,
            detail="Organizer or Admin access required.",
        )

    event_owner_id = get_event_owner_id(event)

    if event_owner_id != get_user_id(user):
        raise HTTPException(
            status_code=403,
            detail=(
                "You can only manage sponsorships "
                "for your own events."
            ),
        )


# =========================================================
# EVENT HELPERS
# =========================================================

def get_event(
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


def get_event_name(event: dict) -> str:
    return (
        event.get("name")
        or event.get("title")
        or event.get("event_name")
        or "Untitled event"
    )


# =========================================================
# SPONSORSHIP VALIDATION
# =========================================================

def validate_sponsorship_amounts(
    data: SponsorshipInput,
) -> dict:
    """
    Validate payment amounts and derive the correct
    payment-related status.
    """

    payload = data.model_dump()

    pledged = float(payload["pledged_amount"])
    received = float(payload["amount_received"])

    if pledged <= 0:
        raise HTTPException(
            status_code=400,
            detail="Pledged amount must be greater than zero.",
        )

    if received < 0:
        raise HTTPException(
            status_code=400,
            detail="Amount received cannot be negative.",
        )

    if received > pledged:
        raise HTTPException(
            status_code=400,
            detail=(
                "Amount received cannot exceed "
                "the pledged amount."
            ),
        )

    requested_status = payload["status"]

    # Payment amounts determine payment-related statuses.
    if requested_status == "Cancelled":
        final_status = "Cancelled"

    elif received >= pledged:
        final_status = "Paid"

    elif received > 0:
        final_status = "Partially Paid"

    else:
        if requested_status in ("Paid", "Partially Paid"):
            raise HTTPException(
                status_code=400,
                detail=(
                    "The selected payment status does not "
                    "match the amount received."
                ),
            )

        final_status = requested_status

    payload["status"] = final_status
    payload["pledged_amount"] = round(pledged, 2)
    payload["amount_received"] = round(received, 2)
    payload["outstanding_balance"] = round(
        pledged - received,
        2,
    )

    return payload


# =========================================================
# SERIALIZATION
# =========================================================

def serialize_sponsorship(
    sponsorship: dict,
) -> dict:

    result = dict(sponsorship)

    sponsorship_id = result.pop(
        "_id",
        result.get("id"),
    )

    result["id"] = (
        str(sponsorship_id)
        if sponsorship_id is not None
        else None
    )

    # Ensure calculated amounts are always available.
    pledged = float(
        result.get("pledged_amount") or 0
    )

    received = float(
        result.get("amount_received") or 0
    )

    result["outstanding_balance"] = round(
        max(pledged - received, 0),
        2,
    )

    for field in (
        "created_at",
        "updated_at",
    ):
        value = result.get(field)

        if isinstance(value, datetime):
            result[field] = value.isoformat()

    return result


# =========================================================
# SPONSORSHIP ACCESS HELPERS
# =========================================================

def get_sponsorship_or_404(
    request: Request,
    sponsorship_id: str,
) -> dict:

    if not ObjectId.is_valid(sponsorship_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid sponsorship ID.",
        )

    sponsorship = get_sponsorships_collection(
        request
    ).find_one(
        {"_id": ObjectId(sponsorship_id)}
    )

    if not sponsorship:
        raise HTTPException(
            status_code=404,
            detail="Sponsorship not found.",
        )

    return sponsorship


def check_sponsorship_access(
    request: Request,
    user: dict,
    sponsorship: dict,
) -> None:

    event_id = sponsorship.get("event_id")

    if not event_id:
        raise HTTPException(
            status_code=400,
            detail=(
                "This sponsorship is not linked "
                "to a valid event."
            ),
        )

    event = get_event(
        request,
        str(event_id),
    )

    check_event_access(
        user,
        event,
    )


# =========================================================
# GET ALL SPONSORSHIPS
# GET /api/sponsorships/
# =========================================================

@router.get("/")
def get_sponsorships(
    request: Request,
    user: dict = Depends(get_current_user),
    event_id: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    search: Optional[str] = Query(default=None),
):
    """
    Admin:
        Can retrieve all sponsorships.

    Organizer:
        Can retrieve sponsorships belonging to their events.

    Optional filters:
        event_id
        status
        search
    """

    require_manager(user)

    collection = get_sponsorships_collection(
        request
    )

    query = {}

    role = get_role(user)

    # Restrict organizers to their own events.
    if role == "organizer":
        organizer_id = get_user_id(user)

        owned_event_ids = [
            str(event["_id"])
            for event in get_events_collection(
                request
            ).find(
                {"organizer_id": organizer_id},
                {"_id": 1},
            )
        ]

        query["event_id"] = {
            "$in": owned_event_ids
        }

    # Event filter.
    if event_id:
        if not ObjectId.is_valid(event_id):
            raise HTTPException(
                status_code=400,
                detail="Invalid event ID.",
            )

        if (
            "event_id" in query
            and event_id not in query["event_id"]["$in"]
        ):
            raise HTTPException(
                status_code=403,
                detail="You cannot access this event.",
            )

        query["event_id"] = event_id

    # Status filter.
    if status:
        allowed_statuses = {
            "Pending",
            "Confirmed",
            "Partially Paid",
            "Paid",
            "Cancelled",
        }

        if status not in allowed_statuses:
            raise HTTPException(
                status_code=400,
                detail="Invalid sponsorship status.",
            )

        query["status"] = status

    # Sponsor-name search.
    if search and search.strip():
        search_pattern = re.escape(search.strip())

        query["sponsor_name"] = {
            "$regex": search_pattern,
            "$options": "i",
        }

    sponsorships = collection.find(
        query
    ).sort(
        "created_at",
        -1,
    )

    return {
        "success": True,
        "sponsorships": [
            serialize_sponsorship(item)
            for item in sponsorships
        ],
        "count": collection.count_documents(query),
    }


# =========================================================
# GET SPONSORSHIPS BY EVENT
# GET /api/sponsorships/event/{event_id}
# =========================================================

@router.get("/event/{event_id}")
def get_event_sponsorships(
    event_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    require_manager(user)

    event = get_event(
        request,
        event_id,
    )

    check_event_access(
        user,
        event,
    )

    collection = get_sponsorships_collection(
        request
    )

    sponsorships = collection.find(
        {"event_id": event_id}
    ).sort(
        "created_at",
        -1,
    )

    result = [
        serialize_sponsorship(item)
        for item in sponsorships
    ]

    return {
        "success": True,
        "event_id": event_id,
        "event_name": get_event_name(event),
        "sponsorships": result,
        "count": len(result),
    }


# =========================================================
# CREATE SPONSORSHIP
# POST /api/sponsorships/
# =========================================================

@router.post("/", status_code=201)
def create_sponsorship(
    data: SponsorshipInput,
    request: Request,
    user: dict = Depends(get_current_user),
):
    require_manager(user)

    event = get_event(
        request,
        data.event_id,
    )

    check_event_access(
        user,
        event,
    )

    payload = validate_sponsorship_amounts(
        data
    )

    now = datetime.now(timezone.utc)

    payload["event_name"] = get_event_name(
        event
    )

    payload["organizer_id"] = get_user_id(
        user
    )

    payload["created_at"] = now
    payload["updated_at"] = now

    collection = get_sponsorships_collection(
        request
    )

    result = collection.insert_one(
        payload
    )

    return {
        "success": True,
        "message": "Sponsorship created successfully.",
        "id": str(result.inserted_id),
        "sponsorship": serialize_sponsorship(
            {
                **payload,
                "_id": result.inserted_id,
            }
        ),
    }


# =========================================================
# GET ONE SPONSORSHIP
# GET /api/sponsorships/{sponsorship_id}
# =========================================================

@router.get("/{sponsorship_id}")
def get_sponsorship(
    sponsorship_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    require_manager(user)

    sponsorship = get_sponsorship_or_404(
        request,
        sponsorship_id,
    )

    check_sponsorship_access(
        request,
        user,
        sponsorship,
    )

    return {
        "success": True,
        "sponsorship": serialize_sponsorship(
            sponsorship
        ),
    }


# =========================================================
# UPDATE SPONSORSHIP
# PUT /api/sponsorships/{sponsorship_id}
# =========================================================

@router.put("/{sponsorship_id}")
def update_sponsorship(
    sponsorship_id: str,
    data: SponsorshipInput,
    request: Request,
    user: dict = Depends(get_current_user),
):
    require_manager(user)

    collection = get_sponsorships_collection(
        request
    )

    existing = get_sponsorship_or_404(
        request,
        sponsorship_id,
    )

    check_sponsorship_access(
        request,
        user,
        existing,
    )

    # Validate the new event association.
    event = get_event(
        request,
        data.event_id,
    )

    check_event_access(
        user,
        event,
    )

    payload = validate_sponsorship_amounts(
        data
    )

    payload["event_name"] = get_event_name(
        event
    )

    payload["organizer_id"] = get_user_id(
        user
    )

    payload["created_at"] = existing.get(
        "created_at",
        datetime.now(timezone.utc),
    )

    payload["updated_at"] = datetime.now(
        timezone.utc
    )

    collection.update_one(
        {"_id": existing["_id"]},
        {"$set": payload},
    )

    updated = collection.find_one(
        {"_id": existing["_id"]}
    )

    return {
        "success": True,
        "message": "Sponsorship updated successfully.",
        "sponsorship": serialize_sponsorship(
            updated
        ),
    }


# =========================================================
# DELETE SPONSORSHIP
# DELETE /api/sponsorships/{sponsorship_id}
# =========================================================

@router.delete("/{sponsorship_id}")
def delete_sponsorship(
    sponsorship_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    require_manager(user)

    collection = get_sponsorships_collection(
        request
    )

    sponsorship = get_sponsorship_or_404(
        request,
        sponsorship_id,
    )

    check_sponsorship_access(
        request,
        user,
        sponsorship,
    )

    result = collection.delete_one(
        {"_id": sponsorship["_id"]}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Sponsorship not found.",
        )

    return {
        "success": True,
        "message": "Sponsorship deleted successfully.",
        "id": sponsorship_id,
    }