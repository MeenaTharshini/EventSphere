
from datetime import datetime, timezone
from typing import Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pymongo.errors import PyMongoError, DuplicateKeyError

from .auth import get_current_user


router = APIRouter(
    prefix="/api/notifications",
    tags=["Notifications"],
)


# =========================================================
# HELPERS
# =========================================================

def get_user_id(user: dict) -> str:
    """Return the authenticated user's ID as a string."""
    return str(user.get("_id") or user.get("id") or "").strip()


def require_notification_user(user: dict) -> str:
    """Ensure the authenticated user has a valid ID."""
    recipient_id = get_user_id(user)

    if not recipient_id:
        raise HTTPException(
            status_code=401,
            detail="Unable to identify your account.",
        )

    return recipient_id


def get_notifications_collection(request: Request):
    """Return the MongoDB notifications collection."""
    return request.app.state.db["notifications"]


def serialize_notification(item: dict) -> dict:
    """Convert a MongoDB notification into a JSON-safe response."""

    if not item:
        return {}

    return {
        "id": str(item["_id"]),
        "title": item.get("title", "Notification"),
        "message": item.get("message", ""),
        "type": item.get("type", "info"),
        "category": item.get("category", "general"),
        "is_read": bool(item.get("is_read", False)),
        "created_at": (
            item.get("created_at").isoformat()
            if isinstance(item.get("created_at"), datetime)
            else item.get("created_at")
        ),
        "read_at": (
            item.get("read_at").isoformat()
            if isinstance(item.get("read_at"), datetime)
            else item.get("read_at")
        ),
        "related_id": item.get("related_id"),
        "related_type": item.get("related_type"),
        "metadata": item.get("metadata") or {},
    }


# =========================================================
# CREATE NOTIFICATION
# Used internally by other route files.
# =========================================================

def create_notification(
    db,
    recipient_id: str,
    title: str,
    message: str,
    notification_type: str = "info",
    category: str = "general",
    related_id: Optional[str] = None,
    related_type: Optional[str] = None,
    metadata: Optional[dict] = None,
    dedupe_key: Optional[str] = None,
):
    """
    Create an in-app notification.

    recipient_id:
        MongoDB users._id represented as a string.

    Returns:
        Inserted notification ID as a string.
        None if the notification is skipped or fails.
    """

    recipient_id = str(recipient_id or "").strip()

    if not recipient_id:
        print("Notification skipped: recipient ID is missing.")
        return None

    title = str(title or "Notification").strip()
    message = str(message or "").strip()

    if not title:
        title = "Notification"

    document = {
        "recipient_id": recipient_id,
        "title": title,
        "message": message,
        "type": notification_type,
        "category": category,
        "is_read": False,
        "created_at": datetime.now(timezone.utc),
        "read_at": None,
        "related_id": (
            str(related_id) if related_id is not None else None
        ),
        "related_type": related_type,
        "metadata": metadata or {},
        "dedupe_key": dedupe_key,
    }

    collection = db["notifications"]

    try:
        # Avoid creating an already-existing notification.
        if dedupe_key:
            existing = collection.find_one({
                "recipient_id": recipient_id,
                "dedupe_key": dedupe_key,
            })

            if existing:
                return None

        result = collection.insert_one(document)

        return str(result.inserted_id)

    except DuplicateKeyError:
        # Handles duplicate requests when the unique index exists.
        return None

    except PyMongoError as exc:
        # A notification failure must not undo the main operation.
        print(
            "Notification creation failed: "
            f"{type(exc).__name__}: {exc}"
        )
        return None


# =========================================================
# GET ONE NOTIFICATION BELONGING TO THE USER
# =========================================================

def get_notification_for_user(
    db,
    notification_id: str,
    recipient_id: str,
):
    """Find a notification without exposing other users' records."""

    if not ObjectId.is_valid(notification_id):
        raise HTTPException(
            status_code=400,
            detail="Invalid notification ID.",
        )

    notification = db["notifications"].find_one({
        "_id": ObjectId(notification_id),
        "recipient_id": str(recipient_id),
    })

    if not notification:
        raise HTTPException(
            status_code=404,
            detail="Notification not found.",
        )

    return notification


# =========================================================
# LIST NOTIFICATIONS
# GET /api/notifications/
# =========================================================

@router.get("/")
def list_notifications(
    request: Request,
    unread_only: bool = False,
    limit: int = Query(default=30, ge=1, le=100),
    skip: int = Query(default=0, ge=0),
    user: dict = Depends(get_current_user),
):
    recipient_id = require_notification_user(user)

    query = {
        "recipient_id": recipient_id,
    }

    if unread_only:
        query["is_read"] = False

    try:
        collection = get_notifications_collection(request)

        notifications = list(
            collection.find(query)
            .sort("created_at", -1)
            .skip(skip)
            .limit(limit)
        )

        total = collection.count_documents({
            "recipient_id": recipient_id,
        })

        unread_count = collection.count_documents({
            "recipient_id": recipient_id,
            "is_read": False,
        })

        return {
            "success": True,
            "notifications": [
                serialize_notification(item)
                for item in notifications
            ],
            "total": total,
            "unread_count": unread_count,
            "limit": limit,
            "skip": skip,
        }

    except PyMongoError as exc:
        print(
            "Notification listing failed: "
            f"{type(exc).__name__}: {exc}"
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to load notifications.",
        )


# =========================================================
# GET UNREAD NOTIFICATION COUNT
# GET /api/notifications/unread-count
# =========================================================

@router.get("/unread-count")
def get_unread_count(
    request: Request,
    user: dict = Depends(get_current_user),
):
    recipient_id = require_notification_user(user)

    try:
        count = get_notifications_collection(
            request
        ).count_documents({
            "recipient_id": recipient_id,
            "is_read": False,
        })

        return {
            "success": True,
            "unread_count": count,
        }

    except PyMongoError as exc:
        print(
            "Unread count retrieval failed: "
            f"{type(exc).__name__}: {exc}"
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to retrieve unread notification count.",
        )


# =========================================================
# MARK ONE NOTIFICATION AS READ
# PATCH /api/notifications/{notification_id}/read
# =========================================================

@router.patch("/{notification_id}/read")
def mark_notification_read(
    notification_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    recipient_id = require_notification_user(user)
    collection = get_notifications_collection(request)

    notification = get_notification_for_user(
        request.app.state.db,
        notification_id,
        recipient_id,
    )

    try:
        if not notification.get("is_read", False):
            collection.update_one(
                {
                    "_id": notification["_id"],
                    "recipient_id": recipient_id,
                },
                {
                    "$set": {
                        "is_read": True,
                        "read_at": datetime.now(timezone.utc),
                    }
                },
            )

        updated = collection.find_one({
            "_id": notification["_id"],
            "recipient_id": recipient_id,
        })

        if not updated:
            raise HTTPException(
                status_code=404,
                detail="Notification not found.",
            )

        return {
            "success": True,
            "message": "Notification marked as read.",
            "notification": serialize_notification(updated),
        }

    except HTTPException:
        raise

    except PyMongoError as exc:
        print(
            "Mark notification as read failed: "
            f"{type(exc).__name__}: {exc}"
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to update notification.",
        )


# =========================================================
# MARK ALL NOTIFICATIONS AS READ
# PATCH /api/notifications/read-all
# =========================================================

@router.patch("/read-all")
def mark_all_notifications_read(
    request: Request,
    user: dict = Depends(get_current_user),
):
    recipient_id = require_notification_user(user)
    now = datetime.now(timezone.utc)

    try:
        result = get_notifications_collection(
            request
        ).update_many(
            {
                "recipient_id": recipient_id,
                "is_read": False,
            },
            {
                "$set": {
                    "is_read": True,
                    "read_at": now,
                }
            },
        )

        return {
            "success": True,
            "message": "All notifications marked as read.",
            "updated_count": result.modified_count,
        }

    except PyMongoError as exc:
        print(
            "Mark all notifications as read failed: "
            f"{type(exc).__name__}: {exc}"
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to update notifications.",
        )


# =========================================================
# DELETE ONE NOTIFICATION
# DELETE /api/notifications/{notification_id}
# =========================================================

@router.delete("/{notification_id}")
def delete_notification(
    notification_id: str,
    request: Request,
    user: dict = Depends(get_current_user),
):
    recipient_id = require_notification_user(user)
    db = request.app.state.db
    collection = get_notifications_collection(request)

    notification = get_notification_for_user(
        db,
        notification_id,
        recipient_id,
    )

    try:
        result = collection.delete_one({
            "_id": notification["_id"],
            "recipient_id": recipient_id,
        })

        if result.deleted_count == 0:
            raise HTTPException(
                status_code=404,
                detail="Notification not found.",
            )

        return {
            "success": True,
            "message": "Notification deleted successfully.",
            "deleted_notification_id": notification_id,
        }

    except HTTPException:
        raise

    except PyMongoError as exc:
        print(
            "Notification deletion failed: "
            f"{type(exc).__name__}: {exc}"
        )

        raise HTTPException(
            status_code=503,
            detail="Unable to delete notification.",
        )
