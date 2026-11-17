
import logging
from datetime import date, datetime
from zoneinfo import ZoneInfo

from routes.notifications import create_notification
from pymongo.errors import PyMongoError

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


# ---------------------------------------------------------
# DATE HELPER
# ---------------------------------------------------------

def get_event_start_date(event):
    """
    Read the event_date field used by EventSphere.

    Event dates are currently stored as YYYY-MM-DD strings.
    """

    value = event.get("event_date") or event.get("date")

    if isinstance(value, datetime):
        return value.astimezone(IST).date() if value.tzinfo else value.date()

    if isinstance(value, date):
        return value

    if not value:
        return None

    try:
        return date.fromisoformat(str(value).strip()[:10])
    except ValueError:
        logger.warning(
            "Invalid event date for event %s: %s",
            event.get("_id"),
            value,
        )
        return None


# ---------------------------------------------------------
# RECIPIENT LOOKUP
# ---------------------------------------------------------

def get_attendee_user_id(db, attendee):
    """
    Resolve the registered attendee to a MongoDB user ID.

    New registrations use user_id.
    Older registrations fall back to account email.
    """

    user_id = attendee.get("user_id")

    if user_id:
        return str(user_id)

    email = str(attendee.get("email") or "").strip().lower()

    if not email:
        return None

    user = db["users"].find_one({
        "email": email,
    })

    if not user:
        return None

    return str(user["_id"])


# ---------------------------------------------------------
# GENERATE EVENT REMINDERS
# ---------------------------------------------------------


def process_event_reminders(db, now=None):
    """
    Check eligible events and generate due attendee reminders.

    Runs every 30 minutes through APScheduler.
    """

    current_time = now or datetime.now(IST)

    if current_time.tzinfo is None:
        current_time = current_time.replace(tzinfo=IST)
    else:
        current_time = current_time.astimezone(IST)

    today = current_time.date()

    created_count = 0
    processed_count = 0
    skipped_count = 0

    try:
        events = db["events"].find({
            "status": {
                "$in": ["Scheduled", "Confirmed"]
            }
        })

        for event in events:
            try:
                event_id = str(event.get("_id", ""))

                if not event_id:
                    skipped_count += 1
                    continue

                event_date = get_event_start_date(event)

                if not event_date:
                    skipped_count += 1
                    continue

                days_remaining = (event_date - today).days

                if days_remaining not in REMINDER_RULES:
                    continue

                event_name = (
                    event.get("name")
                    or event.get("title")
                    or "Your event"
                )

                start_time = event.get("start_time") or "10:00"
                end_time = event.get("end_time") or "16:00"

                venue_name = (
                    event.get("venue_name")
                    or event.get("venue")
                    or "Venue not specified"
                )

                # Do not send an event-day reminder after
                # the event's scheduled end time.
                if days_remaining == 0:
                    try:
                        event_end = datetime.strptime(
                            str(end_time).strip(),
                            "%H:%M",
                        ).time()

                        if current_time.time() >= event_end:
                            continue

                    except ValueError:
                        logger.warning(
                            "Invalid end time for event %s: %s",
                            event_id,
                            end_time,
                        )

                if days_remaining == 0:
                    message = (
                        f"{event_name} is happening today "
                        f"at {start_time}. "
                        f"Venue: {venue_name}."
                    )
                else:
                    message = (
                        f"{event_name} is happening in "
                        f"{days_remaining} days, on "
                        f"{event_date.isoformat()} at "
                        f"{start_time}. Venue: {venue_name}."
                    )

                attendees = db["attendees"].find({
                    "event_id": event_id,
                    "status": "Registered",
                })

                for attendee in attendees:
                    try:
                        recipient_id = get_attendee_user_id(
                            db,
                            attendee,
                        )

                        if not recipient_id:
                            skipped_count += 1

                            logger.warning(
                                "No account found for attendee %s",
                                attendee.get("_id"),
                            )
                            continue

                        registration_id = str(
                            attendee.get("_id", "")
                        )

                        registered_at = attendee.get(
                            "registered_at"
                        )

                        registration_version = (
                            registered_at.isoformat()
                            if isinstance(registered_at, datetime)
                            else str(
                                registered_at or registration_id
                            )
                        )

                        dedupe_key = (
                            f"event_reminder:{event_id}:"
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
                            related_id=event_id,
                            related_type="event",
                            metadata={
                                "event_id": event_id,
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

                        processed_count += 1

                        if notification_id:
                            created_count += 1

                    except Exception:
                        skipped_count += 1

                        logger.exception(
                            "Failed to process attendee %s for event %s",
                            attendee.get("_id"),
                            event_id,
                        )

            except Exception:
                skipped_count += 1

                logger.exception(
                    "Failed to process event %s",
                    event.get("_id"),
                )

    except PyMongoError:
        logger.exception(
            "Unable to retrieve events for reminder processing."
        )

        raise

    result = {
        "processed": processed_count,
        "created": created_count,
        "skipped": skipped_count,
    }

    logger.info(
        "Reminder processing completed: %s",
        result,
    )

    return result
