
import base64
import io
import secrets
from datetime import datetime, timezone

import qrcode
from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pymongo.errors import DuplicateKeyError, PyMongoError

from .auth import get_current_user

router = APIRouter(prefix="/api/tickets", tags=["Digital Tickets"])


def create_qr_data(ticket_id: str) -> str:
    """Generate a QR code containing the ticket ID."""
    image = qrcode.make(ticket_id)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")

    encoded = base64.b64encode(buffer.getvalue()).decode("utf-8")
    return f"data:image/png;base64,{encoded}"


def create_ticket_for_registration(
    db,
    registration_id,
    attendee: dict,
    event: dict,
) -> dict:
    """
    Create one ticket for an existing registration.
    Called by the attendee registration endpoint.
    """
    registration_id = str(registration_id)

    existing = db["tickets"].find_one(
        {"registration_id": registration_id}
    )
    if existing:
        return existing

    event_id = str(event.get("_id", attendee.get("event_id", "")))
    event_date = (
        event.get("date")
        or event.get("event_date")
        or event.get("start_date")
        or event.get("start_datetime")
        or ""
    )

    if isinstance(event_date, datetime):
        if event_date.tzinfo is None:
            event_date = event_date.replace(tzinfo=timezone.utc)
        event_date = event_date.isoformat()
    elif event_date is not None:
        event_date = str(event_date)

    venue_value = (
        event.get("venue")
        or event.get("venue_name")
        or event.get("location")
        or ""
    )

    if isinstance(venue_value, dict):
        venue_value = (
            venue_value.get("name")
            or venue_value.get("venue_name")
            or venue_value.get("address")
            or venue_value.get("city")
            or ""
        )

    # Retry if a randomly generated ticket ID already exists.
    for _ in range(5):
        ticket_id = f"EVT-{secrets.token_hex(4).upper()}"

        ticket = {
            "ticket_id": ticket_id,
            "registration_id": registration_id,
            "attendee_id": registration_id,
            "attendee_email": attendee.get("email", "").strip().lower(),
            "attendee_name": attendee.get("name", "Attendee"),
            "event_id": event_id,
            "event_name": (
                event.get("name")
                or event.get("title")
                or event.get("event_name")
                or attendee.get("event_name")
                or "Event"
            ),
            "event_date": event_date,
            "venue": str(venue_value),
            "category": attendee.get("category", "General"),
            "status": "Valid",
            "created_at": datetime.now(timezone.utc),
            "checked_in_at": None,
        }

        ticket["qr_code"] = create_qr_data(ticket_id)

        try:
            db["tickets"].insert_one(ticket)
            return ticket

        except DuplicateKeyError:
            # A registration may have been processed concurrently.
            existing = db["tickets"].find_one(
                {"registration_id": registration_id}
            )
            if existing:
                return existing

            # Otherwise, retry with another ticket ID.

    raise HTTPException(
        status_code=503,
        detail="Could not generate a unique ticket. Please try again.",
    )


def serialize_ticket(ticket: dict) -> dict:
    """Convert MongoDB values to JSON-safe values."""
    return {
        "ticket_id": ticket["ticket_id"],
        "registration_id": ticket["registration_id"],
        "attendee_name": ticket["attendee_name"],
        "event_id": ticket["event_id"],
        "event_name": ticket["event_name"],
        "event_date": ticket["event_date"],
        "venue": ticket["venue"],
        "category": ticket["category"],
        "status": ticket["status"],
        "qr_code": ticket["qr_code"],
        "created_at": (
            ticket["created_at"].isoformat()
            if isinstance(ticket.get("created_at"), datetime)
            else ticket.get("created_at")
        ),
        "checked_in_at": (
            ticket["checked_in_at"].isoformat()
            if isinstance(ticket.get("checked_in_at"), datetime)
            else ticket.get("checked_in_at")
        ),
    }


def get_ticket_or_404(db, ticket_id: str) -> dict:
    ticket = db["tickets"].find_one({"ticket_id": ticket_id})
    if not ticket:
        raise HTTPException(status_code=404, detail="Ticket not found.")
    return ticket


def require_organizer_or_admin(user: dict):
    if user.get("role") not in {"Organizer", "Admin"}:
        raise HTTPException(
            status_code=403,
            detail="Only organizers or admins can perform this action.",
        )


# IMPORTANT: Keep the verify route before the /{ticket_id} route.
@router.get("/verify/{ticket_id}")
def verify_ticket(
    ticket_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    require_organizer_or_admin(current_user)
    db = request.app.state.db
    ticket = get_ticket_or_404(db, ticket_id)

    return {
        "success": True,
        "valid": ticket["status"] == "Valid",
        "ticket": serialize_ticket(ticket),
    }


@router.post("/{ticket_id}/check-in")
def check_in_ticket(
    ticket_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    require_organizer_or_admin(current_user)
    db = request.app.state.db
    ticket = get_ticket_or_404(db, ticket_id)

    if ticket["status"] == "Cancelled":
        raise HTTPException(status_code=409, detail="Ticket is cancelled.")

    if ticket["status"] == "Used":
        raise HTTPException(
            status_code=409,
            detail="Ticket has already been used.",
        )

    now = datetime.now(timezone.utc)
    result = db["tickets"].update_one(
        {"_id": ticket["_id"], "status": "Valid"},
        {
            "$set": {
                "status": "Used",
                "checked_in_at": now,
            }
        },
    )

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


@router.patch("/{ticket_id}/cancel")
def cancel_ticket(
    ticket_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    require_organizer_or_admin(current_user)
    db = request.app.state.db
    ticket = get_ticket_or_404(db, ticket_id)

    if ticket["status"] == "Used":
        raise HTTPException(
            status_code=409,
            detail="A checked-in ticket cannot be cancelled.",
        )

    if ticket["status"] == "Cancelled":
        return {
            "success": True,
            "message": "Ticket is already cancelled.",
            "ticket": serialize_ticket(ticket),
        }

    db["tickets"].update_one(
        {"_id": ticket["_id"], "status": "Valid"},
        {"$set": {"status": "Cancelled"}},
    )

    ticket["status"] = "Cancelled"

    return {
        "success": True,
        "message": "Ticket cancelled successfully.",
        "ticket": serialize_ticket(ticket),
    }


@router.get("/{ticket_id}")
def get_ticket(
    ticket_id: str,
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    db = request.app.state.db
    ticket = get_ticket_or_404(db, ticket_id)

    # Attendees can view only tickets belonging to their account.
    if current_user.get("role") == "Attendee":
        email = str(current_user.get("email", "")).strip().lower()
        if email != ticket.get("attendee_email", "").strip().lower():
            raise HTTPException(status_code=403, detail="Access denied.")
    elif current_user.get("role") not in {"Organizer", "Admin"}:
        raise HTTPException(status_code=403, detail="Access denied.")

    return {
        "success": True,
        "ticket": serialize_ticket(ticket),
    }


@router.get("")
def get_my_tickets(
    request: Request,
    current_user: dict = Depends(get_current_user),
):
    if current_user.get("role") != "Attendee":
        raise HTTPException(
            status_code=403,
            detail="Only attendees can view their own tickets here.",
        )

    email = str(current_user.get("email", "")).strip().lower()
    db = request.app.state.db

    tickets = list(
        db["tickets"].find({"attendee_email": email}).sort("created_at", -1)
    )

    return {
        "success": True,
        "tickets": [serialize_ticket(ticket) for ticket in tickets],
        "count": len(tickets),
    }