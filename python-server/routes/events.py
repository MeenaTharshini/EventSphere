
# routes/events.py

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
    end_date: Optional[str] = None
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
    vendor_ids: list[str] = Field(default_factory=list)


class EventUpdate(BaseModel):
    model_config = ConfigDict(extra="ignore", str_strip_whitespace=True)

    name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    event_type: Optional[str] = None

    date: Optional[str] = None
    event_date: Optional[str] = None
    end_date: Optional[str] = None

    start_time: Optional[str] = None
    end_time: Optional[str] = None

    venue_id: Optional[str] = None
    venue: Optional[str] = None
    venue_name: Optional[str] = None

    attendee_count: Optional[int] = Field(default=None, ge=0)
    status: Optional[str] = None
    budget: Optional[float] = Field(default=None, ge=0)

    resource_ids: Optional[list[str]] = None
    vendor_ids: Optional[list[str]] = None


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


def normalize_id_list(values: Any) -> list[str]:
    """Normalize resource/vendor IDs to unique, non-empty strings."""
    if not isinstance(values, (list, tuple, set)):
        return []

    result = []
    seen = set()

    for value in values:
        if value is None:
            continue

        normalized = str(value).strip()

        if not normalized or normalized in seen:
            continue

        seen.add(normalized)
        result.append(normalized)

    return result


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


def event_datetime(event_date: Any, event_time: Any) -> datetime:
    """
    Convert date and time strings into a naive datetime for comparisons.

    Events are interpreted using the application's existing date/time
    convention. This function does not apply a timezone conversion.
    """
    try:
        return datetime.strptime(
            f"{event_date} {event_time}",
            "%Y-%m-%d %H:%M",
        )
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail="Invalid event date or time.",
        )


def normalize_event(event: dict) -> dict:
    """Return event data using the frontend's expected field names."""
    event_id = str(event.get("_id", event.get("id", "")))

    event_type = event.get("event_type") or event.get("type") or "Other"
    event_date = event.get("event_date") or event.get("date") or ""
    end_date = event.get("end_date") or event_date

    venue_id = event.get("venue_id", event.get("venueId"))
    venue_name = event.get("venue_name") or event.get("venue") or None

    result = {
        **event,
        "_id": event_id,
        "id": event_id,
        "event_type": event_type,
        "event_date": event_date,
        "end_date": end_date,
        "date": event_date,
        "venue_id": str(venue_id) if venue_id is not None else None,
        "venue_name": venue_name,
        "start_time": event.get("start_time") or "10:00",
        "end_time": event.get("end_time") or "16:00",
        "attendee_count": int(event.get("attendee_count") or 0),
        "status": normalize_status(event.get("status")) or "Scheduled",
        "budget": float(event.get("budget") or 0),
        "resource_ids": normalize_id_list(event.get("resource_ids")),
        "vendor_ids": normalize_id_list(event.get("vendor_ids")),
    }

    # Never return a raw MongoDB ObjectId in a JSON response.
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


# ---------------------------------------------------------
# EVENT PAYLOAD VALIDATION
# ---------------------------------------------------------

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

    event_date = parse_date(
        payload.get("event_date") or payload.get("date")
    )

    # If end_date is omitted, treat the event as a single-day event.
    end_date = parse_date(payload.get("end_date") or event_date)

    start_time = str(payload.get("start_time") or "10:00").strip()
    end_time = str(payload.get("end_time") or "16:00").strip()

    # Validate HH:MM formatting.
    time_to_minutes(start_time)
    time_to_minutes(end_time)

    start_datetime = event_datetime(event_date, start_time)
    end_datetime = event_datetime(end_date, end_time)

    if end_datetime <= start_datetime:
        raise HTTPException(
            status_code=400,
            detail=(
                "Event end date and time must be later than "
                "the start date and time."
            ),
        )

    # Validate attendee count.
    original_attendee_count = payload.get("attendee_count", 0)

    try:
        attendee_count = int(original_attendee_count or 0)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail="Attendee count must be a non-negative whole number.",
        )

    if attendee_count < 0:
        raise HTTPException(
            status_code=400,
            detail="Attendee count must be a non-negative whole number.",
        )

    # Reject fractional values such as 12.5, but accept "12" and 12.0.
    try:
        if float(original_attendee_count or 0) != attendee_count:
            raise HTTPException(
                status_code=400,
                detail="Attendee count must be a non-negative whole number.",
            )
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail="Attendee count must be a non-negative whole number.",
        )

    # Validate status.
    status = normalize_status(payload.get("status"))

    if not status:
        raise HTTPException(
            status_code=400,
            detail="Invalid event status.",
        )

    # Validate budget.
    try:
        budget = float(payload.get("budget", 0) or 0)
    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail="Invalid event budget.",
        )

    if budget < 0:
        raise HTTPException(
            status_code=400,
            detail="Event budget cannot be negative.",
        )

    # Normalize selected resources and vendors.
    payload["resource_ids"] = normalize_id_list(
        payload.get("resource_ids")
    )
    payload["vendor_ids"] = normalize_id_list(
        payload.get("vendor_ids")
    )

    payload["name"] = name
    payload["event_type"] = str(
        payload.get("event_type") or payload.get("type") or "Conference"
    ).strip()

    payload["event_date"] = event_date
    payload["end_date"] = end_date
    payload["date"] = event_date

    payload["start_time"] = start_time
    payload["end_time"] = end_time

    payload["attendee_count"] = attendee_count
    payload["status"] = status
    payload["budget"] = budget

    return payload


# ---------------------------------------------------------
# VENUE BOOKING CONFLICT VALIDATION
# ---------------------------------------------------------

def check_venue_conflict(
    request: Request,
    payload: dict,
    ignored_event_id: Optional[ObjectId] = None,
) -> Optional[str]:
    """
    Check whether another non-cancelled event occupies the same venue
    during any overlapping date/time interval.

    The comparison uses complete datetimes, so multi-day events are
    handled correctly.
    """
    venue_id = payload.get("venue_id")

    if venue_id is None or str(venue_id).strip() == "":
        return None

    events = get_events_collection(request)

    new_start = event_datetime(
        payload["event_date"],
        payload["start_time"],
    )

    new_end = event_datetime(
        payload.get("end_date") or payload["event_date"],
        payload["end_time"],
    )

    venue_conditions = [
        {"venue_id": str(venue_id)},
        {"venue_id": venue_id},
    ]

    venue_name = payload.get("venue_name") or payload.get("venue")

    if venue_name:
        venue_conditions.append({"venue": venue_name})
        venue_conditions.append({"venue_name": venue_name})

    # Fetch events assigned to this venue. Date overlap is checked below
    # in Python so multi-day intervals are not missed.
    candidates = events.find({
        "$or": venue_conditions,
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

        existing_start_date = (
            existing.get("event_date")
            or existing.get("date")
            or ""
        )

        existing_end_date = (
            existing.get("end_date")
            or existing_start_date
        )

        existing_start_time = existing.get("start_time") or "10:00"
        existing_end_time = existing.get("end_time") or "16:00"

        try:
            existing_start = event_datetime(
                existing_start_date,
                existing_start_time,
            )

            existing_end = event_datetime(
                existing_end_date,
                existing_end_time,
            )
        except HTTPException:
            # Do not let malformed legacy records crash event creation.
            continue

        # Intervals overlap when each begins before the other ends.
        if new_start < existing_end and existing_start < new_end:
            return (
                f'This venue is already booked by '
                f'"{existing.get("name", "another event")}" '
                f'from {existing_start_date} {existing_start_time} '
                f'to {existing_end_date} {existing_end_time}. '
                "Please choose another time or venue."
            )

    return None


# ---------------------------------------------------------
# PERMISSION HELPERS
# ---------------------------------------------------------

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


# ---------------------------------------------------------
# EVENT STORAGE HELPERS
# ---------------------------------------------------------

def prepare_payload_for_storage(
    payload: dict,
    venue: dict,
    user: dict,
) -> dict:
    payload["venue_id"] = venue_identifier(venue)
    payload["venue"] = venue.get("name", "")
    payload["venue_name"] = venue.get("name", "")

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

        venue = find_venue(
            request,
            event.get("venue_id"),
        )

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
    payload["event_date"] = (
        payload.get("event_date") or payload.get("date")
    )

    payload = validate_payload(payload)

    venue = validate_venue_and_capacity(request, payload)

    # Store the selected venue before checking conflicts.
    payload["venue_id"] = venue_identifier(venue)
    payload["venue"] = venue.get("name", "")
    payload["venue_name"] = venue.get("name", "")

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

    # Start from the existing event so omitted fields remain unchanged.
    payload = normalize_event(existing)
    payload.update(updates)

    # Keep date and event_date compatible with the frontend.
    if "date" in updates and "event_date" not in updates:
        payload["event_date"] = updates["date"]

    payload["event_date"] = (
        payload.get("event_date") or payload.get("date")
    )

    payload = validate_payload(payload)

    venue = validate_venue_and_capacity(request, payload)

    # Set the selected venue before checking for overlapping bookings.
    payload["venue_id"] = venue_identifier(venue)
    payload["venue"] = venue.get("name", "")
    payload["venue_name"] = venue.get("name", "")

    conflict = check_venue_conflict(
        request,
        payload,
        ignored_event_id=existing["_id"],
    )

    if conflict:
        raise HTTPException(status_code=400, detail=conflict)

    # Preserve original owner and creation timestamp.
    payload["organizer_id"] = existing.get("organizer_id")
    payload["created_at"] = existing.get("created_at")

    # Do not overwrite MongoDB's primary key.
    payload.pop("_id", None)
    payload.pop("id", None)

    get_events_collection(request).update_one(
        {"_id": existing["_id"]},
        {"$set": payload},
    )

    return {
        "message": "Event schedule updated successfully.",
    }


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

    get_events_collection(request).delete_one(
        {"_id": event["_id"]}
    )

    return {
        "message": "Event deleted successfully.",
    }


# ---------------------------------------------------------
# EVENT COMPLETION HELPER
# ---------------------------------------------------------

def is_event_completed(event: dict) -> bool:
    """
    Return True when the event's end date/time has passed.

    Event dates use YYYY-MM-DD and times use HH:MM.
    If an event has no end_date, its event_date/date is used.
    """

    event_date = (
        event.get("event_date")
        or event.get("date")
        or ""
    )

    end_date = event.get("end_date") or event_date
    end_time = event.get("end_time") or "16:00"

    try:
        event_datetime = datetime.strptime(
            f"{end_date} {end_time}",
            "%Y-%m-%d %H:%M",
        ).replace(tzinfo=timezone.utc)

    except (ValueError, TypeError):
        return False

    return event_datetime <= datetime.now(timezone.utc)

