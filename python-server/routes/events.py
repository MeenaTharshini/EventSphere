
# routes/events.py

from datetime import date, datetime, timezone, timedelta
from typing import Any, Optional
import logging

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from routes.auth import get_current_user
from .notifications import create_notification


router = APIRouter(
    prefix="/api/events",
    tags=["Events"],
)

logger = logging.getLogger(__name__)

IST = timezone(timedelta(hours=5, minutes=30))


# ---------------------------------------------------------
# REQUEST MODELS
# ---------------------------------------------------------

class EventCreate(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        str_strip_whitespace=True,
    )

    name: str = Field(..., min_length=2, max_length=150)

    event_type: str = Field(
        default="Conference",
        min_length=1,
        max_length=100,
    )

    event_date: Optional[str] = None
    end_date: Optional[str] = None
    date: Optional[str] = None

    start_time: str = "10:00"
    end_time: str = "16:00"

    venue_id: Optional[str] = None
    venue: Optional[str] = None
    venue_name: Optional[str] = None

    # attendee_count is intentionally excluded.
    # It is managed by attendee registration/cancellation routes.

    status: str = "Scheduled"
    budget: float = Field(default=0, ge=0)

    resource_ids: list[str] = Field(default_factory=list)
    vendor_ids: list[str] = Field(default_factory=list)


class EventUpdate(BaseModel):
    model_config = ConfigDict(
        extra="ignore",
        str_strip_whitespace=True,
    )

    name: Optional[str] = Field(
        default=None,
        min_length=2,
        max_length=150,
    )

    event_type: Optional[str] = None

    date: Optional[str] = None
    event_date: Optional[str] = None
    end_date: Optional[str] = None

    start_time: Optional[str] = None
    end_time: Optional[str] = None

    venue_id: Optional[str] = None
    venue: Optional[str] = None
    venue_name: Optional[str] = None

    # attendee_count is intentionally excluded.

    status: Optional[str] = None
    budget: Optional[float] = Field(default=None, ge=0)

    resource_ids: Optional[list[str]] = None
    vendor_ids: Optional[list[str]] = None


# ---------------------------------------------------------
# CONSTANTS
# ---------------------------------------------------------

VALID_STATUSES = {
    "planned": "Scheduled",
    "upcoming": "Scheduled",
    "scheduled": "Scheduled",
    "confirmed": "Confirmed",
    "ongoing": "Ongoing",
    "completed": "Completed",
    "pending": "Pending",
    "cancelled": "Cancelled",
    "canceled": "Cancelled",
}


# ---------------------------------------------------------
# COLLECTION HELPERS
# ---------------------------------------------------------

def get_events_collection(request: Request):
    return request.app.state.db["events"]


def get_venues_collection(request: Request):
    return request.app.state.db["venues"]


def get_vendors_collection(request: Request):
    return request.app.state.db["vendors"]


def get_user_id(user: dict) -> str:
    """Support MongoDB users and serialized users."""

    user_id = user.get("_id") or user.get("id")

    if user_id is None or not str(user_id).strip():
        raise HTTPException(
            status_code=401,
            detail=(
                "Unable to identify the logged-in user. "
                "Please log in again."
            ),
        )

    return str(user_id)


# ---------------------------------------------------------
# NORMALIZATION HELPERS
# ---------------------------------------------------------

def normalize_role(user: dict) -> str:
    return str(
        user.get("role") or ""
    ).strip().lower()


def normalize_status(status: Any) -> Optional[str]:
    value = str(
        status or "Scheduled"
    ).strip().lower()

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


def safe_attendee_count(event: dict) -> int:
    """Read the backend-managed attendee count safely."""

    try:
        return max(
            0,
            int(event.get("attendee_count") or 0),
        )
    except (ValueError, TypeError, OverflowError):
        return 0


# ---------------------------------------------------------
# DATE AND TIME HELPERS
# ---------------------------------------------------------

def parse_date(value: Any) -> str:
    value = str(value or "").strip()

    try:
        parsed = date.fromisoformat(value)

    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail=(
                "Please provide a valid event date "
                "in YYYY-MM-DD format."
            ),
        )

    if parsed.isoformat() != value:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please provide a valid event date "
                "in YYYY-MM-DD format."
            ),
        )

    return value


def time_to_minutes(value: Any) -> int:
    value = str(value or "").strip()

    try:
        parsed = datetime.strptime(value, "%H:%M")

    except (ValueError, TypeError):
        raise HTTPException(
            status_code=400,
            detail=(
                "Please provide valid event times "
                "in HH:MM format."
            ),
        )

    if parsed.strftime("%H:%M") != value:
        raise HTTPException(
            status_code=400,
            detail=(
                "Please provide valid event times "
                "in HH:MM format."
            ),
        )

    return parsed.hour * 60 + parsed.minute


def event_datetime(
    event_date: Any,
    event_time: Any,
) -> datetime:
    """
    Convert event date and time into a naive local datetime.

    Event date/time fields are treated as local event time.
    Both sides of venue conflict checks use this convention.
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


# ---------------------------------------------------------
# EVENT SERIALIZATION
# ---------------------------------------------------------

def normalize_event(event: dict) -> dict:
    """Return event data using frontend-compatible field names."""

    event_id = str(
        event.get("_id", event.get("id", ""))
    )

    event_type = (
        event.get("event_type")
        or event.get("type")
        or "Other"
    )

    event_date = (
        event.get("event_date")
        or event.get("date")
        or ""
    )

    end_date = (
        event.get("end_date")
        or event_date
    )

    venue_id = event.get(
        "venue_id",
        event.get("venueId"),
    )

    venue_name = (
        event.get("venue_name")
        or event.get("venue")
        or None
    )

    normalized_status = (
        normalize_status(event.get("status"))
        or "Scheduled"
    )

    result = {
        **event,

        "_id": event_id,
        "id": event_id,

        "event_type": event_type,

        "event_date": event_date,
        "end_date": end_date,
        "date": event_date,

        "venue_id": (
            str(venue_id)
            if venue_id is not None
            else None
        ),

        "venue_name": venue_name,

        "start_time": (
            event.get("start_time")
            or "10:00"
        ),

        "end_time": (
            event.get("end_time")
            or "16:00"
        ),

        "attendee_count": safe_attendee_count(event),

        "status": normalized_status,

        "budget": float(
            event.get("budget") or 0
        ),

        "resource_ids": normalize_id_list(
            event.get("resource_ids")
        ),

        "vendor_ids": normalize_id_list(
            event.get("vendor_ids")
        ),
    }

    # Ensure MongoDB ObjectId values are JSON-safe.
    result["_id"] = event_id

    return result


# ---------------------------------------------------------
# FIND HELPERS
# ---------------------------------------------------------

def find_event(
    request: Request,
    event_id: str,
) -> dict:

    if not ObjectId.is_valid(event_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid event ID.",
        )

    event = get_events_collection(request).find_one({
        "_id": ObjectId(event_id),
    })

    if not event:
        raise HTTPException(
            status_code=404,
            detail="Event not found.",
        )

    return event


def find_venue(
    request: Request,
    venue_id: Any,
) -> Optional[dict]:

    if venue_id is None or not str(venue_id).strip():
        return None

    venues = get_venues_collection(request)
    value = str(venue_id).strip()

    if ObjectId.is_valid(value):
        venue = venues.find_one({
            "_id": ObjectId(value),
        })

        if venue:
            return venue

    venue = venues.find_one({
        "id": value,
    })

    if venue:
        return venue

    if value.isdigit():
        venue = venues.find_one({
            "id": int(value),
        })

        if venue:
            return venue

    return None


def venue_identifier(venue: dict) -> str:
    return str(
        venue.get("_id", venue.get("id", ""))
    )


# ---------------------------------------------------------
# VENDOR ASSIGNMENT NOTIFICATIONS
# ---------------------------------------------------------

def send_vendor_assignment_notification(
    request: Request,
    vendor_id: str,
    event_id: str,
    event: dict,
) -> bool:
    """
    Notify the vendor account when an event is assigned.

    Event vendor_ids contain vendor profile IDs.
    Notification recipient_id contains the vendor account user_id.
    """

    try:
        if not ObjectId.is_valid(vendor_id):
            logger.warning(
                "Skipping vendor notification: invalid vendor ID %s",
                vendor_id,
            )
            return False

        vendor = get_vendors_collection(request).find_one({
            "_id": ObjectId(vendor_id),
        })

        if not vendor:
            logger.warning(
                "Skipping vendor notification: profile not found for %s",
                vendor_id,
            )
            return False

        recipient_id = vendor.get("user_id")

        if not recipient_id:
            logger.warning(
                "Skipping vendor notification: vendor %s has no user_id",
                vendor_id,
            )
            return False

        event_name = event.get("name") or "an event"

        event_date = (
            event.get("event_date")
            or event.get("date")
            or "Date not specified"
        )

        venue_name = (
            event.get("venue_name")
            or event.get("venue")
            or "Venue not specified"
        )

        message = (
            f"You have been assigned to {event_name}. "
            f"Event date: {event_date}. "
            f"Venue: {venue_name}. "
            "Please check your assigned events for details."
        )

        created_at = (
            event.get("updated_at")
            or event.get("created_at")
        )

        assignment_stamp = (
            created_at.isoformat()
            if isinstance(created_at, datetime)
            else str(created_at or event_id)
        )

        create_notification(
            request.app.state.db,
            recipient_id=str(recipient_id),
            title="New event assigned",
            message=message,
            notification_type="info",
            category="vendor",
            related_id=str(event_id),
            related_type="event_assignment",
            metadata={
                "event_id": str(event_id),
                "event_name": event_name,
                "event_date": event_date,
                "venue_name": venue_name,
                "vendor_id": str(vendor_id),
                "destination": "vendor-events",
            },
            dedupe_key=(
                f"event_vendor_assigned:"
                f"{event_id}:{vendor_id}:{assignment_stamp}"
            ),
        )

        return True

    except Exception:
        logger.exception(
            "Failed to notify vendor %s about event %s",
            vendor_id,
            event_id,
        )
        return False


def notify_assigned_vendors(
    request: Request,
    event_id: str,
    event: dict,
    vendor_ids: list[str],
) -> None:
    """Send notifications to all newly assigned vendors."""

    for vendor_id in normalize_id_list(vendor_ids):
        send_vendor_assignment_notification(
            request=request,
            vendor_id=vendor_id,
            event_id=event_id,
            event=event,
        )


# ---------------------------------------------------------
# EVENT PAYLOAD VALIDATION
# ---------------------------------------------------------

def validate_payload(payload: dict) -> dict:

    name = str(
        payload.get("name") or ""
    ).strip()

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
        payload.get("event_date")
        or payload.get("date")
    )

    end_date = parse_date(
        payload.get("end_date")
        or event_date
    )

    start_time = str(
        payload.get("start_time") or "10:00"
    ).strip()

    end_time = str(
        payload.get("end_time") or "16:00"
    ).strip()

    time_to_minutes(start_time)
    time_to_minutes(end_time)

    start_datetime = event_datetime(
        event_date,
        start_time,
    )

    end_datetime = event_datetime(
        end_date,
        end_time,
    )

    if end_datetime <= start_datetime:
        raise HTTPException(
            status_code=400,
            detail=(
                "Event end date and time must be later than "
                "the start date and time."
            ),
        )

    # Validate status.
    status = normalize_status(
        payload.get("status")
    )

    if not status:
        raise HTTPException(
            status_code=400,
            detail="Invalid event status.",
        )

    # Validate budget.
    try:
        budget = float(
            payload.get("budget", 0) or 0
        )

    except (ValueError, TypeError, OverflowError):
        raise HTTPException(
            status_code=400,
            detail="Invalid event budget.",
        )

    if budget < 0:
        raise HTTPException(
            status_code=400,
            detail="Event budget cannot be negative.",
        )

    event_type = str(
        payload.get("event_type")
        or payload.get("type")
        or "Conference"
    ).strip()

    if not event_type:
        raise HTTPException(
            status_code=400,
            detail="Event type cannot be empty.",
        )

    # Normalize resources and vendors.
    payload["resource_ids"] = normalize_id_list(
        payload.get("resource_ids")
    )

    payload["vendor_ids"] = normalize_id_list(
        payload.get("vendor_ids")
    )

    payload["name"] = name
    payload["event_type"] = event_type

    payload["event_date"] = event_date
    payload["end_date"] = end_date
    payload["date"] = event_date

    payload["start_time"] = start_time
    payload["end_time"] = end_time

    payload["status"] = status
    payload["budget"] = budget

    # Do not calculate or accept attendee_count here.
    # The caller must preserve/set its backend-managed value.

    return payload


# ---------------------------------------------------------
# VENUE BOOKING CONFLICT VALIDATION
# ---------------------------------------------------------

def check_venue_conflict(
    request: Request,
    payload: dict,
    ignored_event_id: Optional[ObjectId] = None,
) -> Optional[str]:

    venue_id = payload.get("venue_id")

    if venue_id is None or not str(venue_id).strip():
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

    venue_name = (
        payload.get("venue_name")
        or payload.get("venue")
    )

    if venue_name:
        venue_conditions.extend([
            {"venue": venue_name},
            {"venue_name": venue_name},
        ])

    candidates = events.find({
        "$or": venue_conditions,
    })

    for existing in candidates:

        if (
            ignored_event_id
            and existing.get("_id") == ignored_event_id
        ):
            continue

        if normalize_status(
            existing.get("status")
        ) == "Cancelled":
            continue

        existing_venue_id = existing.get("venue_id")

        existing_venue_name = (
            existing.get("venue_name")
            or existing.get("venue")
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

        existing_start_time = (
            existing.get("start_time") or "10:00"
        )

        existing_end_time = (
            existing.get("end_time") or "16:00"
        )

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
            # Ignore malformed legacy event records.
            continue

        if (
            new_start < existing_end
            and existing_start < new_end
        ):
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

    if normalize_role(user) not in (
        "admin",
        "administrator",
        "organizer",
    ):
        raise HTTPException(
            status_code=403,
            detail="You are not allowed to perform this action.",
        )


def require_event_owner(
    user: dict,
    event: dict,
) -> None:

    role = normalize_role(user)

    if role in ("admin", "administrator"):
        return

    current_user_id = get_user_id(user)

    event_owner_id = str(
        event.get("organizer_id") or ""
    )

    if (
        not event_owner_id
        or event_owner_id != current_user_id
    ):
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

    if venue_id is None or not str(venue_id).strip():
        raise HTTPException(
            status_code=400,
            detail="Please select a valid venue.",
        )

    venue = find_venue(
        request,
        venue_id,
    )

    if not venue:
        raise HTTPException(
            status_code=400,
            detail="Please select a valid venue.",
        )

    try:
        capacity = int(
            venue.get("capacity") or 0
        )

    except (ValueError, TypeError, OverflowError):
        capacity = 0

    # This count comes from the database, not the frontend.
    attendee_count = safe_attendee_count(payload)

    if (
        capacity > 0
        and attendee_count > capacity
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                f"This venue can accommodate {capacity} attendees only. "
                f"The event currently has {attendee_count} registered attendees."
            ),
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

    event = find_event(
        request,
        event_id,
    )

    normalized = normalize_event(event)

    venue = find_venue(
        request,
        event.get("venue_id"),
    )

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

    # Attendee count is exclusively managed by registration routes.
    payload["attendee_count"] = 0

    payload["event_type"] = (
        payload.get("event_type")
        or "Conference"
    )

    payload["event_date"] = (
        payload.get("event_date")
        or payload.get("date")
    )

    payload = validate_payload(payload)

    venue = validate_venue_and_capacity(
        request,
        payload,
    )

    payload["venue_id"] = venue_identifier(venue)
    payload["venue"] = venue.get("name", "")
    payload["venue_name"] = venue.get("name", "")

    conflict = check_venue_conflict(
        request,
        payload,
    )

    if conflict:
        raise HTTPException(
            status_code=400,
            detail=conflict,
        )

    payload = prepare_payload_for_storage(
        payload,
        venue,
        user,
    )

    now = datetime.now(timezone.utc)

    payload["created_at"] = now
    payload["updated_at"] = now

    result = get_events_collection(request).insert_one(
        payload
    )

    event_id = str(result.inserted_id)

    notify_assigned_vendors(
        request=request,
        event_id=event_id,
        event=payload,
        vendor_ids=payload.get("vendor_ids", []),
    )

    return {
        "message": "Event scheduled successfully.",
        "id": event_id,
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

    existing = find_event(
        request,
        event_id,
    )

    require_event_owner(
        user,
        existing,
    )

    updates = data.model_dump(
        exclude_unset=True,
    )

    if not updates:
        raise HTTPException(
            status_code=400,
            detail="No event fields were provided for update.",
        )

    # Capture existing vendor assignments before changing the event.
    previous_vendor_ids = set(
        normalize_id_list(
            existing.get("vendor_ids")
        )
    )

    # Preserve existing fields.
    payload = normalize_event(existing)
    payload.update(updates)

    # Attendee count must never be overwritten by event updates.
    payload["attendee_count"] = safe_attendee_count(existing)

    # Maintain compatibility between date and event_date.
    if (
        "date" in updates
        and "event_date" not in updates
    ):
        payload["event_date"] = updates["date"]

    payload["event_date"] = (
        payload.get("event_date")
        or payload.get("date")
    )

    payload = validate_payload(payload)

    venue = validate_venue_and_capacity(
        request,
        payload,
    )

    payload["venue_id"] = venue_identifier(venue)
    payload["venue"] = venue.get("name", "")
    payload["venue_name"] = venue.get("name", "")

    conflict = check_venue_conflict(
        request,
        payload,
        ignored_event_id=existing["_id"],
    )

    if conflict:
        raise HTTPException(
            status_code=400,
            detail=conflict,
        )

    # Preserve original owner and creation timestamp.
    payload["organizer_id"] = existing.get(
        "organizer_id"
    )

    payload["created_at"] = existing.get(
        "created_at"
    )

    payload["updated_at"] = datetime.now(
        timezone.utc
    )

    # Identify only newly assigned vendors.
    current_vendor_ids = set(
        normalize_id_list(
            payload.get("vendor_ids")
        )
    )

    newly_assigned_vendor_ids = sorted(
        current_vendor_ids - previous_vendor_ids
    )

    # Remove fields that must not be overwritten.
    payload.pop("_id", None)
    payload.pop("id", None)

    get_events_collection(request).update_one(
        {"_id": existing["_id"]},
        {"$set": payload},
    )

    if newly_assigned_vendor_ids:
        notify_assigned_vendors(
            request=request,
            event_id=event_id,
            event=payload,
            vendor_ids=newly_assigned_vendor_ids,
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

    event = find_event(
        request,
        event_id,
    )

    require_event_owner(
        user,
        event,
    )

    get_events_collection(request).delete_one({
        "_id": event["_id"],
    })

    return {
        "message": "Event deleted successfully.",
    }


# ---------------------------------------------------------
# EVENT COMPLETION HELPER
# ---------------------------------------------------------

def is_event_completed(event: dict) -> bool:
    """
    Return True when the event's end date/time has passed.

    Event date/time values are interpreted in IST,
    matching the attendee registration route.
    """

    event_date = (
        event.get("event_date")
        or event.get("date")
        or ""
    )

    end_date = (
        event.get("end_date")
        or event_date
    )

    end_time = (
        event.get("end_time")
        or "16:00"
    )

    try:
        completion_datetime = datetime.strptime(
            f"{end_date} {end_time}",
            "%Y-%m-%d %H:%M",
        ).replace(tzinfo=IST)

    except (ValueError, TypeError):
        return False

    return (
        completion_datetime
        <= datetime.now(IST)
    )
