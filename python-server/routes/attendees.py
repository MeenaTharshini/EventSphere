
import re
from datetime import datetime, timezone

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator
from pymongo.errors import DuplicateKeyError, PyMongoError

from .auth import get_current_user
from .tickets import create_ticket_for_registration


router = APIRouter(
    prefix="/api/attendees",
    tags=["Attendee Registration"],
)

CATEGORIES = {"General", "VIP", "Speaker", "Volunteer"}


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
                "Select General, VIP, Speaker, or Volunteer."
            )

        return allowed[normalized]


# ---------------------------------------------------------
# HELPERS
# ---------------------------------------------------------

def require_attendee(user: dict) -> None:
    if user.get("role") != "Attendee":
        raise HTTPException(
            status_code=403,
            detail="Only attendees can use attendee registration.",
        )


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

    # The registration email must match the authenticated account.
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

    event_oid = ObjectId(data.event_id)

    # -----------------------------------------------------
    # FIND EVENT
    # -----------------------------------------------------

    try:
        event = events.find_one({"_id": event_oid})

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

    if str(event.get("status", "")).strip().lower() in {
        "cancelled",
        "canceled",
    }:
        raise HTTPException(
            status_code=409,
            detail="Registration is unavailable for this event.",
        )

    # -----------------------------------------------------
    # PREVENT DUPLICATE REGISTRATIONS
    # -----------------------------------------------------

    try:
        attendees.create_index(
            [("event_id", 1), ("email", 1)],
            unique=True,
            name="unique_email_per_event",
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Registration service is temporarily unavailable.",
        )

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

    # -----------------------------------------------------
    # SAVE REGISTRATION
    # -----------------------------------------------------

    try:
        result = attendees.insert_one(attendee)

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

    registration_id = result.inserted_id

    # -----------------------------------------------------
    # UPDATE EVENT ATTENDEE COUNT
    # -----------------------------------------------------

    try:
        events.update_one(
            {"_id": event_oid},
            {"$inc": {"attendee_count": 1}},
        )

    except PyMongoError:
        # Registration has already been saved.
        pass

    # -----------------------------------------------------
    # GENERATE DIGITAL TICKET AND QR CODE
    # -----------------------------------------------------

    ticket = None
    ticket_error = None

    try:
        ticket = create_ticket_for_registration(
            db=db,
            registration_id=registration_id,
            attendee=attendee,
            event=event,
        )

    except Exception as exc:
        # Do not claim that registration failed: it is already saved.
        # Log the failure so the missing ticket can be investigated.
        ticket_error = type(exc).__name__

        print(
            "Ticket generation failed. "
            f"Registration ID: {registration_id}; "
            f"Error: {type(exc).__name__}: {exc}"
        )

    # -----------------------------------------------------
    # REGISTRATION RESPONSE
    # -----------------------------------------------------

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
            "ticket_id": ticket["ticket_id"],
            "status": ticket["status"],
            "qr_code": ticket["qr_code"],
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
            attendees.find(
                {"email": account_email}
            ).sort("registered_at", -1)
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve your registrations.",
        )

    results = []

    for registration in registrations:
        stored_event_id = registration.get("event_id")
        event = None

        # -------------------------------------------------
        # RETRIEVE EVENT DETAILS
        # -------------------------------------------------

        try:
            if isinstance(stored_event_id, ObjectId):
                event = events.find_one(
                    {"_id": stored_event_id}
                )

            elif (
                isinstance(stored_event_id, str)
                and ObjectId.is_valid(stored_event_id)
            ):
                event = events.find_one(
                    {"_id": ObjectId(stored_event_id)}
                )

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

        # -------------------------------------------------
        # FIND ASSOCIATED DIGITAL TICKET
        # -------------------------------------------------

        ticket_info = None

        try:
            ticket = db["tickets"].find_one(
                {"registration_id": str(registration["_id"])}
            )

            if ticket:
                ticket_info = {
                    "ticket_id": ticket.get("ticket_id"),
                    "status": ticket.get("status"),
                }

        except PyMongoError:
            raise HTTPException(
                status_code=503,
                detail="Unable to retrieve ticket details.",
            )

        # -------------------------------------------------
        # APPEND REGISTRATION TO RESPONSE
        # -------------------------------------------------

        results.append({
            "id": str(registration["_id"]),
            "attendee_id": str(registration["_id"]),
            "event_id": str(stored_event_id or ""),
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