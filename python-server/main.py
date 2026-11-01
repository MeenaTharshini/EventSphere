
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from pymongo.errors import PyMongoError

from database import connect_mongodb, client

from routes.auth import router as auth_router
from routes.events import router as events_router
from routes.venues import router as venues_router
from routes.resources import router as resources_router
from routes.attendees import router as attendees_router
from routes.tickets import router as tickets_router
from routes.vendors import router as vendors_router


# ---------------------------------------------------------
# APPLICATION LIFESPAN
# ---------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI):
    """Connect to MongoDB and prepare required indexes."""

    try:
        db = connect_mongodb()
        app.state.db = db

        # Verify that MongoDB is reachable.
        db.command("ping")

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
            [("status", 1), ("category", 1)],
            name="vendor_status_category",
        )

        # Efficient vendor directory filtering by city.
        db["vendors"].create_index(
            [("status", 1), ("city", 1)],
            name="vendor_status_city",
        )

        print(f"MongoDB connected successfully: {db.name}")
        print("Digital ticket indexes are ready.")
        print("Vendor indexes are ready.")

        yield

    except Exception as exc:
        print(
            f"Application startup failed: "
            f"{type(exc).__name__}: {exc}"
        )
        raise

    finally:
        client.close()
        print("MongoDB connection closed.")


# ---------------------------------------------------------
# FASTAPI APPLICATION
# ---------------------------------------------------------

app = FastAPI(
    title="EventSphere API",
    description=(
        "Event management backend built with Python and MongoDB Atlas, "
        "including digital tickets, QR-code verification, "
        "and vendor management."
    ),
    version="1.2.0",
    lifespan=lifespan,
)


# ---------------------------------------------------------
# CORS CONFIGURATION
# ---------------------------------------------------------

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


# ---------------------------------------------------------
# API ROUTERS
# ---------------------------------------------------------

app.include_router(auth_router)
app.include_router(events_router)
app.include_router(venues_router)
app.include_router(resources_router)
app.include_router(attendees_router)
app.include_router(tickets_router)
app.include_router(vendors_router)


# ---------------------------------------------------------
# ROOT ENDPOINT
# GET /
# ---------------------------------------------------------

@app.get("/", tags=["Health"])
def root():
    return {
        "success": True,
        "message": "Welcome to EventSphere Python API!",
    }


# ---------------------------------------------------------
# API HEALTH CHECK
# GET /api/health
# ---------------------------------------------------------

@app.get("/api/health", tags=["Health"])
def health():
    return {
        "success": True,
        "message": "EventSphere Python backend is running!",
    }


# ---------------------------------------------------------
# DATABASE HEALTH CHECK
# GET /api/db-health
# ---------------------------------------------------------

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
