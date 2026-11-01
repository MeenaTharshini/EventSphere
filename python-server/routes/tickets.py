# python-server/routes/tickets.py

import base64
import io
import secrets
from datetime import datetime, timezone
from typing import Any

import qrcode
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError, PyMongoError

from .auth import get_current_user


router = APIRouter(
    prefix="/api/tickets",
    tags=["Digital Tickets"],
)


# ---------------------------------------------------------
# HELPERS
# ---------------------------------------------------------

def utc_now() -> datetime:
    """Return the current UTC time."""
    return datetime.now(timezone.utc)


def normalize_email(value: Any) -> str:
    """Normalize an email address safely."""
    if not isinstance(value, str):
        return ""

    return value.strip().lower()


def to_json_value(value: Any) -> Any:
    """Convert common MongoDB/Python values to JSON-safe values."""

    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)

        return value.isoformat()

    if isinstance(value, ObjectId):
        return str(value)

    if isinstance(value, dict):
        return {
            str(key): to_json_value(item)
            for key, item in value.items()
            if key != "_id"
        }

    if isinstance(value, list):
        return [to_json_value(item) for item in value]

    return value


def create_qr_data(ticket_id: str) -> str:
    """
    Generate a QR code containing the ticket ID.

    Returns a PNG data URI that can be displayed directly
    by the frontend.
    """

    image = qrcode.make(ticket_id)

    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    encoded = base64.b64encode(
        buffer.getvalue()
    ).decode("utf-8")

    return f"data:image/png;base64,{encoded}"


def get_event_name(
    event: dict,
    attendee: dict | None = None,
) -> str:
    """Get the event name from supported event fields."""

    attendee = attendee or {}

    return str(
        event.get("name")
        or event.get("title")
        or event.get("event_name")
        or attendee.get("event_name")
        or "Event"
    )


def get_event_date(event: dict) -> str:
    """Get and normalize the event date."""

    value = (
        event.get("date")
        or event.get("event_date")
        or event.get("start_date")
        or event.get("start_datetime")
        or ""
    )

    if isinstance(value, datetime):
        if value.tzinfo is None:
            value = value.replace(tzinfo=timezone.utc)

        return value.isoformat()

    if value is None:
        return ""

    return str(value)


def get_venue(event: dict) -> str:
    """Convert supported venue formats into a displayable string."""

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


def get_ticket_or_404(db, ticket_id: str) -> dict:
    """Find a ticket by its public ticket ID."""

    ticket_id = ticket_id.strip()

    if not ticket_id:
        raise HTTPException(
            status_code=400,
            detail="Ticket ID is required.",
        )

    try:
        ticket = db["tickets"].find_one(
            {"ticket_id": ticket_id}
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve the ticket.",
        )

    if not ticket:
        raise HTTPException(
            status_code=404,
            detail="Ticket not found.",
        )

    return ticket


def require_organizer_or_admin(user: dict) -> None:
    """Restrict ticket management actions to organizers and admins."""

    if user.get("role") not in {"Organizer", "Admin"}:
        raise HTTPException(
            status_code=403,
            detail="Only organizers or admins can perform this action.",
        )


# ---------------------------------------------------------
# CREATE TICKET
#
# Called from attendees.py after registration is saved.
# ---------------------------------------------------------

def create_ticket_for_registration(
    db,
    registration_id,
    attendee: dict,
    event: dict,
) -> dict:
    """
    Create one ticket for an existing registration.

    Returns an existing ticket if one has already been created
    for the registration.

    This function is imported by attendees.py.
    """

    registration_id = str(registration_id)

    try:
        # Prevent duplicate tickets for one registration.
        existing = db["tickets"].find_one(
            {"registration_id": registration_id}
        )

        if existing:
            return existing

        attendee_email = normalize_email(
            attendee.get("email")
        )

        ticket_data = {
            "registration_id": registration_id,

            "attendee_id": str(
                attendee.get("attendee_id")
                or attendee.get("user_id")
                or registration_id
            ),

            "attendee_email": attendee_email,

            "attendee_name": str(
                attendee.get("name")
                or attendee.get("attendee_name")
                or attendee.get("full_name")
                or "Attendee"
            ),

            "event_id": str(
                event.get("_id")
                or event.get("event_id")
                or attendee.get("event_id")
                or ""
            ),

            "event_name": get_event_name(
                event,
                attendee,
            ),

            "event_date": get_event_date(event),

            "venue": get_venue(event),

            "category": str(
                attendee.get("category") or "General"
            ),

            "status": "Valid",

            "created_at": utc_now(),

            "checked_in_at": None,
        }

        # Generate a unique ticket ID.
        # Retry if a randomly generated ID already exists.
        for _ in range(5):

            ticket_id = (
                f"EVT-{secrets.token_hex(4).upper()}"
            )

            ticket = {
                **ticket_data,
                "ticket_id": ticket_id,
                "qr_code": create_qr_data(ticket_id),
            }

            try:
                db["tickets"].insert_one(ticket)

                return ticket

            except DuplicateKeyError:

                # A concurrent request may have created
                # the ticket for this registration.
                existing = db["tickets"].find_one(
                    {"registration_id": registration_id}
                )

                if existing:
                    return existing

                # Otherwise, retry with a different ticket ID.

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to create the ticket. Please try again.",
        )

    raise HTTPException(
        status_code=503,
        detail="Could not generate a unique ticket. Please try again.",
    )


# ---------------------------------------------------------
# SERIALIZE TICKET
# ---------------------------------------------------------

def serialize_ticket(ticket: dict) -> dict:
    """
    Return consistent JSON-safe fields for the frontend.

    The Attendance.jsx page uses these fields to display
    attendee information, event details, ticket status,
    QR code, and check-in time.
    """

    return {
        "ticket_id": str(
            ticket.get("ticket_id") or ""
        ),

        "registration_id": str(
            ticket.get("registration_id") or ""
        ),

        "attendee_id": str(
            ticket.get("attendee_id") or ""
        ),

        "attendee_name": str(
            ticket.get("attendee_name") or "Attendee"
        ),

        "attendee_email": normalize_email(
            ticket.get("attendee_email")
        ),

        "event_id": str(
            ticket.get("event_id") or ""
        ),

        "event_name": str(
            ticket.get("event_name") or "Event"
        ),

        "event_date": to_json_value(
            ticket.get("event_date") or ""
        ),

        "venue": str(
            ticket.get("venue") or ""
        ),

        "category": str(
            ticket.get("category") or "General"
        ),

        "status": str(
            ticket.get("status") or "Valid"
        ),

        "qr_code": ticket.get("qr_code") or "",

        "created_at": to_json_value(
            ticket.get("created_at")
        ),

        "checked_in_at": to_json_value(
            ticket.get("checked_in_at")
        ),
    }


# ---------------------------------------------------------
# VERIFY TICKET
#
# GET /api/tickets/verify/{ticket_id}
# ---------------------------------------------------------

@router.get("/verify/{ticket_id}")
def verify_ticket(
    ticket_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Validate a ticket before check-in.

    Valid ticket:
        valid = True

    Used, cancelled, or unknown status:
        valid = False
    """

    require_organizer_or_admin(current_user)

    db = request.app.state.db

    ticket = get_ticket_or_404(
        db,
        ticket_id,
    )

    status = str(
        ticket.get("status") or "Valid"
    ).strip().lower()

    is_valid = status == "valid"

    return {
        "success": True,
        "valid": is_valid,
        "message": (
            "Ticket is valid."
            if is_valid
            else f"Ticket is {status}."
        ),
        "ticket": serialize_ticket(ticket),
    }


# ---------------------------------------------------------
# CHECK IN
#
# POST /api/tickets/{ticket_id}/check-in
# ---------------------------------------------------------

@router.post("/{ticket_id}/check-in")
def check_in_ticket(
    ticket_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Record attendance for a valid ticket.

    Uses a conditional MongoDB update to prevent
    duplicate check-ins, including concurrent requests.
    """

    require_organizer_or_admin(current_user)

    db = request.app.state.db

    ticket = get_ticket_or_404(
        db,
        ticket_id,
    )

    status = str(
        ticket.get("status") or "Valid"
    ).strip().lower()

    if status == "cancelled":
        raise HTTPException(
            status_code=409,
            detail="Ticket is cancelled.",
        )

    if status == "used":
        raise HTTPException(
            status_code=409,
            detail="Ticket has already been checked in.",
        )

    if status != "valid":
        raise HTTPException(
            status_code=409,
            detail="Ticket is not valid for check-in.",
        )

    now = utc_now()

    try:
        result = db["tickets"].update_one(
            {
                "_id": ticket["_id"],
                "status": "Valid",
            },
            {
                "$set": {
                    "status": "Used",
                    "checked_in_at": now,
                }
            },
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to check in the attendee.",
        )

    # Another request may have checked in or cancelled
    # the ticket between retrieval and this update.
    if result.modified_count != 1:
        raise HTTPException(
            status_code=409,
            detail="Ticket status changed. Please verify it again.",
        )

    ticket["status"] = "Used"
    ticket["checked_in_at"] = now

    return {
        "success": True,
        "message": "Attendee checked in successfully.",
        "ticket": serialize_ticket(ticket),
    }


# ---------------------------------------------------------
# CANCEL TICKET
#
# PATCH /api/tickets/{ticket_id}/cancel
# ---------------------------------------------------------

@router.patch("/{ticket_id}/cancel")
def cancel_ticket(
    ticket_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Cancel a valid ticket.

    A checked-in ticket cannot be cancelled.
    """

    require_organizer_or_admin(current_user)

    db = request.app.state.db

    ticket = get_ticket_or_404(
        db,
        ticket_id,
    )

    status = str(
        ticket.get("status") or "Valid"
    ).strip().lower()

    if status == "used":
        raise HTTPException(
            status_code=409,
            detail="A checked-in ticket cannot be cancelled.",
        )

    if status == "cancelled":
        return {
            "success": True,
            "message": "Ticket is already cancelled.",
            "ticket": serialize_ticket(ticket),
        }

    if status != "valid":
        raise HTTPException(
            status_code=409,
            detail="Ticket cannot be cancelled in its current state.",
        )

    try:
        result = db["tickets"].update_one(
            {
                "_id": ticket["_id"],
                "status": "Valid",
            },
            {
                "$set": {
                    "status": "Cancelled",
                }
            },
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to cancel the ticket.",
        )

    if result.modified_count != 1:
        raise HTTPException(
            status_code=409,
            detail="Ticket status changed. Please refresh and try again.",
        )

    ticket["status"] = "Cancelled"

    return {
        "success": True,
        "message": "Ticket cancelled successfully.",
        "ticket": serialize_ticket(ticket),
    }


# ---------------------------------------------------------
# GET A SINGLE TICKET
#
# GET /api/tickets/{ticket_id}
# ---------------------------------------------------------

@router.get("/{ticket_id}")
def get_ticket(
    ticket_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Retrieve one ticket.

    Attendees can only view their own tickets.
    Organizers and admins can view any ticket.
    """

    db = request.app.state.db

    ticket = get_ticket_or_404(
        db,
        ticket_id,
    )

    role = current_user.get("role")

    if role == "Attendee":

        user_email = normalize_email(
            current_user.get("email")
        )

        ticket_email = normalize_email(
            ticket.get("attendee_email")
        )

        if not user_email or user_email != ticket_email:
            raise HTTPException(
                status_code=403,
                detail="Access denied.",
            )

    elif role not in {"Organizer", "Admin"}:

        raise HTTPException(
            status_code=403,
            detail="Access denied.",
        )

    return {
        "success": True,
        "ticket": serialize_ticket(ticket),
    }


# ---------------------------------------------------------
# GET TICKETS
#
# GET /api/tickets
#
# Attendee:
#     Sees their own tickets.
#
# Organizer/Admin:
#     Sees all tickets for attendance management.
# ---------------------------------------------------------

@router.get("")
def get_my_tickets(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    """
    Retrieve tickets based on the logged-in user's role.
    """

    role = current_user.get("role")

    db = request.app.state.db

    if role == "Attendee":

        email = normalize_email(
            current_user.get("email")
        )

        if not email:
            raise HTTPException(
                status_code=401,
                detail="Unable to identify your account email.",
            )

        query = {
            "attendee_email": email,
        }

    elif role in {"Organizer", "Admin"}:

        query = {}

    else:

        raise HTTPException(
            status_code=403,
            detail="You are not authorized to view these tickets.",
        )

    try:
        tickets = list(
            db["tickets"]
            .find(query)
            .sort("created_at", -1)
        )

    except PyMongoError:
        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve tickets.",
        )

    serialized_tickets = [
        serialize_ticket(ticket)
        for ticket in tickets
    ]

    return {
        "success": True,
        "tickets": serialized_tickets,
        "count": len(serialized_tickets),
    }