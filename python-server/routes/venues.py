from datetime import datetime, timezone
from typing import Literal

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel, ConfigDict, Field
from pymongo.errors import DuplicateKeyError

from routes.auth import get_current_user


router = APIRouter(prefix="/api/venues", tags=["Venues"])


# ---------------------------------------------------------
# REQUEST MODEL
# ---------------------------------------------------------

class VenueData(BaseModel):
    model_config = ConfigDict(
        str_strip_whitespace=True,
        extra="ignore",
    )

    name: str = Field(..., min_length=1, max_length=150)
    address: str = ""
    city: str = ""
    state: str = ""
    country: str = ""
    postal_code: str = ""
    capacity: int = Field(default=0, ge=0)
    cost_per_day: float = Field(default=0, ge=0, allow_inf_nan=False)


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
# DATABASE AND SERIALIZATION HELPERS
# ---------------------------------------------------------

def get_venues_collection(request: Request):
    return request.app.state.db["venues"]


def serialize_venue(venue: dict) -> dict:
    result = dict(venue)

    venue_id = result.pop("_id", result.get("id"))
    result["id"] = str(venue_id) if venue_id is not None else None

    for field in ("created_at", "updated_at"):
        value = result.get(field)

        if isinstance(value, datetime):
            result[field] = value.isoformat()

    return result


def get_venue_or_404(collection, venue_id: str) -> dict:
    if not ObjectId.is_valid(venue_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid venue ID.",
        )

    venue = collection.find_one({"_id": ObjectId(venue_id)})

    if not venue:
        raise HTTPException(
            status_code=404,
            detail="Venue not found.",
        )

    return venue


# ---------------------------------------------------------
# VALIDATION
# ---------------------------------------------------------

def validate_venue(data: VenueData) -> dict:
    venue = data.model_dump()

    if not venue["name"].strip():
        raise HTTPException(
            status_code=400,
            detail="Venue name is required.",
        )

    text_fields = [
        ("address", "Address"),
        ("city", "City"),
        ("state", "State"),
        ("country", "Country"),
        ("postal_code", "Postal code"),
    ]

    for field, label in text_fields:
        value = venue[field]

        if not isinstance(value, str):
            raise HTTPException(
                status_code=400,
                detail=f"{label} must be text.",
            )

        venue[field] = value.strip()

    venue["name"] = venue["name"].strip()

    if venue["capacity"] < 0:
        raise HTTPException(
            status_code=400,
            detail="Capacity must be a non-negative whole number.",
        )

    if venue["cost_per_day"] < 0:
        raise HTTPException(
            status_code=400,
            detail="Venue cost must be a non-negative number.",
        )

    return venue


def ensure_unique_venue_name(
    collection,
    name: str,
    exclude_id: ObjectId | None = None,
) -> None:
    query = {"name": {"$regex": f"^{__import__('re').escape(name)}$", "$options": "i"}}

    if exclude_id is not None:
        query["_id"] = {"$ne": exclude_id}

    if collection.find_one(query):
        raise HTTPException(
            status_code=409,
            detail="A venue with this name already exists.",
        )


# ---------------------------------------------------------
# GET ALL VENUES
# GET /api/venues/
# ---------------------------------------------------------

@router.get("/")
def get_venues(
    request: Request,
    user: dict = Depends(get_current_user),
):
    collection = get_venues_collection(request)

    venues = collection.find().sort("name", 1)

    return [
        serialize_venue(venue)
        for venue in venues
    ]


# ---------------------------------------------------------
# GET ONE VENUE
# GET /api/venues/{venue_id}
# ---------------------------------------------------------

@router.get("/{venue_id}")
def get_venue(
    venue_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    collection = get_venues_collection(request)

    venue = get_venue_or_404(collection, venue_id)

    return serialize_venue(venue)


# ---------------------------------------------------------
# CREATE VENUE
# POST /api/venues/
# ---------------------------------------------------------

@router.post("/", status_code=201)
def create_venue(
    data: VenueData,
    request: Request,
    user: dict = Depends(require_admin_or_organizer),
):
    collection = get_venues_collection(request)

    venue = validate_venue(data)

    ensure_unique_venue_name(
        collection,
        venue["name"],
    )

    venue["created_at"] = datetime.now(timezone.utc)

    try:
        result = collection.insert_one(venue)
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="A venue with this name already exists.",
        )

    return {
        "message": "Venue created successfully.",
        "id": str(result.inserted_id),
    }


# ---------------------------------------------------------
# UPDATE VENUE
# PUT /api/venues/{venue_id}
# Full-resource update, matching the Node.js API.
# ---------------------------------------------------------

@router.put("/{venue_id}")
def update_venue(
    venue_id: str,
    data: VenueData,
    request: Request,
    user: dict = Depends(require_admin_or_organizer),
):
    collection = get_venues_collection(request)

    existing = get_venue_or_404(collection, venue_id)
    venue = validate_venue(data)

    ensure_unique_venue_name(
        collection,
        venue["name"],
        exclude_id=existing["_id"],
    )

    venue["updated_at"] = datetime.now(timezone.utc)

    if existing.get("created_at") is not None:
        venue["created_at"] = existing["created_at"]

    try:
        collection.update_one(
            {"_id": existing["_id"]},
            {"$set": venue},
        )
    except DuplicateKeyError:
        raise HTTPException(
            status_code=409,
            detail="A venue with this name already exists.",
        )

    return {
        "message": "Venue updated successfully.",
    }


# ---------------------------------------------------------
# DELETE VENUE
# DELETE /api/venues/{venue_id}
# ---------------------------------------------------------

@router.delete("/{venue_id}")
def delete_venue(
    venue_id: str,
    request: Request,
    user: dict = Depends(require_admin_or_organizer),
):
    collection = get_venues_collection(request)

    existing = get_venue_or_404(collection, venue_id)

    result = collection.delete_one(
        {"_id": existing["_id"]}
    )

    if result.deleted_count == 0:
        raise HTTPException(
            status_code=404,
            detail="Venue not found.",
        )

    return {
        "message": "Venue deleted successfully.",
    }
