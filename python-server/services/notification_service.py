# services/notification_service.py

import logging
import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from bson import ObjectId
from pymongo.errors import PyMongoError

from routes.notifications import create_notification


logger = logging.getLogger(__name__)

IST = ZoneInfo("Asia/Kolkata")


# ---------------------------------------------------------
# REMINDER RULES
# ---------------------------------------------------------

REMINDER_RULES = {
    7: "Your event is one week away!",
    3: "Only 3 days left until your event!",
    1: "Your event is tomorrow!",
    0: "Your event is happening today!",
}

ACTIVE_EVENT_STATUSES = [
    "Scheduled",
    "Confirmed",
    "scheduled",
    "confirmed",
]

ACTIVE_REGISTRATION_STATUSES = [
    "Registered",
    "registered",
]

CANCELLED_EVENT_STATUSES = [
    "Cancelled",
    "Canceled",
    "cancelled",
    "canceled",
]


# ---------------------------------------------------------
# CURRENT TIME HELPER
# ---------------------------------------------------------

def get_current_ist_time(now=None) -> datetime:
    """Return the supplied/current time normalized to IST."""

    if now is None:
        return datetime.now(IST)

    if not isinstance(now, datetime):
        raise TypeError("now must be a datetime object.")

    if now.tzinfo is None:
        return now.replace(tzinfo=IST)

    return now.astimezone(IST)


# ---------------------------------------------------------
# DATE HELPERS
# ---------------------------------------------------------

def parse_event_date(value):
    """
    Convert supported event date values into a date object.

    Supported formats:
    - datetime
    - date
    - YYYY-MM-DD
    - ISO datetime strings
    """

    if value is None:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            return value.date()

        return value.astimezone(IST).date()

    if isinstance(value, date):
        return value

    value = str(value).strip()

    if not value:
        return None

    # First try a normal YYYY-MM-DD date.
    try:
        return date.fromisoformat(value[:10])
    except ValueError:
        pass

    # Then try an ISO datetime.
    try:
        normalized = value.replace("Z", "+00:00")
        parsed = datetime.fromisoformat(normalized)

        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=IST)

        return parsed.astimezone(IST).date()

    except ValueError:
        return None


def get_event_start_date(event):
    """Read the event start date from the EventSphere event document."""

    value = (
        event.get("event_date")
        or event.get("date")
        or event.get("start_date")
        or event.get("start_datetime")
    )

    parsed = parse_event_date(value)

    if parsed is None:
        logger.warning(
            "Invalid or missing start date for event %s: %s",
            event.get("_id"),
            value,
        )

    return parsed


def get_event_end_date(event, start_date):
    """Read the event end date, defaulting to its start date."""

    value = event.get("end_date")

    if not value:
        return start_date

    parsed = parse_event_date(value)

    if parsed is None:
        logger.warning(
            "Invalid end date for event %s: %s. "
            "Using the start date instead.",
            event.get("_id"),
            value,
        )
        return start_date

    return parsed


# ---------------------------------------------------------
# TIME HELPERS
# ---------------------------------------------------------

def parse_event_time(value, default="10:00"):
    """Parse an event time in HH:MM format."""

    value = str(value or default).strip()

    try:
        return datetime.strptime(
            value,
            "%H:%M",
        ).time()

    except ValueError:
        logger.warning(
            "Invalid event time '%s'. Using %s.",
            value,
            default,
        )

        return datetime.strptime(
            default,
            "%H:%M",
        ).time()


def get_event_end_datetime(event, start_date):
    """Build an IST-aware event ending datetime."""

    end_date = get_event_end_date(
        event,
        start_date,
    )

    end_time = parse_event_time(
        event.get("end_time"),
        default="16:00",
    )

    return datetime.combine(
        end_date,
        end_time,
        tzinfo=IST,
    )


# ---------------------------------------------------------
# EVENT HELPERS
# ---------------------------------------------------------

def get_event_name(event):
    return (
        event.get("name")
        or event.get("title")
        or event.get("event_name")
        or "Your event"
    )


def get_event_venue(event):
    venue = (
        event.get("venue_name")
        or event.get("venue")
        or "Venue not specified"
    )

    if isinstance(venue, dict):
        return (
            venue.get("name")
            or venue.get("venue_name")
            or "Venue not specified"
        )

    return str(venue)


def get_event_id(event):
    event_id = event.get("_id") or event.get("id")

    if event_id is None:
        return None

    return str(event_id)


def is_event_active(event):
    """Check whether an event is eligible for reminders."""

    status = str(
        event.get("status") or ""
    ).strip().lower()

    return status in {
        "scheduled",
        "confirmed",
    }


# ---------------------------------------------------------
# ATTENDEE LOOKUP
# ---------------------------------------------------------

def get_attendee_user_id(db, attendee):
    """
    Resolve an attendee's account ID.

    Current registration documents store user_id.
    Older registrations can fall back to email lookup.
    """

    user_id = attendee.get("user_id")

    if user_id is not None and str(user_id).strip():
        return str(user_id)

    email = str(
        attendee.get("email")
        or attendee.get("email_normalized")
        or ""
    ).strip().lower()

    if not email:
        return None

    users = db["users"]

    # Try normalized email fields first.
    user = users.find_one({
        "$or": [
            {"email": email},
            {"email_normalized": email},
        ]
    })

    # Fall back to a case-insensitive email match.
    if not user:
        user = users.find_one({
            "email": {
                "$regex": f"^{re.escape(email)}$",
                "$options": "i",
            }
        })

    if not user:
        return None

    user_id = user.get("_id") or user.get("id")

    return str(user_id) if user_id is not None else None


# ---------------------------------------------------------
# REGISTRATION HELPERS
# ---------------------------------------------------------

def get_registration_version(attendee):
    """
    Create a stable registration version for reminder deduplication.

    Re-registering after cancellation normally updates registered_at,
    allowing reminders for the new registration to be generated.
    """

    registered_at = attendee.get("registered_at")

    if isinstance(registered_at, datetime):
        return registered_at.isoformat()

    if registered_at is not None:
        return str(registered_at)

    registration_id = attendee.get("_id")

    if registration_id is not None:
        return str(registration_id)

    return "unknown-registration"


def get_registration_id(attendee):
    registration_id = attendee.get("_id")

    if registration_id is None:
        return None

    return str(registration_id)


def get_event_registration_query(event_id):
    """
    Build a query compatible with the current attendee route.

    Current registrations store event_id as a string.
    ObjectId is also included for legacy records.
    """

    event_ids = [str(event_id)]

    if ObjectId.is_valid(str(event_id)):
        event_ids.append(ObjectId(str(event_id)))

    return {
        "event_id": {
            "$in": event_ids,
        },
        "status": {
            "$in": ACTIVE_REGISTRATION_STATUSES,
        },
    }


# ---------------------------------------------------------
# REMINDER MESSAGE
# ---------------------------------------------------------

def build_reminder_message(
    event_name,
    event_date,
    start_time,
    venue_name,
    days_remaining,
):
    """Build the appropriate reminder message."""

    if days_remaining == 0:
        return (
            f"{event_name} is happening today at {start_time}. "
            f"Venue: {venue_name}."
        )

    if days_remaining == 1:
        return (
            f"{event_name} is happening tomorrow, "
            f"on {event_date.isoformat()} at {start_time}. "
            f"Venue: {venue_name}."
        )

    return (
        f"{event_name} is happening in {days_remaining} days, "
        f"on {event_date.isoformat()} at {start_time}. "
        f"Venue: {venue_name}."
    )


# ---------------------------------------------------------
# CREATE ONE ATTENDEE REMINDER
# ---------------------------------------------------------

def send_attendee_event_reminder(
    db,
    event,
    attendee,
    event_id,
    event_date,
    days_remaining,
):
    """
    Create one reminder notification for one registered attendee.

    Returns True when create_notification returns a notification ID.
    """

    recipient_id = get_attendee_user_id(
        db,
        attendee,
    )

    if not recipient_id:
        logger.warning(
            "Skipping reminder: no user account found for attendee %s",
            attendee.get("_id"),
        )
        return False

    registration_id = get_registration_id(attendee)

    if not registration_id:
        logger.warning(
            "Skipping reminder: attendee registration has no ID "
            "for event %s",
            event_id,
        )
        return False

    event_name = get_event_name(event)

    start_time = parse_event_time(
        event.get("start_time"),
        default="10:00",
    ).strftime("%H:%M")

    venue_name = get_event_venue(event)

    message = build_reminder_message(
        event_name=event_name,
        event_date=event_date,
        start_time=start_time,
        venue_name=venue_name,
        days_remaining=days_remaining,
    )

    registration_version = get_registration_version(
        attendee,
    )

    # This key prevents duplicate notifications when the scheduler
    # runs repeatedly on the same reminder day.
    dedupe_key = (
        f"event_reminder:"
        f"{event_id}:"
        f"{event_date.isoformat()}:"
        f"{days_remaining}:"
        f"{recipient_id}:"
        f"{registration_version}"
    )

    notification_id = create_notification(
        db=db,
        recipient_id=recipient_id,
        title=REMINDER_RULES[days_remaining],
        message=message,
        notification_type="event_reminder",
        category="events",
        related_id=str(event_id),
        related_type="event",
        metadata={
            "event_id": str(event_id),
            "event_name": event_name,
            "event_date": event_date.isoformat(),
            "start_time": start_time,
            "venue": venue_name,
            "days_remaining": days_remaining,
            "registration_id": registration_id,
            "destination": "events",
        },
        dedupe_key=dedupe_key,
    )

    if notification_id:
        logger.info(
            "Created %s-day reminder for attendee %s, event %s",
            days_remaining,
            recipient_id,
            event_id,
        )
        return True

    logger.debug(
        "Reminder not created for attendee %s, event %s. "
        "It may already exist or notification creation failed.",
        recipient_id,
        event_id,
    )

    return False


# ---------------------------------------------------------
# PROCESS ONE EVENT
# ---------------------------------------------------------

def process_single_event_reminders(
    db,
    event,
    current_time,
):
    """Process reminders for all registered attendees of one event."""

    result = {
        "processed": 0,
        "created": 0,
        "skipped": 0,
    }

    event_id = get_event_id(event)

    if not event_id:
        result["skipped"] += 1
        return result

    if not is_event_active(event):
        return result

    event_date = get_event_start_date(event)

    if not event_date:
        result["skipped"] += 1
        return result

    days_remaining = (
        event_date - current_time.date()
    ).days

    # Only generate reminders on the configured reminder days.
    if days_remaining not in REMINDER_RULES:
        return result

    # Do not send reminders after a multi-day event has ended.
    event_end_datetime = get_event_end_datetime(
        event,
        event_date,
    )

    if current_time >= event_end_datetime:
        logger.debug(
            "Skipping reminders for completed event %s",
            event_id,
        )
        return result

    attendees = db["attendees"].find(
        get_event_registration_query(event_id)
    )

    for attendee in attendees:
        try:
            result["processed"] += 1

            created = send_attendee_event_reminder(
                db=db,
                event=event,
                attendee=attendee,
                event_id=event_id,
                event_date=event_date,
                days_remaining=days_remaining,
            )

            if created:
                result["created"] += 1
            else:
                result["skipped"] += 1

        except Exception:
            result["skipped"] += 1

            logger.exception(
                "Failed to create reminder for attendee %s "
                "and event %s",
                attendee.get("_id"),
                event_id,
            )

    return result


# ---------------------------------------------------------
# GENERATE EVENT REMINDERS
# ---------------------------------------------------------

def process_event_reminders(db, now=None):
    """
    Check eligible events and generate due attendee reminders.

    Reminder schedule:
        7 days before event
        3 days before event
        1 day before event
        On the event day

    The scheduler can safely call this function every 30 minutes.
    The dedupe_key prevents duplicate notifications.
    """

    current_time = get_current_ist_time(now)

    totals = {
        "processed": 0,
        "created": 0,
        "skipped": 0,
    }

    try:
        events = db["events"].find({
            "status": {
                "$in": ACTIVE_EVENT_STATUSES,
            }
        })

        for event in events:
            try:
                event_result = process_single_event_reminders(
                    db=db,
                    event=event,
                    current_time=current_time,
                )

                for key in totals:
                    totals[key] += event_result[key]

            except Exception:
                totals["skipped"] += 1

                logger.exception(
                    "Failed to process reminders for event %s",
                    event.get("_id"),
                )

    except PyMongoError:
        logger.exception(
            "Unable to retrieve events for reminder processing."
        )
        raise

    except Exception:
        logger.exception(
            "Unexpected error during event reminder processing."
        )
        raise

    logger.info(
        "Event reminder processing completed at %s: %s",
        current_time.isoformat(),
        totals,
    )

    return totals