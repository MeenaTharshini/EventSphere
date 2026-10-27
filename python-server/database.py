
import os
from pathlib import Path

import certifi
from dotenv import load_dotenv
from pymongo import MongoClient

# Get the python-server directory.
BASE_DIR = Path(__file__).resolve().parent

# Locate .env inside python-server.
ENV_FILE = BASE_DIR / ".env"

# Load environment variables.
load_dotenv(ENV_FILE)

# Read the MongoDB Atlas connection string.
MONGODB_URI = os.getenv("MONGODB_URI")

if not MONGODB_URI:
    raise RuntimeError(
        f"MONGODB_URI was not found in {ENV_FILE}. "
        "Please check your python-server/.env file."
    )

# Create the MongoDB Atlas client.
client = MongoClient(
    MONGODB_URI,
    tlsCAFile=certifi.where(),
    serverSelectionTimeoutMS=10000,
    connectTimeoutMS=10000,
)

# Select the EventSphere database.
db = client["eventsphere"]


def connect_mongodb():
    """Verify the MongoDB Atlas connection and return the database."""
    try:
        client.admin.command("ping")
        print("MongoDB Atlas connected successfully!")
        return db

    except Exception as exc:
        print(
            f"MongoDB connection failed: "
            f"{type(exc).__name__}: {exc}"
        )
        raise