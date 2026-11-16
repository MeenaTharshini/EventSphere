
from datetime import datetime, date, timezone
from typing import Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field, field_validator

from routes.auth import get_current_user


router = APIRouter(
    prefix="/api/budgets",
    tags=["Budgets"],
)


# =========================================================
# CONSTANTS
# =========================================================

EXPENSE_CATEGORIES = [
    "Venue",
    "Catering",
    "Staffing",
    "Marketing",
    "Logistics",
    "Equipment",
]

ExpenseStatus = Literal[
    "Pending",
    "Approved",
    "Paid",
    "Rejected",
]

ExpenseCategory = Literal[
    "Venue",
    "Catering",
    "Staffing",
    "Marketing",
    "Logistics",
    "Equipment",
]

LinkedItemType = Literal[
    "Venue",
    "Resource",
    "Vendor",
    "Other",
]


# =========================================================
# REQUEST MODELS
# =========================================================

class ExpenseRejectionInput(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="ignore",
    )

    reason: str = Field(
        ...,
        min_length=3,
        max_length=500,
    )


class BudgetInput(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="ignore",
    )

    total_budget: float = Field(
        ...,
        ge=0,
        allow_inf_nan=False,
    )


class ExpenseInput(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="ignore",
    )

    description: str = Field(
        ...,
        min_length=2,
        max_length=200,
    )

    category: ExpenseCategory

    amount: float = Field(
        ...,
        gt=0,
        allow_inf_nan=False,
    )

    expense_date: str

    status: ExpenseStatus = "Pending"

    notes: str = Field(
        default="",
        max_length=1000,
    )

    linked_item_type: Optional[LinkedItemType] = None

    linked_item_id: Optional[str] = Field(
        default=None,
        max_length=100,
    )

    linked_item_name: Optional[str] = Field(
        default=None,
        max_length=200,
    )

    @field_validator("expense_date")
    @classmethod
    def validate_expense_date(cls, value: str) -> str:
        try:
            parsed = date.fromisoformat(value)
        except (ValueError, TypeError):
            raise ValueError(
                "Expense date must use YYYY-MM-DD format."
            )

        if parsed.isoformat() != value:
            raise ValueError(
                "Expense date must use YYYY-MM-DD format."
            )

        return value

    @field_validator("linked_item_id", "linked_item_name")
    @classmethod
    def normalize_optional_strings(
        cls,
        value: Optional[str],
    ) -> Optional[str]:
        if value is None:
            return None

        value = value.strip()
        return value or None


# =========================================================
# DATABASE HELPERS
# =========================================================

def get_collection(request: Request, name: str):
    return request.app.state.db[name]


def get_events_collection(request: Request):
    return get_collection(request, "events")


def get_expenses_collection(request: Request):
    return get_collection(request, "expenses")


# =========================================================
# AUTHORIZATION
# =========================================================

def get_user_id(user: dict) -> str:
    value = user.get("_id", user.get("id"))

    if value is None:
        raise HTTPException(
            status_code=401,
            detail="Unable to identify the logged-in user.",
        )

    return str(value)


def get_user_name(user: dict) -> str:
    return str(
        user.get("name")
        or user.get("full_name")
        or user.get("username")
        or user.get("email")
        or "EventSphere User"
    )


def get_role(user: dict) -> str:
    return str(
        user.get("role", "")
    ).strip().lower()


def require_manager(user: dict):
    if get_role(user) not in (
        "admin",
        "administrator",
        "organizer",
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Only organizers and administrators "
                "can manage event budgets."
            ),
        )


def require_admin(user: dict):
    if get_role(user) not in (
        "admin",
        "administrator",
    ):
        raise HTTPException(
            status_code=403,
            detail=(
                "Only administrators can approve "
                "or reject expenses."
            ),
        )


def get_event_owner_id(event: dict):
    owner = event.get("organizer_id")

    if isinstance(owner, dict):
        owner = owner.get(
            "_id",
            owner.get("id"),
        )

    return str(owner) if owner is not None else None


def check_event_access(user: dict, event: dict):
    role = get_role(user)

    if role in ("admin", "administrator"):
        return

    if role != "organizer":
        raise HTTPException(
            status_code=403,
            detail=(
                "You do not have permission "
                "to manage this event."
            ),
        )

    if get_event_owner_id(event) != get_user_id(user):
        raise HTTPException(
            status_code=403,
            detail=(
                "You can only manage budgets "
                "for your own events."
            ),
        )


# =========================================================
# EVENT HELPERS
# =========================================================

def get_event(
    request: Request,
    event_id: str,
) -> dict:

    if not ObjectId.is_valid(event_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid event ID.",
        )

    event = get_events_collection(request).find_one(
        {"_id": ObjectId(event_id)}
    )

    if not event:
        raise HTTPException(
            status_code=404,
            detail="Event not found.",
        )

    return event


def normalize_ids(values) -> list[str]:
    if not isinstance(values, (list, tuple, set)):
        return []

    result = []
    seen = set()

    for value in values:
        if value is None:
            continue

        value = str(value).strip()

        if value and value not in seen:
            seen.add(value)
            result.append(value)

    return result


def find_selected_item(collection, item_id: str):
    if not item_id:
        return None

    if ObjectId.is_valid(item_id):
        item = collection.find_one(
            {"_id": ObjectId(item_id)}
        )

        if item:
            return item

    return collection.find_one(
        {"id": item_id}
    )


def serialize_value(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()

    if isinstance(value, ObjectId):
        return str(value)

    if isinstance(value, dict):
        return {
            key: serialize_value(item)
            for key, item in value.items()
        }

    if isinstance(value, list):
        return [
            serialize_value(item)
            for item in value
        ]

    return value


def serialize_datetime_fields(document: dict) -> dict:
    return {
        key: serialize_value(value)
        for key, value in document.items()
    }


def safe_float(value, default=0.0) -> float:
    try:
        result = float(value or 0)

        if result != result:
            return default

        if result in (
            float("inf"),
            float("-inf"),
        ):
            return default

        return result

    except (TypeError, ValueError):
        return default


def serialize_selected_item(
    item: dict,
    item_type: str,
) -> Optional[dict]:

    if not item:
        return None

    result = serialize_datetime_fields(item)

    item_id = result.pop(
        "_id",
        result.get("id"),
    )

    result["id"] = (
        str(item_id)
        if item_id is not None
        else ""
    )

    if item_type == "Venue":

        result["name"] = (
            result.get("name")
            or "Selected venue"
        )

        result["estimated_cost"] = safe_float(
            result.get("cost_per_day")
        )

    elif item_type == "Resource":

        result["name"] = (
            result.get("name")
            or "Selected resource"
        )

        quantity = result.get("quantity") or 1

        try:
            quantity = int(quantity)
        except (TypeError, ValueError):
            quantity = 1

        result["estimated_cost"] = (
            safe_float(result.get("unit_cost"))
            * quantity
        )

    elif item_type == "Vendor":

        result["name"] = (
            result.get("business_name")
            or result.get("name")
            or "Selected vendor"
        )

        result["estimated_cost"] = safe_float(
            result.get("estimated_cost")
            or result.get("quoted_amount")
        )

    return result


def get_event_selections(
    request: Request,
    event: dict,
) -> dict:

    venue = None

    venue_id = (
        event.get("venue_id")
        or event.get("venueId")
    )

    if venue_id:
        venue_document = find_selected_item(
            get_collection(request, "venues"),
            str(venue_id),
        )

        if venue_document:
            venue = serialize_selected_item(
                venue_document,
                "Venue",
            )

    if not venue and (
        event.get("venue_name")
        or event.get("venue")
    ):
        venue = {
            "id": str(venue_id or ""),
            "name": (
                event.get("venue_name")
                or event.get("venue")
            ),
            "address": "",
            "city": "",
            "capacity": 0,
            "cost_per_day": 0,
            "estimated_cost": 0,
        }

    resources = []

    resource_ids = normalize_ids(
        event.get("resource_ids")
        or event.get("resourceIds")
    )

    for resource_id in resource_ids:
        resource_document = find_selected_item(
            get_collection(request, "resources"),
            resource_id,
        )

        if resource_document:
            resources.append(
                serialize_selected_item(
                    resource_document,
                    "Resource",
                )
            )

    vendors = []

    vendor_ids = normalize_ids(
        event.get("vendor_ids")
        or event.get("vendorIds")
    )

    for vendor_id in vendor_ids:
        vendor_document = find_selected_item(
            get_collection(request, "vendors"),
            vendor_id,
        )

        if vendor_document:
            vendors.append(
                serialize_selected_item(
                    vendor_document,
                    "Vendor",
                )
            )

    return {
        "venue": venue,
        "resources": resources,
        "vendors": vendors,
    }


def serialize_event(
    request: Request,
    event: dict,
) -> dict:

    event_id = str(event["_id"])

    event_date = (
        event.get("event_date")
        or event.get("date")
        or ""
    )

    end_date = (
        event.get("end_date")
        or event_date
    )

    return {
        "id": event_id,
        "_id": event_id,

        "name": (
            event.get("name")
            or event.get("title")
            or event.get("event_name")
            or "Untitled event"
        ),

        "event_type": (
            event.get("event_type")
            or event.get("type")
            or "Other"
        ),

        "event_date": str(event_date),
        "end_date": str(end_date),

        "start_time": event.get("start_time") or "",
        "end_time": event.get("end_time") or "",

        "attendee_count": int(
            event.get("attendee_count") or 0
        ),

        "status": event.get("status") or "Scheduled",

        "venue_id": str(
            event.get("venue_id")
            or event.get("venueId")
            or ""
        ),

        "resource_ids": normalize_ids(
            event.get("resource_ids")
            or event.get("resourceIds")
        ),

        "vendor_ids": normalize_ids(
            event.get("vendor_ids")
            or event.get("vendorIds")
        ),

        **get_event_selections(request, event),
    }


# =========================================================
# BUDGET HELPERS
# =========================================================

def get_event_budget_amount(event: dict) -> float:

    try:
        amount = float(
            event.get("budget") or 0
        )

    except (TypeError, ValueError):
        raise HTTPException(
            status_code=500,
            detail="The event has an invalid budget value.",
        )

    if (
        amount < 0
        or amount != amount
        or amount in (
            float("inf"),
            float("-inf"),
        )
    ):
        raise HTTPException(
            status_code=500,
            detail="The event has an invalid budget value.",
        )

    return amount


def expense_total(
    request: Request,
    event_id: str,
) -> float:

    result = list(
        get_expenses_collection(request).aggregate([
            {
                "$match": {
                    "event_id": event_id,
                    "status": {
                        "$ne": "Rejected"
                    },
                }
            },
            {
                "$group": {
                    "_id": None,
                    "total": {
                        "$sum": "$amount"
                    },
                }
            },
        ])
    )

    return round(
        safe_float(result[0]["total"])
        if result
        else 0,
        2,
    )


def serialize_budget(
    event: dict,
    spent: float,
) -> dict:

    total = get_event_budget_amount(event)

    return {
        "id": str(event["_id"]),
        "event_id": str(event["_id"]),

        "event_name": (
            event.get("name")
            or event.get("title")
            or "Untitled event"
        ),

        "total_budget": round(total, 2),
        "total_expenses": round(spent, 2),

        "remaining_budget": round(
            total - spent,
            2,
        ),

        "utilization": round(
            (spent / total) * 100
            if total > 0
            else 0,
            2,
        ),

        "currency": "INR",
    }


# =========================================================
# EXPENSE HELPERS
# =========================================================

def serialize_expense(expense: dict) -> dict:

    result = serialize_datetime_fields(expense)

    return {
        "id": str(expense["_id"]),

        "event_id": str(
            expense["event_id"]
        ),

        "description": result.get(
            "description",
            "",
        ),

        "category": result.get(
            "category",
            "",
        ),

        "amount": safe_float(
            result.get("amount")
        ),

        "expense_date": result.get(
            "expense_date",
            "",
        ),

        "status": result.get(
            "status",
            "Pending",
        ),

        "notes": result.get(
            "notes",
            "",
        ),

        "linked_item_type": result.get(
            "linked_item_type"
        ),

        "linked_item_id": result.get(
            "linked_item_id"
        ),

        "linked_item_name": result.get(
            "linked_item_name"
        ),

        "created_at": result.get(
            "created_at"
        ),

        "updated_at": result.get(
            "updated_at"
        ),

        "requested_by": result.get(
            "requested_by"
        ),

        "requested_by_name": result.get(
            "requested_by_name",
            "Unknown",
        ),

        "approval": result.get("approval") or {
            "reviewed_by": None,
            "reviewed_by_name": None,
            "reviewed_at": None,
            "rejection_reason": None,
        },
    }


def get_expense(
    request: Request,
    expense_id: str,
) -> dict:

    if not ObjectId.is_valid(expense_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid expense ID.",
        )

    expense = get_expenses_collection(request).find_one(
        {"_id": ObjectId(expense_id)}
    )

    if not expense:
        raise HTTPException(
            status_code=404,
            detail="Expense not found.",
        )

    return expense


def ensure_expense_fits_budget(
    request: Request,
    event: dict,
    new_amount: float,
    old_amount: float = 0,
):

    event_id = str(event["_id"])

    current_total = expense_total(
        request,
        event_id,
    )

    projected_total = (
        current_total
        - old_amount
        + new_amount
    )

    allocated_budget = get_event_budget_amount(
        event
    )

    if projected_total > allocated_budget:

        available = max(
            allocated_budget
            - current_total
            + old_amount,
            0,
        )

        raise HTTPException(
            status_code=400,
            detail=(
                "This expense exceeds the available event budget. "
                f"Remaining amount: ₹{available:,.2f}."
            ),
        )


def validate_linked_item(
    request: Request,
    event: dict,
    data: ExpenseInput,
):

    if not data.linked_item_id:
        return

    item_type = data.linked_item_type
    item_id = data.linked_item_id

    if item_type == "Venue":

        selected_ids = [
            str(
                event.get("venue_id")
                or event.get("venueId")
                or ""
            )
        ]

        collection_name = "venues"

    elif item_type == "Resource":

        selected_ids = normalize_ids(
            event.get("resource_ids")
            or event.get("resourceIds")
        )

        collection_name = "resources"

    elif item_type == "Vendor":

        selected_ids = normalize_ids(
            event.get("vendor_ids")
            or event.get("vendorIds")
        )

        collection_name = "vendors"

    else:
        raise HTTPException(
            status_code=400,
            detail="Invalid linked item type.",
        )

    if item_id not in selected_ids:
        raise HTTPException(
            status_code=400,
            detail=(
                "The selected item is not linked to this event. "
                "Refresh the event details and try again."
            ),
        )

    item = find_selected_item(
        get_collection(request, collection_name),
        item_id,
    )

    if not item:
        raise HTTPException(
            status_code=404,
            detail="The linked event item could not be found.",
        )

    actual_name = (
        item.get("business_name")
        or item.get("name")
        or ""
    )

    if (
        data.linked_item_name
        and actual_name
        and data.linked_item_name != actual_name
    ):
        raise HTTPException(
            status_code=400,
            detail=(
                "The linked item name does not match "
                "the saved event item."
            ),
        )


def validate_no_duplicate_link(
    request: Request,
    event_id: str,
    data: ExpenseInput,
    exclude_expense_id: Optional[ObjectId] = None,
):

    if not data.linked_item_id:
        return

    query = {
        "event_id": event_id,
        "linked_item_type": data.linked_item_type,
        "linked_item_id": data.linked_item_id,
        "status": {"$ne": "Rejected"},
    }

    if exclude_expense_id:
        query["_id"] = {
            "$ne": exclude_expense_id
        }

    duplicate = get_expenses_collection(request).find_one(
        query
    )

    if duplicate:
        raise HTTPException(
            status_code=400,
            detail=(
                "An expense has already been allocated "
                "to this selected event item."
            ),
        )


def get_updated_budget_response(
    request: Request,
    event: dict,
) -> dict:

    return serialize_budget(
        event,
        expense_total(
            request,
            str(event["_id"]),
        ),
    )


# =========================================================
# CATEGORIES
# =========================================================

@router.get("/categories")
def get_expense_categories():

    return {
        "success": True,
        "categories": EXPENSE_CATEGORIES,
    }


# =========================================================
# GET EVENT BUDGET
# =========================================================

@router.get("/event/{event_id}")
def get_event_budget(
    event_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):

    event = get_event(
        request,
        event_id,
    )

    check_event_access(
        user,
        event,
    )

    spent = expense_total(
        request,
        event_id,
    )

    expenses = list(
        get_expenses_collection(request)
        .find({
            "event_id": event_id
        })
        .sort([
            ("expense_date", -1),
            ("created_at", -1),
        ])
    )

    return {
        "success": True,

        "event": serialize_event(
            request,
            event,
        ),

        "budget": serialize_budget(
            event,
            spent,
        ),

        "expenses": [
            serialize_expense(item)
            for item in expenses
        ],
    }


# =========================================================
# UPDATE EVENT BUDGET
# =========================================================

@router.put("/event/{event_id}")
def assign_event_budget(
    event_id: str,
    data: BudgetInput,
    request: Request,
    user: dict = Depends(get_current_user),
):

    require_manager(user)

    event = get_event(
        request,
        event_id,
    )

    check_event_access(
        user,
        event,
    )

    current_expenses = expense_total(
        request,
        event_id,
    )

    if data.total_budget < current_expenses:
        raise HTTPException(
            status_code=400,
            detail=(
                "Budget cannot be lower than current expenses. "
                f"Current expenses: ₹{current_expenses:,.2f}."
            ),
        )

    get_events_collection(request).update_one(
        {"_id": event["_id"]},
        {
            "$set": {
                "budget": data.total_budget,
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    updated_event = get_event(
        request,
        event_id,
    )

    return {
        "success": True,
        "message": "Event budget updated successfully.",
        "budget": get_updated_budget_response(
            request,
            updated_event,
        ),
    }


# =========================================================
# ADD NEW EXPENSE
# =========================================================

@router.post("/event/{event_id}/expenses")
def add_expense(
    event_id: str,
    data: ExpenseInput,
    request: Request,
    user: dict = Depends(get_current_user),
):

    require_manager(user)

    event = get_event(
        request,
        event_id,
    )

    check_event_access(
        user,
        event,
    )

    validate_linked_item(
        request,
        event,
        data,
    )

    validate_no_duplicate_link(
        request,
        event_id,
        data,
    )

    # Every new expense must fit the budget.
    # The client cannot bypass this by sending Rejected status.
    ensure_expense_fits_budget(
        request,
        event,
        data.amount,
        0,
    )

    now = datetime.now(timezone.utc)

    expense_document = data.model_dump()

    if not data.linked_item_id:
        expense_document["linked_item_type"] = None
        expense_document["linked_item_id"] = None
        expense_document["linked_item_name"] = None

    expense_document.update({
        "event_id": event_id,

        # New expenses always require admin review.
        "status": "Pending",

        "requested_by": get_user_id(user),
        "requested_by_name": get_user_name(user),

        "approval": {
            "reviewed_by": None,
            "reviewed_by_name": None,
            "reviewed_at": None,
            "rejection_reason": None,
        },

        "created_at": now,
        "updated_at": now,
    })

    result = get_expenses_collection(request).insert_one(
        expense_document
    )

    created_expense = get_expenses_collection(request).find_one(
        {"_id": result.inserted_id}
    )

    return {
        "success": True,
        "message": "Expense submitted for approval.",
        "expense": serialize_expense(
            created_expense
        ),
        "budget": get_updated_budget_response(
            request,
            event,
        ),
    }


# =========================================================
# UPDATE EXISTING EXPENSE
# =========================================================

@router.put("/expenses/{expense_id}")
def update_expense(
    expense_id: str,
    data: ExpenseInput,
    request: Request,
    user: dict = Depends(get_current_user),
):

    require_manager(user)

    existing = get_expense(
        request,
        expense_id,
    )

    event_id = str(existing["event_id"])

    event = get_event(
        request,
        event_id,
    )

    check_event_access(
        user,
        event,
    )

    # Do not allow editing a decision that has already been made.
    if existing.get("status") in ("Approved", "Paid", "Rejected"):
        raise HTTPException(
            status_code=400,
            detail=(
                "This expense has already been reviewed "
                "and cannot be edited."
            ),
        )

    validate_linked_item(
        request,
        event,
        data,
    )

    validate_no_duplicate_link(
        request,
        event_id,
        data,
        existing["_id"],
    )

    old_amount = safe_float(
        existing.get("amount")
    )

    ensure_expense_fits_budget(
        request,
        event,
        data.amount,
        old_amount,
    )

    update_document = data.model_dump()

    if not data.linked_item_id:
        update_document["linked_item_type"] = None
        update_document["linked_item_id"] = None
        update_document["linked_item_name"] = None

    # Status and approval data cannot be changed through this route.
    update_document.pop("status", None)

    update_document["updated_at"] = datetime.now(timezone.utc)

    get_expenses_collection(request).update_one(
        {"_id": existing["_id"]},
        {
            "$set": update_document
        },
    )

    updated = get_expenses_collection(request).find_one(
        {"_id": existing["_id"]}
    )

    return {
        "success": True,
        "message": "Expense updated successfully.",
        "expense": serialize_expense(updated),
        "budget": get_updated_budget_response(
            request,
            event,
        ),
    }


# =========================================================
# ADMIN: APPROVE EXPENSE
# =========================================================

@router.post("/expenses/{expense_id}/approve")
def approve_expense(
    expense_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):

    require_admin(user)

    existing = get_expense(
        request,
        expense_id,
    )

    if existing.get("status") != "Pending":
        raise HTTPException(
            status_code=400,
            detail="Only pending expenses can be approved.",
        )

    event_id = str(existing["event_id"])

    event = get_event(
        request,
        event_id,
    )

    now = datetime.now(timezone.utc)

    approval_data = {
        "reviewed_by": get_user_id(user),
        "reviewed_by_name": get_user_name(user),
        "reviewed_at": now,
        "rejection_reason": None,
    }

    get_expenses_collection(request).update_one(
        {"_id": existing["_id"]},
        {
            "$set": {
                "status": "Approved",
                "approval": approval_data,
                "updated_at": now,
            }
        },
    )

    updated = get_expenses_collection(request).find_one(
        {"_id": existing["_id"]}
    )

    return {
        "success": True,
        "message": "Expense approved successfully.",
        "expense": serialize_expense(updated),
        "budget": get_updated_budget_response(
            request,
            event,
        ),
    }


# =========================================================
# ADMIN: REJECT EXPENSE
# =========================================================

@router.post("/expenses/{expense_id}/reject")
def reject_expense(
    expense_id: str,
    data: ExpenseRejectionInput,
    request: Request,
    user: dict = Depends(get_current_user),
):

    require_admin(user)

    existing = get_expense(
        request,
        expense_id,
    )

    if existing.get("status") != "Pending":
        raise HTTPException(
            status_code=400,
            detail="Only pending expenses can be rejected.",
        )

    event_id = str(existing["event_id"])

    event = get_event(
        request,
        event_id,
    )

    now = datetime.now(timezone.utc)

    approval_data = {
        "reviewed_by": get_user_id(user),
        "reviewed_by_name": get_user_name(user),
        "reviewed_at": now,
        "rejection_reason": data.reason,
    }

    get_expenses_collection(request).update_one(
        {"_id": existing["_id"]},
        {
            "$set": {
                "status": "Rejected",
                "approval": approval_data,
                "updated_at": now,
            }
        },
    )

    updated = get_expenses_collection(request).find_one(
        {"_id": existing["_id"]}
    )

    return {
        "success": True,
        "message": "Expense rejected successfully.",
        "expense": serialize_expense(updated),
        "budget": get_updated_budget_response(
            request,
            event,
        ),
    }


# =========================================================
# DELETE EXISTING EXPENSE
# =========================================================

@router.delete("/expenses/{expense_id}")
def delete_expense(
    expense_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):

    require_manager(user)

    existing = get_expense(
        request,
        expense_id,
    )

    event_id = str(existing["event_id"])

    event = get_event(
        request,
        event_id,
    )

    check_event_access(
        user,
        event,
    )

    # Reviewed expenses should not be deleted through the
    # normal expense-management route.
    if existing.get("status") in ("Approved", "Paid", "Rejected"):
        raise HTTPException(
            status_code=400,
            detail=(
                "Reviewed expenses cannot be deleted "
                "through this operation."
            ),
        )

    result = get_expenses_collection(request).delete_one(
        {
            "_id": existing["_id"],
            "event_id": event_id,
        }
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Expense not found or already deleted.",
        )

    return {
        "success": True,
        "message": "Expense deleted successfully.",
        "deleted_expense_id": expense_id,
        "budget": get_updated_budget_response(
            request,
            event,
        ),
    }

# =========================================================
# ADMIN: GET ALL EXPENSE APPROVAL REQUESTS
# GET /api/budgets/approvals
# =========================================================

@router.get("/approvals")
def get_expense_approvals(
    request: Request,
    user: dict = Depends(get_current_user),
):
    require_admin(user)

    expenses_collection = get_expenses_collection(request)
    events_collection = get_events_collection(request)

    expenses = expenses_collection.find(
        {}
    ).sort(
        "created_at",
        -1,
    )

    result = []

    for expense in expenses:
        item = serialize_expense(expense)

        event_id = str(expense.get("event_id", ""))

        event = None

        if ObjectId.is_valid(event_id):
            event = events_collection.find_one(
                {"_id": ObjectId(event_id)},
                {
                    "name": 1,
                    "title": 1,
                    "event_name": 1,
                    "event_date": 1,
                    "date": 1,
                },
            )

        if event:
            item["event_name"] = (
                event.get("name")
                or event.get("title")
                or event.get("event_name")
                or "Untitled event"
            )

            item["event_date"] = str(
                event.get("event_date")
                or event.get("date")
                or ""
            )
        else:
            item["event_name"] = "Unknown event"
            item["event_date"] = ""

        result.append(item)

    return {
        "success": True,
        "expenses": result,
        "count": len(result),
    }
