
import re
from datetime import datetime, timezone, timedelta

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo.errors import DuplicateKeyError, PyMongoError

from .auth import get_current_user
from .tickets import create_ticket_for_registration
from .notifications import create_notification


router = APIRouter(
    prefix="/api/attendees",
    tags=["Attendee Registration"],
)

CATEGORIES = {
    "General",
    "VIP",
    "Speaker",
    "Volunteer",
    "Guest",
    "Sponsor",
}

IST = timezone(timedelta(hours=5, minutes=30))


# ---------------------------------------------------------
# REQUEST MODEL
# ---------------------------------------------------------

class AttendeeRegistration(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="forbid",
    )

    name: str = Field(min_length=2, max_length=150)
    email: str = Field(min_length=5, max_length=254)
    phone: str = Field(min_length=7, max_length=20)
    event_id: str = Field(min_length=24, max_length=24)
    category: str = Field(min_length=1, max_length=30)

    @field_validator("name")
    @classmethod
    def validate_name(cls, value: str) -> str:
        value = value.strip()

        if len(value) < 2 or not any(c.isalpha() for c in value):
            raise ValueError("Enter a valid full name.")

        return value

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

    @field_validator("event_id")
    @classmethod
    def validate_event_id(cls, value: str) -> str:
        value = value.strip()

        if not ObjectId.is_valid(value):
            raise ValueError("Please select a valid event.")

        return value

    @field_validator("category", mode="before")
    @classmethod
    def validate_category(cls, value) -> str:
        if not isinstance(value, str):
            raise ValueError("Select a valid attendee category.")

        allowed = {
            category.casefold(): category
            for category in CATEGORIES
        }

        normalized = value.strip().casefold()

        if normalized not in allowed:
            raise ValueError(
                "Select General, VIP, Speaker, Volunteer, Guest, or Sponsor."
            )

        return allowed[normalized]


# ---------------------------------------------------------
# COMMON HELPERS
# ---------------------------------------------------------

def require_attendee(user: dict) -> None:
    """
    Any authenticated account can register as an attendee.
    Organizer and Vendor accounts can also attend events.
    """

    if not user:
        raise HTTPException(
            status_code=401,
            detail="Authentication required.",
        )


def get_user_id(user: dict) -> str:
    return str(
        user.get("_id")
        or user.get("id")
        or ""
    ).strip()


def get_event_name(event: dict) -> str:
    return str(
        event.get("name")
        or event.get("title")
        or event.get("event_name")
        or "Event"
    )


def serialize_datetime(value) -> str | None:
    if value is None:
        return None

    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)

        return value.isoformat()

    return str(value)


def get_event_date(event: dict):
    value = (
        event.get("date")
        or event.get("event_date")
        or event.get("start_date")
        or event.get("start_datetime")
        or ""
    )

    if isinstance(value, datetime):
        return serialize_datetime(value)

    if value is None:
        return ""

    return str(value)


def get_event_venue(event: dict) -> str:
    value = (
        event.get("venue")
        or event.get("venue_name")
        or event.get("location")
        or ""
    )

    if isinstance(value, dict):
        value = (
            value.get("name")
            or value.get("venue_name")
            or value.get("address")
            or value.get("city")
            or ""
        )

    return str(value)


def send_attendee_notification(
    db,
    recipient_id: str,
    title: str,
    message: str,
    notification_type: str,
    category: str,
    related_id: str,
    related_type: str,
    metadata: dict | None = None,
) -> None:
    """
    Send a notification without interrupting the main operation.

    A notification failure must not undo a successful registration
    or cancellation.
    """

    if not recipient_id:
        print(
            "Notification skipped: recipient ID is missing."
        )
        return

    try:
        create_notification(
            db=db,
            recipient_id=recipient_id,
            title=title,
            message=message,
            notification_type=notification_type,
            category=category,
            related_id=related_id,
            related_type=related_type,
            metadata=metadata or {},
        )

    except Exception as exc:
        print(
            "Attendee notification failed. "
            f"Recipient: {recipient_id}; "
            f"Error: {type(exc).__name__}: {exc}"
        )


def parse_event_datetime(value) -> datetime | None:
    """
    Convert MongoDB datetime or ISO datetime strings
    into timezone-aware datetime values.

    Naive datetime values are treated as UTC.
    """

    if value is None:
        return None

    if isinstance(value, datetime):
        parsed = value

    elif isinstance(value, str):
        value = value.strip()

        if not value:
            return None

        try:
            parsed = datetime.fromisoformat(
                value.replace("Z", "+00:00")
            )
        except ValueError:
            return None

    else:
        return None

    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)

    return parsed



def is_event_over(event: dict) -> bool:
    """
    Determine whether an event has ended using the Events API fields.

    The event's ending date is end_date, falling back to event_date/date.
    Separate date and time values are interpreted in IST.
    """

    now = datetime.now(IST)

    # Prefer an explicitly stored end_datetime.
    end_datetime = event.get("end_datetime")

    if end_datetime:
        parsed = parse_event_datetime(end_datetime)

        if parsed:
            return parsed <= datetime.now(timezone.utc)

    # Use the event's ending date.
    date_value = (
        event.get("end_date")
        or event.get("event_date")
        or event.get("date")
    )

    if not date_value:
        return False

    # Handle datetime values.
    if isinstance(date_value, datetime):
        parsed = parse_event_datetime(date_value)

        if parsed:
            return parsed <= datetime.now(timezone.utc)

    else:
        date_text = str(date_value).strip()

        if not date_text:
            return False

        # Handle a complete ISO datetime.
        if "T" in date_text:
            parsed = parse_event_datetime(date_text)

            if parsed:
                return parsed <= datetime.now(timezone.utc)

        try:
            event_date = datetime.fromisoformat(
                date_text[:10]
            ).date()
        except ValueError:
            return False

        # Match the default end time used by routes/events.py.
        end_time_value = event.get("end_time") or "16:00"

        try:
            end_time = datetime.strptime(
                str(end_time_value).strip(),
                "%H:%M"
            ).time()
        except ValueError:
            try:
                end_time = datetime.strptime(
                    str(end_time_value).strip(),
                    "%H:%M:%S"
                ).time()
            except ValueError:
                return False

        event_end = datetime.combine(
            event_date,
            end_time,
            tzinfo=IST,
        )

        return event_end <= now

    return parsed <= datetime.now(timezone.utc)


def get_registration_event_id(
    registration: dict,
) -> ObjectId | None:
    stored_event_id = registration.get("event_id")

    if isinstance(stored_event_id, ObjectId):
        return stored_event_id

    if (
        isinstance(stored_event_id, str)
        and ObjectId.is_valid(stored_event_id)
    ):
        return ObjectId(stored_event_id)

    return None


# ---------------------------------------------------------
# GET ALL ATTENDEES FOR A SPECIFIC EVENT
# GET /api/attendees/event/{event_id}
# ---------------------------------------------------------

@router.get("/event/{event_id}")
def get_event_attendees(
    event_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Organizer:
        Can view attendees for their own events.

    Admin:
        Can view attendees for any event.
    """

    db = request.app.state.db

    attendees_collection = db["attendees"]
    events_collection = db["events"]
    tickets_collection = db["tickets"]

    # Validate event ID.
    if not ObjectId.is_valid(event_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid event ID.",
        )

    event_oid = ObjectId(event_id)

    # Fetch event.
    try:
        event = events_collection.find_one({
            "_id": event_oid
        })

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve event details.",
        )

    if not event:
        raise HTTPException(
            status_code=404,
            detail="Event not found.",
        )

    # Authorization.
    role = str(
        current_user.get("role", "")
    ).strip().lower()

    if role not in {"admin", "organizer"}:
        raise HTTPException(
            status_code=403,
            detail="Only organizers and admins can view event attendees.",
        )

    if role == "organizer":
        current_user_id = get_user_id(current_user)

        event_owner_id = str(
            event.get("organizer_id") or ""
        )

        if not current_user_id or event_owner_id != current_user_id:
            raise HTTPException(
                status_code=403,
                detail="You can only view attendees for your own events.",
            )

    # Fetch active registrations.
    try:
        attendee_records = list(
            attendees_collection.find({
                "event_id": event_id,
                "status": {
                    "$nin": ["Cancelled", "Canceled"]
                },
            }).sort("registered_at", -1)
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve event attendees.",
        )

    # Fetch associated tickets.
    results = []

    for attendee in attendee_records:
        registration_id = str(
            attendee.get("_id", "")
        )

        try:
            ticket = tickets_collection.find_one({
                "registration_id": registration_id
            })

        except PyMongoError:
            raise HTTPException(
                status_code=503,
                detail="Unable to retrieve attendee ticket details.",
            )

        ticket_data = None

        if ticket:
            ticket_data = {
                "ticket_id": ticket.get("ticket_id", ""),
                "status": ticket.get("status", "Valid"),
                "qr_code": ticket.get("qr_code", ""),
                "checked_in_at": serialize_datetime(
                    ticket.get("checked_in_at")
                ),
                "created_at": serialize_datetime(
                    ticket.get("created_at")
                ),
            }

        results.append({
            "attendee_id": registration_id,
            "registration_id": registration_id,
            "name": attendee.get("name", ""),
            "email": attendee.get("email", ""),
            "phone": attendee.get("phone", ""),
            "category": attendee.get("category", "General"),
            "registration_status": attendee.get(
                "status", "Registered"
            ),
            "registered_at": serialize_datetime(
                attendee.get("registered_at")
            ),
            "ticket": ticket_data,
        })

    return {
        "success": True,
        "event": {
            "id": event_id,
            "name": get_event_name(event),
            "date": serialize_datetime(
                get_event_date(event)
            ),
            "end_date": (
                event.get("end_date")
                or event.get("event_date")
                or event.get("date")
                or ""
            ),
            "start_time": event.get("start_time") or "",
            "end_time": event.get("end_time") or "",
            "venue": get_event_venue(event),
        },
        "attendees": results,
        "count": len(results),
    }


# ---------------------------------------------------------
# REGISTER FOR AN EVENT
# POST /api/attendees/register
# ---------------------------------------------------------

@router.post("/register", status_code=201)
def register_attendee(
    data: AttendeeRegistration,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    require_attendee(current_user)

    account_email = str(
        current_user.get("email", "")
    ).strip().lower()

    if not account_email:
        raise HTTPException(
            status_code=401,
            detail="Unable to identify your account email.",
        )

    submitted_email = data.email.strip().lower()

    if submitted_email != account_email:
        raise HTTPException(
            status_code=400,
            detail=(
                "The registration email must match your signed-in "
                "account email."
            ),
        )

    db = request.app.state.db

    attendees = db["attendees"]
    events = db["events"]
    tickets = db["tickets"]

    event_oid = ObjectId(data.event_id)

    # Find event.
    try:
        event = events.find_one({
            "_id": event_oid,
        })

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve event details.",
        )

    if not event:
        raise HTTPException(
            status_code=404,
            detail="The selected event does not exist.",
        )

    # Check event status.
    event_status = str(
        event.get("status", "")
    ).strip().lower()

    if event_status in {"cancelled", "canceled"}:
        raise HTTPException(
            status_code=409,
            detail="Registration is unavailable for this event.",
        )

    if is_event_over(event):
        raise HTTPException(
            status_code=409,
            detail="This event has already ended. Registration is closed.",
        )

    # Prevent duplicate registrations.
    try:
        attendees.create_index(
            [("event_id", 1), ("email", 1)],
            unique=True,
            name="unique_email_per_event",
        )

        existing_registration = attendees.find_one({
            "event_id": str(event_oid),
            "email": account_email,
        })

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Registration service is temporarily unavailable.",
        )

    # Prepare attendee data.
    attendee = {
        "name": str(
            current_user.get("name") or data.name
        ).strip(),
        "email": account_email,
        "phone": data.phone.strip(),
        "event_id": str(event_oid),
        "event_name": get_event_name(event),
        "category": data.category,
        "status": "Registered",
        "registered_at": datetime.now(timezone.utc),
    }

    # Reactivate or create registration.
    existing_ticket = None

    if existing_registration:
        existing_status = str(
            existing_registration.get("status", "")
        ).strip().lower()

        if existing_status != "cancelled":
            raise HTTPException(
                status_code=409,
                detail="You are already registered for this event.",
            )

        registration_id = existing_registration["_id"]

        # Retrieve existing ticket.
        try:
            existing_ticket = tickets.find_one({
                "registration_id": str(registration_id),
            })

        except PyMongoError:
            raise HTTPException(
                status_code=503,
                detail="Unable to retrieve your existing ticket.",
            )

        # Do not reactivate a ticket already used for check-in.
        if (
            existing_ticket
            and str(
                existing_ticket.get("status", "")
            ).strip().lower() == "used"
        ):
            raise HTTPException(
                status_code=409,
                detail=(
                    "This ticket has already been used. "
                    "Please contact the event organizer."
                ),
            )

        # Reactivate existing attendee document.
        try:
            result = attendees.update_one(
                {
                    "_id": registration_id,
                    "status": "Cancelled",
                },
                {
                    "$set": attendee,
                    "$unset": {
                        "cancelled_at": "",
                    },
                },
            )

            if result.modified_count != 1:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Registration status changed. "
                        "Please refresh and try again."
                    ),
                )

        except HTTPException:
            raise

        except PyMongoError:
            raise HTTPException(
                status_code=503,
                detail="Could not reactivate your registration.",
            )

    else:
        # Create new attendee document.
        try:
            result = attendees.insert_one(attendee)
            registration_id = result.inserted_id

        except DuplicateKeyError:
            raise HTTPException(
                status_code=409,
                detail="You are already registered for this event.",
            )

        except PyMongoError:
            raise HTTPException(
                status_code=503,
                detail="Could not save your registration. Please try again.",
            )

    # Update event attendee count.
    try:
        events.update_one(
            {
                "_id": event_oid,
            },
            {
                "$inc": {
                    "attendee_count": 1,
                }
            },
        )

    except PyMongoError as exc:
        print(
            "Attendee count update failed: "
            f"{type(exc).__name__}: {exc}"
        )

    # Generate or reactivate digital ticket.
    ticket = None
    ticket_error = None

    try:
        if existing_ticket:
            # Reactivate the same ticket.
            ticket_update = tickets.update_one(
                {
                    "_id": existing_ticket["_id"],
                    "registration_id": str(registration_id),
                },
                {
                    "$set": {
                        "status": "Valid",
                        "checked_in_at": None,
                    },
                    "$unset": {
                        "cancelled_at": "",
                    },
                },
            )

            if ticket_update.matched_count != 1:
                raise RuntimeError(
                    "Existing ticket could not be reactivated."
                )

            ticket = tickets.find_one({
                "_id": existing_ticket["_id"],
                "registration_id": str(registration_id),
            })

            if not ticket:
                raise RuntimeError(
                    "Reactivated ticket could not be retrieved."
                )

        else:
            # Generate a ticket only when one does not exist.
            ticket = create_ticket_for_registration(
                db=db,
                registration_id=registration_id,
                attendee=attendee,
                event=event,
            )

    except Exception as exc:
        ticket_error = type(exc).__name__

        print(
            "Ticket generation/reactivation failed. "
            f"Registration ID: {registration_id}; "
            f"Error: {type(exc).__name__}: {exc}"
        )

    # Build response.
    response = {
        "success": True,
        "message": "Registration completed successfully!",
        "attendee_id": str(registration_id),
        "event_id": str(event_oid),
        "event_name": attendee["event_name"],
        "category": attendee["category"],
        "status": attendee["status"],
        "ticket_created": ticket is not None,
        "ticket": None,
    }

    if ticket:
        response["ticket"] = {
            "ticket_id": ticket.get("ticket_id"),
            "status": ticket.get("status", "Valid"),
            "qr_code": ticket.get("qr_code", ""),
        }

        response["message"] = (
            "Registration completed and digital ticket generated!"
        )

    else:
        response["ticket_error"] = ticket_error

        response["message"] = (
            "Registration completed, but ticket generation failed. "
            "Please contact the event organizer."
        )

    # -----------------------------------------------------
    # NOTIFY ATTENDEE ABOUT SUCCESSFUL REGISTRATION
    # This is deliberately AFTER registration and ticket
    # processing, not inside the event-over condition.
    # -----------------------------------------------------

    send_attendee_notification(
        db=db,
        recipient_id=get_user_id(current_user),
        title="Registration successful",
        message=(
            f"You are registered for "
            f"{attendee['event_name']}."
        ),
        notification_type="success",
        category="registration",
        related_id=str(registration_id),
        related_type="attendee_registration",
        metadata={
            "event_id": str(event_oid),
            "event_name": attendee["event_name"],
            "ticket_created": ticket is not None,
        },
    )

    return response


# ---------------------------------------------------------
# GET THE LOGGED-IN ATTENDEE'S REGISTRATIONS
# GET /api/attendees/my-registrations
# ---------------------------------------------------------

@router.get("/my-registrations")
def get_my_registrations(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    require_attendee(current_user)

    account_email = str(
        current_user.get("email", "")
    ).strip().lower()

    if not account_email:
        raise HTTPException(
            status_code=401,
            detail="Unable to identify your account email.",
        )

    db = request.app.state.db

    attendees = db["attendees"]
    events = db["events"]

    try:
        registrations = list(
            attendees.find({
                "email": account_email,
            }).sort("registered_at", -1)
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve your registrations.",
        )

    results = []

    for registration in registrations:
        event_oid = get_registration_event_id(registration)
        event = None

        # Retrieve event details.
        try:
            if event_oid:
                event = events.find_one({
                    "_id": event_oid,
                })

        except PyMongoError:
            raise HTTPException(
                status_code=503,
                detail="Unable to retrieve event details.",
            )

        event_name = (
            get_event_name(event)
            if event
            else registration.get("event_name", "Event")
        )

        event_date = get_event_date(event) if event else ""
        venue = get_event_venue(event) if event else ""

        # Retrieve associated ticket.
        ticket_info = None

        try:
            ticket = db["tickets"].find_one({
                "registration_id": str(
                    registration["_id"]
                )
            })

            if ticket:
                ticket_info = {
                    "ticket_id": ticket.get("ticket_id"),
                    "status": ticket.get("status", "Valid"),
                    "qr_code": ticket.get("qr_code", ""),
                    "created_at": serialize_datetime(
                        ticket.get("created_at")
                    ),
                    "checked_in_at": serialize_datetime(
                        ticket.get("checked_in_at")
                    ),
                }

        except PyMongoError:
            raise HTTPException(
                status_code=503,
                detail="Unable to retrieve ticket details.",
            )

        results.append({
            "id": str(registration["_id"]),
            "attendee_id": str(registration["_id"]),
            "event_id": str(
                registration.get("event_id") or ""
            ),
            "event_name": event_name,
            "category": registration.get("category", "General"),
            "status": registration.get("status", "Registered"),
            "registered_at": serialize_datetime(
                registration.get("registered_at")
            ),
            "date": event_date,
            "venue": venue,
            "ticket": ticket_info,
        })

    return {
        "success": True,
        "registrations": results,
        "count": len(results),
    }


# ---------------------------------------------------------
# CANCEL / UNREGISTER FROM AN EVENT
# DELETE /api/attendees/registrations/{registration_id}
# ---------------------------------------------------------

@router.delete("/registrations/{registration_id}")
def unregister_attendee(
    registration_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    require_attendee(current_user)

    account_email = str(
        current_user.get("email", "")
    ).strip().lower()

    if not account_email:
        raise HTTPException(
            status_code=401,
            detail="Unable to identify your account email.",
        )

    if not ObjectId.is_valid(registration_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid registration ID.",
        )

    db = request.app.state.db

    attendees = db["attendees"]
    events = db["events"]
    tickets = db["tickets"]

    registration_oid = ObjectId(registration_id)

    # Verify registration ownership.
    try:
        registration = attendees.find_one({
            "_id": registration_oid,
            "email": account_email,
        })

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve your registration.",
        )

    if not registration:
        raise HTTPException(
            status_code=404,
            detail="Registration not found.",
        )

    if str(
        registration.get("status", "")
    ).strip().lower() == "cancelled":
        raise HTTPException(
            status_code=409,
            detail="This registration has already been cancelled.",
        )

    # Mark registration as cancelled.
    try:
        result = attendees.update_one(
            {
                "_id": registration_oid,
                "email": account_email,
                "status": {"$ne": "Cancelled"},
            },
            {
                "$set": {
                    "status": "Cancelled",
                    "cancelled_at": datetime.now(timezone.utc),
                }
            },
        )

        if result.modified_count == 0:
            raise HTTPException(
                status_code=409,
                detail="This registration has already been cancelled.",
            )

        # Decrease event attendee count.
        event_oid = get_registration_event_id(registration)

        if event_oid:
            events.update_one(
                {
                    "_id": event_oid,
                    "attendee_count": {"$gt": 0},
                },
                {
                    "$inc": {
                        "attendee_count": -1,
                    }
                },
            )

        # Cancel associated digital ticket.
        tickets.update_one(
            {
                "registration_id": str(registration_oid),
            },
            {
                "$set": {
                    "status": "Cancelled",
                    "cancelled_at": datetime.now(timezone.utc),
                }
            },
        )

    except HTTPException:
        raise

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to cancel your registration. Please try again.",
        )

    # -----------------------------------------------------
    # NOTIFY ATTENDEE ABOUT CANCELLATION
    # This is deliberately AFTER the cancellation succeeds.
    # -----------------------------------------------------

    send_attendee_notification(
        db=db,
        recipient_id=get_user_id(current_user),
        title="Registration cancelled",
        message=(
            f"Your registration for "
            f"{registration.get('event_name', 'the event')} "
            f"has been cancelled."
        ),
        notification_type="warning",
        category="registration",
        related_id=str(registration_oid),
        related_type="attendee_registration",
        metadata={
            "event_id": str(
                registration.get("event_id") or ""
            ),
            "event_name": registration.get(
                "event_name", "Event"
            ),
        },
    )

    return {
        "success": True,
        "message": "Registration cancelled successfully.",
        "registration_id": str(registration_oid),
        "status": "Cancelled",
    }
