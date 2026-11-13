
from datetime import datetime, timezone, timedelta
import re

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from pymongo.errors import DuplicateKeyError

from routes.auth import get_current_user


router = APIRouter(prefix="/api/venues", tags=["Venues"])


# ---------------------------------------------------------
# REQUEST MODEL
# ---------------------------------------------------------

class VenueData(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="ignore",
    )

    name: str = Field(..., min_length=1, max_length=150)
    address: str = ""
    city: str = ""
    state: str = ""
    country: str = ""
    postal_code: str = ""
    capacity: int = Field(default=0, ge=0)
    cost_per_day: float = Field(
        default=0,
        ge=0,
        allow_inf_nan=False,
    )


# ---------------------------------------------------------
# AUTHORIZATION
# ---------------------------------------------------------

def require_admin_or_organizer(
    user: dict = Depends(get_current_user),
) -> dict:
    if user.get("role") not in ("Admin", "Organizer"):
        raise HTTPException(
            status_code=403,
            detail="You are not allowed to perform this action.",
        )

    return user


# ---------------------------------------------------------
# DATABASE HELPERS
# ---------------------------------------------------------

def get_venues_collection(request: Request):
    return request.app.state.db["venues"]


def get_events_collection(request: Request):
    return request.app.state.db["events"]


# ---------------------------------------------------------
# SERIALIZATION
# ---------------------------------------------------------

def serialize_venue(venue: dict) -> dict:
    result = dict(venue)

    venue_id = result.pop("_id", result.get("id"))

    result["id"] = (
        str(venue_id)
        if venue_id is not None
        else None
    )

    for field in ("created_at", "updated_at"):
        value = result.get(field)

        if isinstance(value, datetime):
            result[field] = value.isoformat()

    return result


# ---------------------------------------------------------
# VENUE LOOKUP
# ---------------------------------------------------------

def get_venue_or_404(collection, venue_id: str) -> dict:
    if not ObjectId.is_valid(venue_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid venue ID.",
        )

    venue = collection.find_one(
        {"_id": ObjectId(venue_id)}
    )

    if not venue:
        raise HTTPException(
            status_code=404,
            detail="Venue not found.",
        )

    return venue


# ---------------------------------------------------------
# VENUE BOOKING STATUS
# ---------------------------------------------------------

def get_booked_venue_ids(request: Request) -> set[str]:
    """
    Calculate booked venues from actual event records.

    A venue is booked when it has at least one event that:
    1. Is not cancelled.
    2. Is not explicitly completed.
    3. Has not reached its end date and time.

    All event dates and times are interpreted in IST.
    """

    events_collection = get_events_collection(request)

    # India Standard Time (UTC + 05:30).
    ist = timezone(timedelta(hours=5, minutes=30))

    now = datetime.now(ist).replace(tzinfo=None)

    booked_venue_ids = set()

    events = events_collection.find(
        {},
        {
            "venue_id": 1,
            "event_date": 1,
            "date": 1,
            "end_date": 1,
            "end_time": 1,
            "status": 1,
        },
    )

    for event in events:

        venue_id = event.get("venue_id")

        if venue_id is None:
            continue

        venue_id = str(venue_id).strip()

        if not venue_id:
            continue

        status = str(
            event.get("status") or "Scheduled"
        ).strip().lower()

        # Cancelled and completed events do not reserve venues.
        if status in {
            "cancelled",
            "canceled",
            "completed",
        }:
            continue

        event_date = (
            event.get("event_date")
            or event.get("date")
        )

        end_date = (
            event.get("end_date")
            or event_date
        )

        end_time = event.get("end_time") or "16:00"

        try:
            event_end = datetime.strptime(
                f"{end_date} {end_time}",
                "%Y-%m-%d %H:%M",
            )

        except (ValueError, TypeError):
            # Ignore malformed legacy event records.
            continue

        # Future and currently running events reserve the venue.
        if event_end > now:
            booked_venue_ids.add(venue_id)

    return booked_venue_ids


def add_venue_availability(
    venue: dict,
    booked_venue_ids: set[str],
) -> dict:
    """
    Attach availability fields to the serialized venue.
    """

    serialized = serialize_venue(venue)

    venue_id = serialized.get("id")

    availability = (
        "Booked"
        if str(venue_id) in booked_venue_ids
        else "Available"
    )

    serialized["availability"] = availability
    serialized["availability_status"] = availability

    return serialized


# ---------------------------------------------------------
# VALIDATION
# ---------------------------------------------------------

def validate_venue(data: VenueData) -> dict:
    venue = data.model_dump()

    if not venue["name"].strip():
        raise HTTPException(
            status_code=400,
            detail="Venue name is required.",
        )

    text_fields = [
        ("address", "Address"),
        ("city", "City"),
        ("state", "State"),
        ("country", "Country"),
        ("postal_code", "Postal code"),
    ]

    for field, label in text_fields:
        value = venue[field]

        if not isinstance(value, str):
            raise HTTPException(
                status_code=400,
                detail=f"{label} must be text.",
            )

        venue[field] = value.strip()

    venue["name"] = venue["name"].strip()

    if venue["capacity"] < 0:
        raise HTTPException(
            status_code=400,
            detail="Capacity must be a non-negative whole number.",
        )

    if venue["cost_per_day"] < 0:
        raise HTTPException(
            status_code=400,
            detail="Venue cost must be a non-negative number.",
        )

    return venue


# ---------------------------------------------------------
# DUPLICATE VENUE VALIDATION
# ---------------------------------------------------------

def ensure_unique_venue_name(
    collection,
    name: str,
    exclude_id: ObjectId | None = None,
) -> None:

    query = {
        "name": {
            "$regex": f"^{re.escape(name)}$",
            "$options": "i",
        }
    }

    if exclude_id is not None:
        query["_id"] = {"$ne": exclude_id}

    if collection.find_one(query):
        raise HTTPException(
            status_code=409,
            detail="A venue with this name already exists.",
        )


# ---------------------------------------------------------
# GET ALL VENUES
# GET /api/venues/
# ---------------------------------------------------------

@router.get("/")
def get_venues(
    request: Request,
    user: dict = Depends(get_current_user),
):

    collection = get_venues_collection(request)

    booked_venue_ids = get_booked_venue_ids(request)

    venues = collection.find().sort("name", 1)

    return [
        add_venue_availability(
            venue,
            booked_venue_ids,
        )
        for venue in venues
    ]


# ---------------------------------------------------------
# GET ONE VENUE
# GET /api/venues/{venue_id}
# ---------------------------------------------------------

@router.get("/{venue_id}")
def get_venue(
    venue_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):

    collection = get_venues_collection(request)

    venue = get_venue_or_404(
        collection,
        venue_id,
    )

    booked_venue_ids = get_booked_venue_ids(request)

    return add_venue_availability(
        venue,
        booked_venue_ids,
    )


# ---------------------------------------------------------
# CREATE VENUE
# POST /api/venues/
# ---------------------------------------------------------

@router.post("/", status_code=201)
def create_venue(
    data: VenueData,
    request: Request,
    user: dict = Depends(require_admin_or_organizer),
):

    collection = get_venues_collection(request)

    venue = validate_venue(data)

    ensure_unique_venue_name(
        collection,
        venue["name"],
    )

    venue["created_at"] = datetime.now(timezone.utc)

    try:
        result = collection.insert_one(venue)

    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="A venue with this name already exists.",
        )

    return {
        "message": "Venue created successfully.",
        "id": str(result.inserted_id),
    }


# ---------------------------------------------------------
# UPDATE VENUE
# PUT /api/venues/{venue_id}
# ---------------------------------------------------------

@router.put("/{venue_id}")
def update_venue(
    venue_id: str,
    data: VenueData,
    request: Request,
    user: dict = Depends(require_admin_or_organizer),
):

    collection = get_venues_collection(request)

    existing = get_venue_or_404(
        collection,
        venue_id,
    )

    venue = validate_venue(data)

    ensure_unique_venue_name(
        collection,
        venue["name"],
        exclude_id=existing["_id"],
    )

    venue["updated_at"] = datetime.now(timezone.utc)

    if existing.get("created_at") is not None:
        venue["created_at"] = existing["created_at"]

    try:
        collection.update_one(
            {"_id": existing["_id"]},
            {"$set": venue},
        )

    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="A venue with this name already exists.",
        )

    return {
        "message": "Venue updated successfully.",
    }


# ---------------------------------------------------------
# DELETE VENUE
# DELETE /api/venues/{venue_id}
# ---------------------------------------------------------

@router.delete("/{venue_id}")
def delete_venue(
    venue_id: str,
    request: Request,
    user: dict = Depends(require_admin_or_organizer),
):

    collection = get_venues_collection(request)

    existing = get_venue_or_404(
        collection,
        venue_id,
    )

    # Protect venues assigned to active/upcoming events.
    booked_venue_ids = get_booked_venue_ids(request)

    if str(venue_id) in booked_venue_ids:
        raise HTTPException(
            status_code=409,
            detail=(
                "This venue cannot be deleted because it is "
                "assigned to an active or upcoming event."
            ),
        )

    result = collection.delete_one(
        {"_id": existing["_id"]}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Venue not found.",
        )

    return {
        "message": "Venue deleted successfully.",
    }
