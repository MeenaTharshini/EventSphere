
from datetime import datetime, timezone
from getpass import getpass

from pymongo.errors import DuplicateKeyError

from database import db, client
from routes.auth import hash_password


def create_admin():
    users = db["users"]

    print("\n========== EventSphere Admin Setup ==========\n")

    # Prevent duplicate Admin accounts during initial setup.
    existing_admin = users.find_one({
        "role": {
            "$regex": "^(admin|administrator)$",
            "$options": "i"
        }
    })

    if existing_admin:
        print("An Admin account already exists.")
        print("Please use the Admin login portal.")
        return

    name = input("Enter Admin name: ").strip()
    email = input("Enter Admin email: ").strip().lower()

    if not name:
        print("Error: Admin name is required.")
        return

    if not email or "@" not in email:
        print("Error: Enter a valid email address.")
        return

    # Prevent using an email already registered to another role.
    if users.find_one({"email": email}):
        print("Error: This email is already registered.")
        print("Please use another email address.")
        return

    password = getpass("Enter Admin password: ")
    confirm_password = getpass("Confirm Admin password: ")

    if len(password) < 8:
        print("Error: Password must contain at least 8 characters.")
        return

    if password != confirm_password:
        print("Error: Passwords do not match.")
        return

    admin_document = {
        "name": name,
        "email": email,
        "password_hash": hash_password(password),
        "role": "Admin",
        "created_at": datetime.now(timezone.utc),
    }

    try:
        result = users.insert_one(admin_document)

        print("\nAdmin account created successfully!")
        print("-------------------------------------")
        print("Name :", name)
        print("Email:", email)
        print("Role : Admin")
        print("ID   :", result.inserted_id)
        print("-------------------------------------")
        print("You can now use the separate Admin login portal.")

    except DuplicateKeyError:
        print("Error: This email is already registered.")

    except Exception as exc:
        print(
            f"Unable to create Admin account: "
            f"{type(exc).__name__}: {exc}"
        )


if __name__ == "__main__":
    try:
        create_admin()
    finally:
        client.close()
