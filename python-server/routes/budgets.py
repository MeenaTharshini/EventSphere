from datetime import datetime, date, timezone
from typing import Literal, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import (
    BaseModel,
    ConfigDict,
    Field,
    field_validator,
)

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
    """
    Used for creating and updating expenses.
    """

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
    """
    EventSphere stores selected venue/resource/vendor IDs
    as strings. MongoDB records use ObjectId.
    """

    if not item_id:
        return None

    if ObjectId.is_valid(item_id):
        item = collection.find_one(
            {"_id": ObjectId(item_id)}
        )

        if item:
            return item

    # Fallback for older records using string IDs.
    return collection.find_one(
        {"id": item_id}
    )


def serialize_datetime_fields(document: dict) -> dict:
    result = {}

    for key, value in document.items():

        if isinstance(value, (datetime, date)):
            result[key] = value.isoformat()

        elif isinstance(value, ObjectId):
            result[key] = str(value)

        else:
            result[key] = value

    return result


def safe_float(value, default=0.0) -> float:
    try:
        result = float(value or 0)

        if result != result:
            return default

        if result in (float("inf"), float("-inf")):
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
    """
    Retrieves the venue, resources and vendors
    already selected during Event Management.

    These are displayed as read-only selections.
    Their catalogue estimates are not expenses.
    """

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

    # Fallback to the venue name saved on the event.
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

        "start_time": (
            event.get("start_time")
            or ""
        ),

        "end_time": (
            event.get("end_time")
            or ""
        ),

        "attendee_count": int(
            event.get("attendee_count") or 0
        ),

        "status": (
            event.get("status")
            or "Scheduled"
        ),

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
        float(result[0]["total"])
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

        "total_expenses": round(
            spent,
            2,
        ),

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
        {
            "_id": ObjectId(expense_id)
        }
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
    """
    A linked item must belong to the event's
    existing venue, resource or vendor selections.

    This does not add or modify event selections.
    """

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
        get_collection(
            request,
            collection_name,
        ),
        item_id,
    )

    if not item:
        raise HTTPException(
            status_code=404,
            detail=(
                "The linked event item could not be found."
            ),
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
        {
            "_id": event["_id"]
        },
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

        "budget": serialize_budget(
            updated_event,
            expense_total(
                request,
                event_id,
            ),
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

    # 1. Verify event exists and user has permission.
    event = get_event(
        request,
        event_id,
    )

    check_event_access(
        user,
        event,
    )

    # 2. Validate the linked venue, resource or vendor.
    validate_linked_item(
        request,
        event,
        data,
    )

    # 3. Prevent the same selected item from being allocated twice.
    if (
        data.linked_item_id
        and data.status != "Rejected"
    ):
        duplicate = get_expenses_collection(request).find_one({
            "event_id": event_id,
            "linked_item_type": data.linked_item_type,
            "linked_item_id": data.linked_item_id,
            "status": {"$ne": "Rejected"},
        })

        if duplicate:
            raise HTTPException(
                status_code=400,
                detail=(
                    "An expense has already been allocated "
                    "to this selected event item."
                ),
            )

    # 4. Check available budget.
    # Rejected expenses do not count towards allocated budget.
    if data.status != "Rejected":
        ensure_expense_fits_budget(
            request,
            event,
            data.amount,
            0,
        )

    # 5. Prepare the expense document.
    now = datetime.now(timezone.utc)

    expense_document = data.model_dump()

    # Do not retain linked-item information when no item is linked.
    if not data.linked_item_id:
        expense_document["linked_item_type"] = None
        expense_document["linked_item_id"] = None
        expense_document["linked_item_name"] = None

    expense_document.update({
        "event_id": event_id,
        "created_at": now,
        "updated_at": now,
    })

    # 6. Save the new expense.
    result = get_expenses_collection(request).insert_one(
        expense_document
    )

    # 7. Retrieve the saved expense.
    created_expense = get_expenses_collection(request).find_one(
        {
            "_id": result.inserted_id
        }
    )

    # 8. Recalculate the event budget.
    updated_spent = expense_total(
        request,
        event_id,
    )

    return {
        "success": True,
        "message": "Expense added successfully.",
        "expense": serialize_expense(
            created_expense
        ),
        "budget": serialize_budget(
            event,
            updated_spent,
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

    event_id = str(
        existing["event_id"]
    )

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

    old_amount = (
        safe_float(existing.get("amount"))
        if existing.get("status") != "Rejected"
        else 0
    )

    if data.status != "Rejected":

        ensure_expense_fits_budget(
            request,
            event,
            data.amount,
            old_amount,
        )

    get_expenses_collection(request).update_one(
        {
            "_id": existing["_id"]
        },
        {
            "$set": {
                **data.model_dump(),
                "updated_at": datetime.now(timezone.utc),
            }
        },
    )

    updated = get_expenses_collection(request).find_one(
        {
            "_id": existing["_id"]
        }
    )

    return {
        "success": True,

        "message": "Expense updated successfully.",

        "expense": serialize_expense(
            updated
        ),

        "budget": serialize_budget(
            event,
            expense_total(
                request,
                event_id,
            ),
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

    # Find the existing expense.
    existing = get_expense(
        request,
        expense_id,
    )

    event_id = str(existing["event_id"])

    # Verify that the event exists and the user has access.
    event = get_event(
        request,
        event_id,
    )

    check_event_access(
        user,
        event,
    )

    # Delete only the expense record.
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

    # Recalculate budget after deletion.
    updated_spent = expense_total(
        request,
        event_id,
    )

    return {
        "success": True,
        "message": "Expense deleted successfully.",
        "deleted_expense_id": expense_id,
        "budget": serialize_budget(
            event,
            updated_spent,
        ),
    }
