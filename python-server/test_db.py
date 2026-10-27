
from database import connect_mongodb

try:
    db = connect_mongodb()

    # Verify that the EventSphere database is accessible.
    result = db.command("ping")

    print("Connection test passed!")
    print("Database name:", db.name)

except Exception as error:
    print("Connection test failed:")
    print(error)
