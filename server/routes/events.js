
const express = require("express");
const jwt = require("jsonwebtoken");
const {
  getDatabase,
  saveDatabase
} = require("../db");

const router = express.Router();

// Authenticate the user using their JWT

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.split(" ")[1]
    : null;

  if (!token) {
    return res.status(401).json({
      message: "Authentication required. Please sign in again.",
    });
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) {
      return res.status(401).json({
        message: "Invalid or expired token. Please sign in again.",
      });
    }

    req.user = user;
    next();
  });
}


// Allow only specified roles
function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You are not allowed to perform this action."
      });
    }

    next();
  };
}

// Convert sql.js query results into objects
function rowsToObjects(result) {
  if (!result.length) return [];

  const { columns, values } = result[0];

  return values.map(row =>
    Object.fromEntries(
      columns.map((column, index) => [column, row[index]])
    )
  );
}

// GET all events
// All authenticated roles can view events
router.get("/", authenticateToken, (req, res) => {
  try {
    const db = getDatabase();

    const events = rowsToObjects(
      db.exec(`
        SELECT e.*, u.name AS organizer_name
        FROM events e
        LEFT JOIN users u ON e.organizer_id = u.id
        ORDER BY e.id DESC
      `)
    );

    res.json(events);
  } catch (error) {
    console.error("Fetch events error:", error);
    res.status(500).json({ message: "Failed to fetch events." });
  }
});

// GET one event by ID
router.get("/:id", authenticateToken, (req, res) => {
  try {
    const db = getDatabase();

    const events = rowsToObjects(
      db.exec("SELECT * FROM events WHERE id = ?", [
        req.params.id
      ])
    );

    if (!events.length) {
      return res.status(404).json({
        message: "Event not found."
      });
    }

    res.json(events[0]);
  } catch (error) {
    console.error("Fetch event error:", error);
    res.status(500).json({ message: "Failed to fetch event." });
  }
});

// CREATE event
// Admin and Organizer only
router.post(
  "/",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      const {
        name,
        type,
        event_date,
        venue,
        budget,
        status
      } = req.body;

      if (!name || !name.trim()) {
        return res.status(400).json({
          message: "Event name is required."
        });
      }

      const validStatuses = [
        "Planned",
        "Upcoming",
        "Ongoing",
        "Completed",
        "Cancelled"
      ];

      const eventStatus = status || "Planned";

      if (!validStatuses.includes(eventStatus)) {
        return res.status(400).json({
          message: "Invalid event status."
        });
      }

      const eventBudget =
        budget === undefined || budget === null || budget === ""
          ? 0
          : Number(budget);

      if (!Number.isFinite(eventBudget) || eventBudget < 0) {
        return res.status(400).json({
          message: "Budget must be a non-negative number."
        });
      }

      const db = getDatabase();

      db.run(
        `INSERT INTO events
         (name, type, event_date, venue, budget, status, organizer_id)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          name.trim(),
          type || null,
          event_date || null,
          venue || null,
          eventBudget,
          eventStatus,
          req.user.id
        ]
      );

      const result = db.exec("SELECT last_insert_rowid() AS id");
      const id = result[0].values[0][0];

      saveDatabase();

      res.status(201).json({
        message: "Event created successfully.",
        id
      });
    } catch (error) {
      console.error("Create event error:", error);
      res.status(500).json({ message: "Failed to create event." });
    }
  }
);

// UPDATE event
// Admin can update any event; Organizer only their own
router.put(
  "/:id",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      const db = getDatabase();
      const eventId = Number(req.params.id);

      if (!Number.isInteger(eventId) || eventId <= 0) {
        return res.status(400).json({
          message: "Invalid event ID."
        });
      }

      const existing = rowsToObjects(
        db.exec("SELECT * FROM events WHERE id = ?", [eventId])
      );

      if (!existing.length) {
        return res.status(404).json({
          message: "Event not found."
        });
      }

      if (
        req.user.role !== "Admin" &&
        existing[0].organizer_id !== req.user.id
      ) {
        return res.status(403).json({
          message: "You can only update your own events."
        });
      }

      const oldEvent = existing[0];
      const {
        name = oldEvent.name,
        type = oldEvent.type,
        event_date = oldEvent.event_date,
        venue = oldEvent.venue,
        budget = oldEvent.budget,
        status = oldEvent.status
      } = req.body;

      if (typeof name !== "string" || !name.trim()) {
        return res.status(400).json({
          message: "Event name is required."
        });
      }

      const validStatuses = [
        "Planned",
        "Upcoming",
        "Ongoing",
        "Completed",
        "Cancelled"
      ];

      const eventBudget = Number(budget);

      if (!Number.isFinite(eventBudget) || eventBudget < 0) {
        return res.status(400).json({
          message: "Budget must be a non-negative number."
        });
      }

      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          message: "Invalid event status."
        });
      }

      db.run(
        `UPDATE events
         SET name = ?, type = ?, event_date = ?, venue = ?,
             budget = ?, status = ?
         WHERE id = ?`,
        [
          name.trim(),
          type,
          event_date,
          venue,
          eventBudget,
          status,
          eventId
        ]
      );

      saveDatabase();

      res.json({ message: "Event updated successfully." });
    } catch (error) {
      console.error("Update event error:", error);
      res.status(500).json({ message: "Failed to update event." });
    }
  }
);

// DELETE event
// Admin can delete any event; Organizer only their own
router.delete(
  "/:id",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      const db = getDatabase();
      const eventId = Number(req.params.id);

      if (!Number.isInteger(eventId) || eventId <= 0) {
        return res.status(400).json({
          message: "Invalid event ID."
        });
      }

      const existing = rowsToObjects(
        db.exec("SELECT * FROM events WHERE id = ?", [eventId])
      );

      if (!existing.length) {
        return res.status(404).json({
          message: "Event not found."
        });
      }

      if (
        req.user.role !== "Admin" &&
        existing[0].organizer_id !== req.user.id
      ) {
        return res.status(403).json({
          message: "You can only delete your own events."
        });
      }

      db.run("DELETE FROM events WHERE id = ?", [eventId]);
      saveDatabase();

      res.json({ message: "Event deleted successfully." });
    } catch (error) {
      console.error("Delete event error:", error);
      res.status(500).json({ message: "Failed to delete event." });
    }
  }
);

module.exports = router;
