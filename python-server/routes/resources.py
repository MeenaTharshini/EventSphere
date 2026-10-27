from datetime import datetime, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field

from routes.auth import get_current_user

router = APIRouter(prefix="/api/resources", tags=["Resources"])


# ---------------------------------------------------------
# CONSTANTS
# ---------------------------------------------------------

RESOURCE_TYPES = [
    "Audio",
    "Lighting",
    "Furniture",
    "Catering",
    "Decoration",
    "Photography",
    "Video",
    "Other",
]

AvailabilityStatus = Literal[
    "Available",
    "Unavailable",
    "Maintenance",
]

ResourceType = Literal[
    "Audio",
    "Lighting",
    "Furniture",
    "Catering",
    "Decoration",
    "Photography",
    "Video",
    "Other",
]


# ---------------------------------------------------------
# REQUEST MODEL
# ---------------------------------------------------------

class ResourceData(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="ignore",
    )

    name: str = Field(..., min_length=1, max_length=150)
    type: ResourceType = "Other"
    description: str = ""
    quantity: int = Field(default=1, ge=0)
    unit_cost: float = Field(default=0, ge=0, allow_inf_nan=False)
    availability_status: AvailabilityStatus = "Available"


# ---------------------------------------------------------
# AUTHORIZATION
# ---------------------------------------------------------

def require_admin_or_organizer(
    user: dict = Depends(get_current_user),
) -> dict:
    if user.get("role") not in ("Admin", "Organizer"):
        raise HTTPException(
            status_code=403,
            detail="You are not allowed to perform this action.",
        )

    return user


# ---------------------------------------------------------
# DATABASE HELPERS
# ---------------------------------------------------------

def get_resources_collection(request: Request):
    return request.app.state.db["resources"]


def serialize_resource(resource: dict) -> dict:
    """Convert MongoDB data into JSON-compatible API data."""
    result = dict(resource)

    resource_id = result.pop("_id", result.get("id"))
    result["id"] = str(resource_id) if resource_id is not None else None

    for field in ("created_at", "updated_at"):
        value = result.get(field)

        if isinstance(value, datetime):
            result[field] = value.isoformat()

    return result


def get_resource_or_404(collection, resource_id: str) -> dict:
    if not ObjectId.is_valid(resource_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid resource ID.",
        )

    resource = collection.find_one({"_id": ObjectId(resource_id)})

    if not resource:
        raise HTTPException(
            status_code=404,
            detail="Resource not found.",
        )

    return resource


# ---------------------------------------------------------
# VALIDATION
# ---------------------------------------------------------

def validate_resource(data: ResourceData) -> dict:
    resource = data.model_dump()

    name = resource["name"].strip()

    if not name:
        raise HTTPException(
            status_code=400,
            detail="Resource name is required.",
        )

    if resource["type"] not in RESOURCE_TYPES:
        raise HTTPException(
            status_code=400,
            detail=(
                "Resource type must be one of: "
                + ", ".join(RESOURCE_TYPES)
                + "."
            ),
        )

    description = resource["description"]

    if not isinstance(description, str):
        raise HTTPException(
            status_code=400,
            detail="Description must be text.",
        )

    quantity = resource["quantity"]
    unit_cost = resource["unit_cost"]
    availability_status = resource["availability_status"]

    if quantity < 0:
        raise HTTPException(
            status_code=400,
            detail="Quantity must be a non-negative whole number.",
        )

    if unit_cost < 0:
        raise HTTPException(
            status_code=400,
            detail="Unit cost must be a non-negative number.",
        )

    allowed_statuses = [
        "Available",
        "Unavailable",
        "Maintenance",
    ]

    if availability_status not in allowed_statuses:
        raise HTTPException(
            status_code=400,
            detail=(
                "Availability status must be one of: "
                + ", ".join(allowed_statuses)
                + "."
            ),
        )

    resource["name"] = name
    resource["description"] = description.strip()

    return resource


# ---------------------------------------------------------
# GET ALL RESOURCES
# GET /api/resources/
# ---------------------------------------------------------

@router.get("/")
def get_resources(
    request: Request,
    user: dict = Depends(get_current_user),
):
    collection = get_resources_collection(request)

    resources = collection.find().sort("name", 1)

    return [
        serialize_resource(resource)
        for resource in resources
    ]


# ---------------------------------------------------------
# GET ONE RESOURCE
# GET /api/resources/{resource_id}
# ---------------------------------------------------------

@router.get("/{resource_id}")
def get_resource(
    resource_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    collection = get_resources_collection(request)

    resource = get_resource_or_404(
        collection,
        resource_id,
    )

    return serialize_resource(resource)


# ---------------------------------------------------------
# CREATE RESOURCE
# POST /api/resources/
# ---------------------------------------------------------

@router.post("/", status_code=201)
def create_resource(
    data: ResourceData,
    request: Request,
    user: dict = Depends(require_admin_or_organizer),
):
    collection = get_resources_collection(request)

    resource = validate_resource(data)
    now = datetime.now(timezone.utc)

    resource["created_at"] = now

    result = collection.insert_one(resource)

    created = collection.find_one(
        {"_id": result.inserted_id}
    )

    created_resource = serialize_resource(created)

    return {
        "message": "Resource created successfully.",
        "id": created_resource["id"],
        "resource": created_resource,
    }


# ---------------------------------------------------------
# UPDATE RESOURCE
# PUT /api/resources/{resource_id}
# Full-resource replacement behavior, like the Node.js API.
# ---------------------------------------------------------

@router.put("/{resource_id}")
def update_resource(
    resource_id: str,
    data: ResourceData,
    request: Request,
    user: dict = Depends(require_admin_or_organizer),
):
    collection = get_resources_collection(request)

    existing = get_resource_or_404(
        collection,
        resource_id,
    )

    resource = validate_resource(data)
    resource["updated_at"] = datetime.now(timezone.utc)

    # Preserve the original creation timestamp.
    if existing.get("created_at") is not None:
        resource["created_at"] = existing["created_at"]

    collection.update_one(
        {"_id": existing["_id"]},
        {"$set": resource},
    )

    updated = collection.find_one(
        {"_id": existing["_id"]}
    )

    return {
        "message": "Resource updated successfully.",
        "resource": serialize_resource(updated),
    }


# ---------------------------------------------------------
# DELETE RESOURCE
# DELETE /api/resources/{resource_id}
# ---------------------------------------------------------

@router.delete("/{resource_id}")
def delete_resource(
    resource_id: str,
    request: Request,
    user: dict = Depends(require_admin_or_organizer),
):
    collection = get_resources_collection(request)

    existing = get_resource_or_404(
        collection,
        resource_id,
    )

    result = collection.delete_one(
        {"_id": existing["_id"]}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Resource not found.",
        )

    return {
        "message": "Resource deleted successfully.",
    }
