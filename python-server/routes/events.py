
from datetime import date, datetime, timezone
from typing import Any, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from routes.auth import get_current_user

router = APIRouter(prefix="/api/events", tags=["Events"])


# ---------------------------------------------------------
# REQUEST MODELS
# ---------------------------------------------------------

class EventCreate(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    name: str = Field(..., min_length=2, max_length=150)
    event_type: str = Field(default="Conference", min_length=1, max_length=100)
    event_date: Optional[str] = None
    date: Optional[str] = None
    start_time: str = "10:00"
    end_time: str = "16:00"
    venue_id: Optional[str] = None
    venue: Optional[str] = None
    venue_name: Optional[str] = None
    attendee_count: int = Field(default=0, ge=0)
    status: str = "Scheduled"
    budget: float = Field(default=0, ge=0)
    resource_ids: list[str] = Field(default_factory=list)


class EventUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    event_type: Optional[str] = None
    date: Optional[str] = None
    event_date: Optional[str] = None
    start_time: Optional[str] = None
    end_time: Optional[str] = None
    venue_id: Optional[str] = None
    venue: Optional[str] = None
    venue_name: Optional[str] = None
    attendee_count: Optional[int] = Field(default=None, ge=0)
    status: Optional[str] = None
    budget: Optional[float] = Field(default=None, ge=0)
    resource_ids: Optional[list[str]] = None


# ---------------------------------------------------------
# COMMON HELPERS
# ---------------------------------------------------------

VALID_STATUSES = {
    "planned": "Scheduled",
    "upcoming": "Scheduled",
    "scheduled": "Scheduled",
    "confirmed": "Confirmed",
    "ongoing": "Confirmed",
    "completed": "Confirmed",
    "pending": "Pending",
    "cancelled": "Cancelled",
}


def get_events_collection(request: Request):
    return request.app.state.db["events"]


def get_venues_collection(request: Request):
    return request.app.state.db["venues"]


def get_user_id(user: dict) -> str:
    """Support both MongoDB users (_id) and serialized users (id)."""
    user_id = user.get("_id", user.get("id"))

    if user_id is None or str(user_id).strip() == "":
        raise HTTPException(
            status_code=401,
            detail="Unable to identify the logged-in user. Please log in again.",
        )

    return str(user_id)


def normalize_status(status: Any) -> Optional[str]:
    value = str(status or "Scheduled").strip().lower()
    return VALID_STATUSES.get(value)


def parse_date(value: Any) -> str:
    value = str(value or "").strip()

    try:
        parsed = date.fromisoformat(value)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail="Please provide a valid event date in YYYY-MM-DD format.",
        )

    if parsed.isoformat() != value:
        raise HTTPException(
            status_code=400,
            detail="Please provide a valid event date in YYYY-MM-DD format.",
        )

    return value


def time_to_minutes(value: Any) -> int:
    value = str(value or "").strip()

    try:
        parsed = datetime.strptime(value, "%H:%M")
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail="Please provide valid event times in HH:MM format.",
        )

    if parsed.strftime("%H:%M") != value:
        raise HTTPException(
            status_code=400,
            detail="Please provide valid event times in HH:MM format.",
        )

    return parsed.hour * 60 + parsed.minute


def normalize_event(event: dict) -> dict:
    """Return event data using the frontend's expected field names."""
    event_id = str(event.get("_id", event.get("id", "")))

    event_type = event.get("event_type") or event.get("type") or "Other"
    event_date = event.get("event_date") or event.get("date") or ""

    venue_id = event.get("venue_id", event.get("venueId"))
    venue_name = event.get("venue_name") or event.get("venue") or None

    result = {
        **event,
        "_id": event_id,
        "id": event_id,
        "event_type": event_type,
        "event_date": event_date,
        "venue_id": str(venue_id) if venue_id is not None else None,
        "venue_name": venue_name,
        "start_time": event.get("start_time") or "10:00",
        "end_time": event.get("end_time") or "16:00",
        "attendee_count": int(event.get("attendee_count") or 0),
        "status": normalize_status(event.get("status")) or "Scheduled",
        "budget": float(event.get("budget") or 0),
        "resource_ids": event.get("resource_ids") or [],
    }

    # Never return a raw MongoDB ObjectId in a JSON response.
    if "_id" in result:
        result["_id"] = event_id

    return result


def find_event(request: Request, event_id: str) -> dict:
    if not ObjectId.is_valid(event_id):
        raise HTTPException(status_code=400, detail="Invalid event ID.")

    event = get_events_collection(request).find_one(
        {"_id": ObjectId(event_id)}
    )

    if not event:
        raise HTTPException(status_code=404, detail="Event not found.")

    return event


def find_venue(request: Request, venue_id: Any) -> Optional[dict]:
    if venue_id is None or str(venue_id).strip() == "":
        return None

    venues = get_venues_collection(request)
    value = str(venue_id).strip()

    if ObjectId.is_valid(value):
        venue = venues.find_one({"_id": ObjectId(value)})
        if venue:
            return venue

    venue = venues.find_one({"id": value})
    if venue:
        return venue

    if value.isdigit():
        venue = venues.find_one({"id": int(value)})
        if venue:
            return venue

    return None


def venue_identifier(venue: dict) -> str:
    return str(venue.get("_id", venue.get("id", "")))


def validate_payload(payload: dict) -> dict:
    name = str(payload.get("name") or "").strip()

    if len(name) < 2:
        raise HTTPException(
            status_code=400,
            detail="Event name must contain at least 2 characters.",
        )

    if len(name) > 150:
        raise HTTPException(
            status_code=400,
            detail="Event name must be 150 characters or fewer.",
        )

    event_date = parse_date(payload.get("event_date") or payload.get("date"))

    start_time = str(payload.get("start_time") or "10:00").strip()
    end_time = str(payload.get("end_time") or "16:00").strip()

    start_minutes = time_to_minutes(start_time)
    end_minutes = time_to_minutes(end_time)

    if start_minutes >= end_minutes:
        raise HTTPException(
            status_code=400,
            detail="End time must be later than start time.",
        )

    try:
        attendee_count = int(payload.get("attendee_count", 0))
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail="Attendee count must be a non-negative whole number.",
        )

    original_attendee_count = payload.get("attendee_count", 0)

    if (
        attendee_count < 0
        or str(attendee_count) != str(original_attendee_count).strip()
        and original_attendee_count not in (None, "")
    ):
        # Accept integer values and integer-form strings, reject fractions.
        try:
            if float(original_attendee_count) != attendee_count:
                raise ValueError
        except (ValueError, TypeError):
            raise HTTPException(
                status_code=400,
                detail="Attendee count must be a non-negative whole number.",
            )

    status = normalize_status(payload.get("status"))
    if not status:
        raise HTTPException(status_code=400, detail="Invalid event status.")

    try:
        budget = float(payload.get("budget", 0) or 0)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid event budget.")

    if budget < 0:
        raise HTTPException(
            status_code=400,
            detail="Event budget cannot be negative.",
        )

    payload["name"] = name
    payload["event_type"] = str(
        payload.get("event_type") or payload.get("type") or "Conference"
    ).strip()
    payload["event_date"] = event_date
    payload["date"] = event_date
    payload["start_time"] = start_time
    payload["end_time"] = end_time
    payload["attendee_count"] = attendee_count
    payload["status"] = status
    payload["budget"] = budget
    payload["resource_ids"] = payload.get("resource_ids") or []

    return payload


def check_venue_conflict(
    request: Request,
    payload: dict,
    ignored_event_id: Optional[ObjectId] = None,
) -> Optional[str]:
    venue_id = payload.get("venue_id")

    if venue_id is None or str(venue_id).strip() == "":
        return None

    events = get_events_collection(request)
    event_date = payload["event_date"]
    new_start = time_to_minutes(payload["start_time"])
    new_end = time_to_minutes(payload["end_time"])

    # Use $and so the venue and date conditions are both applied.
    venue_conditions = [
        {"venue_id": str(venue_id)},
        {"venue_id": venue_id},
    ]

    venue_name = payload.get("venue_name") or payload.get("venue")
    if venue_name:
        venue_conditions.append({"venue": venue_name})
        venue_conditions.append({"venue_name": venue_name})

    candidates = events.find({
        "$and": [
            {"$or": venue_conditions},
            {"$or": [
                {"event_date": event_date},
                {"date": event_date},
            ]},
        ]
    })

    for existing in candidates:
        if ignored_event_id and existing.get("_id") == ignored_event_id:
            continue

        if normalize_status(existing.get("status")) == "Cancelled":
            continue

        existing_venue_id = existing.get("venue_id")
        existing_venue_name = (
            existing.get("venue_name") or existing.get("venue")
        )

        same_venue = (
            str(existing_venue_id) == str(venue_id)
            or (
                venue_name
                and existing_venue_name
                and str(existing_venue_name).strip().lower()
                == str(venue_name).strip().lower()
            )
        )

        if not same_venue:
            continue

        existing_start = time_to_minutes(
            existing.get("start_time") or "10:00"
        )
        existing_end = time_to_minutes(
            existing.get("end_time") or "16:00"
        )

        if new_start < existing_end and existing_start < new_end:
            return (
                f'This venue is already booked by '
                f'"{existing.get("name", "another event")}" '
                f'from {existing.get("start_time", "10:00")} '
                f'to {existing.get("end_time", "16:00")} on this date. '
                "Please choose another time or venue."
            )

    return None


def require_event_manager(user: dict) -> None:
    if user.get("role") not in ("Admin", "Organizer"):
        raise HTTPException(
            status_code=403,
            detail="You are not allowed to perform this action.",
        )


def require_event_owner(user: dict, event: dict) -> None:
    if user.get("role") == "Admin":
        return

    current_user_id = get_user_id(user)
    event_owner_id = str(event.get("organizer_id") or "")

    if not event_owner_id or event_owner_id != current_user_id:
        raise HTTPException(
            status_code=403,
            detail="You can only manage your own events.",
        )


def prepare_payload_for_storage(
    payload: dict,
    venue: dict,
    user: dict,
) -> dict:
    payload["venue_id"] = venue_identifier(venue)
    payload["venue"] = venue.get("name", "")
    payload["venue_name"] = venue.get("name", "")

    # IMPORTANT: Save the authenticated user's actual MongoDB ID.
    payload["organizer_id"] = get_user_id(user)

    return payload


def validate_venue_and_capacity(
    request: Request,
    payload: dict,
) -> dict:
    venue_id = payload.get("venue_id")

    if venue_id is None or str(venue_id).strip() == "":
        raise HTTPException(
            status_code=400,
            detail="Please select a valid venue.",
        )

    venue = find_venue(request, venue_id)

    if not venue:
        raise HTTPException(
            status_code=400,
            detail="Please select a valid venue.",
        )

    capacity = int(venue.get("capacity") or 0)

    if capacity > 0 and payload["attendee_count"] > capacity:
        raise HTTPException(
            status_code=400,
            detail=f"This venue can accommodate {capacity} attendees only.",
        )

    return venue


# ---------------------------------------------------------
# GET ALL EVENTS
# ---------------------------------------------------------

@router.get("/")
def get_events(
    request: Request,
    user: dict = Depends(get_current_user),
):
    events = get_events_collection(request)
    result = []

    for event in events.find().sort("_id", -1):
        normalized = normalize_event(event)
        venue = find_venue(request, event.get("venue_id"))

        if venue:
            normalized["venue_name"] = venue.get("name")
            normalized["venue"] = venue.get("name")

        result.append(normalized)

    return result


# ---------------------------------------------------------
# GET ONE EVENT
# ---------------------------------------------------------

@router.get("/{event_id}")
def get_event(
    event_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    event = find_event(request, event_id)
    normalized = normalize_event(event)

    venue = find_venue(request, event.get("venue_id"))

    if venue:
        normalized["venue_name"] = venue.get("name")
        normalized["venue"] = venue.get("name")

    return normalized


# ---------------------------------------------------------
# CREATE EVENT
# ---------------------------------------------------------

@router.post("/", status_code=201)
def create_event(
    data: EventCreate,
    request: Request,
    user: dict = Depends(get_current_user),
):
    require_event_manager(user)

    payload = data.model_dump()
    payload["event_type"] = payload.get("event_type") or "Conference"
    payload["event_date"] = payload.get("event_date") or payload.get("date")

    payload = validate_payload(payload)
    venue = validate_venue_and_capacity(request, payload)

    conflict = check_venue_conflict(request, payload)
    if conflict:
        raise HTTPException(status_code=400, detail=conflict)

    payload = prepare_payload_for_storage(payload, venue, user)
    payload["created_at"] = datetime.now(timezone.utc)

    result = get_events_collection(request).insert_one(payload)

    return {
        "message": "Event scheduled successfully.",
        "id": str(result.inserted_id),
    }


# ---------------------------------------------------------
# UPDATE EVENT
# ---------------------------------------------------------

@router.put("/{event_id}")
def update_event(
    event_id: str,
    data: EventUpdate,
    request: Request,
    user: dict = Depends(get_current_user),
):
    require_event_manager(user)

    existing = find_event(request, event_id)
    require_event_owner(user, existing)

    updates = data.model_dump(exclude_unset=True)

    if not updates:
        raise HTTPException(
            status_code=400,
            detail="No event fields were provided for update.",
        )

    payload = normalize_event(existing)
    payload.update(updates)

    if "date" in updates and "event_date" not in updates:
        payload["event_date"] = updates["date"]

    payload["event_date"] = payload.get("event_date") or payload.get("date")
    payload = validate_payload(payload)

    venue = validate_venue_and_capacity(request, payload)

    conflict = check_venue_conflict(
        request,
        payload,
        ignored_event_id=existing["_id"],
    )

    if conflict:
        raise HTTPException(status_code=400, detail=conflict)

    payload["venue_id"] = venue_identifier(venue)
    payload["venue"] = venue.get("name", "")
    payload["venue_name"] = venue.get("name", "")

    # Preserve the original owner and creation time.
    payload["organizer_id"] = existing.get("organizer_id")
    payload["created_at"] = existing.get("created_at")

    payload.pop("_id", None)
    payload.pop("id", None)

    get_events_collection(request).update_one(
        {"_id": existing["_id"]},
        {"$set": payload},
    )

    return {"message": "Event schedule updated successfully."}


# ---------------------------------------------------------
# DELETE EVENT
# ---------------------------------------------------------

@router.delete("/{event_id}")
def delete_event(
    event_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    require_event_manager(user)

    event = find_event(request, event_id)
    require_event_owner(user, event)

    get_events_collection(request).delete_one({"_id": event["_id"]})

    return {"message": "Event deleted successfully."}
