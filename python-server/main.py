
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import PyMongoError

from database import connect_mongodb, client

# ---------------------------------------------------------
# ROUTE IMPORTS
# ---------------------------------------------------------

from routes.auth import router as auth_router
from routes.events import router as events_router
from routes.venues import router as venues_router
from routes.resources import router as resources_router
from routes.attendees import router as attendees_router
from routes.tickets import router as tickets_router
from routes.vendors import router as vendors_router
from routes.budgets import router as budgets_router
from routes.sponsorships import router as sponsorships_router
from routes.notifications import router as notifications_router

# ---------------------------------------------------------
# SCHEDULER IMPORTS
# ---------------------------------------------------------

from scheduler.reminder_scheduler import (
    start_reminder_scheduler,
    stop_reminder_scheduler,
)


# =========================================================
# APPLICATION LIFESPAN
# =========================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Application startup and shutdown lifecycle.

    Startup:
        1. Connect to MongoDB.
        2. Verify database connectivity.
        3. Create required indexes.
        4. Start automatic event reminder scheduler.

    Shutdown:
        1. Stop the reminder scheduler.
        2. Close MongoDB connection.
    """

    scheduler_started = False

    try:
        # -------------------------------------------------
        # MONGODB CONNECTION
        # -------------------------------------------------

        db = connect_mongodb()

        app.state.db = db

        # Verify MongoDB connectivity.
        db.command("ping")

        print(f"MongoDB connected successfully: {db.name}")

        # -------------------------------------------------
        # DIGITAL TICKET INDEXES
        # -------------------------------------------------

        # Every ticket must have a unique ticket ID.
        db["tickets"].create_index(
            [("ticket_id", 1)],
            unique=True,
            name="unique_ticket_id",
        )

        # Each registration can have only one digital ticket.
        db["tickets"].create_index(
            [("registration_id", 1)],
            unique=True,
            name="unique_ticket_registration",
        )

        print("Digital ticket indexes are ready.")

        # -------------------------------------------------
        # NOTIFICATION INDEXES
        # -------------------------------------------------

        # Efficient notification retrieval.
        db["notifications"].create_index(
            [
                ("recipient_id", 1),
                ("created_at", -1),
            ],
            name="notification_recipient_created",
        )

        # Efficient unread notification filtering.
        db["notifications"].create_index(
            [
                ("recipient_id", 1),
                ("is_read", 1),
            ],
            name="notification_recipient_read",
        )

        # Prevent duplicate reminder notifications.
        db["notifications"].create_index(
            [
                ("recipient_id", 1),
                ("dedupe_key", 1),
            ],
            unique=True,
            partialFilterExpression={
                "dedupe_key": {
                    "$type": "string"
                }
            },
            name="unique_notification_dedupe",
        )

        print("Notification indexes are ready.")

        # -------------------------------------------------
        # VENDOR INDEXES
        # -------------------------------------------------

        # One vendor profile per user account.
        db["vendors"].create_index(
            [("user_id", 1)],
            unique=True,
            name="unique_vendor_user_id",
        )

        # Efficient filtering of approved vendor profiles.
        db["vendors"].create_index(
            [
                ("status", 1),
                ("category", 1),
            ],
            name="vendor_status_category",
        )

        # Efficient vendor directory filtering by city.
        db["vendors"].create_index(
            [
                ("status", 1),
                ("city", 1),
            ],
            name="vendor_status_city",
        )

        print("Vendor indexes are ready.")

        # -------------------------------------------------
        # START EVENT REMINDER SCHEDULER
        # -------------------------------------------------

        start_reminder_scheduler(db)

        scheduler_started = True

        print("Event reminder scheduler started successfully.")

        # -------------------------------------------------
        # APPLICATION READY
        # -------------------------------------------------

        print("--------------------------------------------")
        print("EventSphere API is ready.")
        print(f"Database : {db.name}")
        print("Scheduler: Active")
        print("--------------------------------------------")

        yield

    except Exception as exc:
        print(
            "Application startup/runtime failed: "
            f"{type(exc).__name__}: {exc}"
        )

        raise

    finally:
        # -------------------------------------------------
        # STOP SCHEDULER
        # -------------------------------------------------

        if scheduler_started:
            try:
                stop_reminder_scheduler()

                print("Event reminder scheduler stopped.")

            except Exception as exc:
                print(
                    "Scheduler shutdown failed: "
                    f"{type(exc).__name__}: {exc}"
                )

        # -------------------------------------------------
        # CLOSE MONGODB CONNECTION
        # -------------------------------------------------

        try:
            client.close()

            print("MongoDB connection closed.")

        except Exception as exc:
            print(
                "MongoDB shutdown failed: "
                f"{type(exc).__name__}: {exc}"
            )


# =========================================================
# FASTAPI APPLICATION
# =========================================================

app = FastAPI(
    title="EventSphere API",
    description=(
        "Event management backend built with Python and MongoDB Atlas, "
        "including digital tickets, QR-code verification, "
        "vendor management, notifications, and automated event reminders."
    ),
    version="1.3.0",
    lifespan=lifespan,
)


# =========================================================
# CORS CONFIGURATION
# =========================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# =========================================================
# API ROUTERS
# =========================================================

app.include_router(auth_router)
app.include_router(events_router)
app.include_router(venues_router)
app.include_router(resources_router)
app.include_router(attendees_router)
app.include_router(tickets_router)
app.include_router(vendors_router)
app.include_router(budgets_router)
app.include_router(sponsorships_router)
app.include_router(notifications_router)


# =========================================================
# ROOT ENDPOINT
# GET /
# =========================================================

@app.get("/", tags=["Health"])
def root():
    return {
        "success": True,
        "message": "Welcome to EventSphere Python API!",
    }


# =========================================================
# API HEALTH CHECK
# GET /api/health
# =========================================================

@app.get("/api/health", tags=["Health"])
def health():
    return {
        "success": True,
        "message": "EventSphere Python backend is running!",
    }


# =========================================================
# DATABASE HEALTH CHECK
# GET /api/db-health
# =========================================================

@app.get("/api/db-health", tags=["Health"])
def database_health():
    try:
        db = app.state.db

        db.command("ping")

        return {
            "success": True,
            "message": "MongoDB Atlas is connected!",
            "database": db.name,
        }

    except PyMongoError:
        return {
            "success": False,
            "message": "MongoDB connection check failed.",
        }
