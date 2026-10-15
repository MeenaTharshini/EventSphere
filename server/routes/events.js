
const express = require("express");
const jwt = require("jsonwebtoken");
const { getDatabase, saveDatabase } = require("../db");

const router = express.Router();

function authenticateToken(req, res, next) {
  const authHeader = req.headers.authorization;
  const token = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : null;

  if (!token) {
    return res.status(401).json({
      message: "Authentication required. Please sign in again.",
    });
  }

  if (!process.env.JWT_SECRET) {
    return res.status(500).json({
      message: "JWT_SECRET is not configured on the server.",
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

function allowRoles(...roles) {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return res.status(403).json({
        message: "You are not allowed to perform this action.",
      });
    }
    next();
  };
}

function rowsToObjects(result) {
  if (!result || !result.length) return [];

  const { columns, values } = result[0];

  return values.map((row) =>
    Object.fromEntries(
      columns.map((column, index) => [column, row[index]])
    )
  );
}

function getTableColumns(db, tableName) {
  return rowsToObjects(
    db.exec(`PRAGMA table_info(${tableName})`)
  ).map((column) => column.name);
}

function hasColumn(columns, name) {
  return columns.includes(name);
}

function getEventStatus(status) {
  const value = String(status || "Scheduled").trim().toLowerCase();

  const statuses = {
    planned: "Scheduled",
    upcoming: "Scheduled",
    scheduled: "Scheduled",
    confirmed: "Confirmed",
    ongoing: "Confirmed",
    completed: "Confirmed",
    pending: "Pending",
    cancelled: "Cancelled",
  };

  return statuses[value] || null;
}

function normalizeEvent(event) {
  return {
    ...event,
    event_type: event.event_type ?? event.type ?? "Other",
    event_date: event.event_date ?? event.date ?? "",
    venue_id: event.venue_id ?? event.venueId ?? null,
    venue_name: event.venue_name ?? event.venue ?? null,
    start_time: event.start_time ?? "10:00",
    end_time: event.end_time ?? "16:00",
    attendee_count: Number(event.attendee_count ?? 0),
    status: getEventStatus(event.status) || event.status || "Scheduled",
  };
}

function getExistingEvent(db, id) {
  return rowsToObjects(
    db.exec("SELECT * FROM events WHERE id = ?", [id])
  )[0];
}

function validatePayload(body) {
  const name = String(body.name || "").trim();

  if (!name) return "Event name is required.";

  if (name.length > 150) {
    return "Event name must be 150 characters or fewer.";
  }

  const eventDate = String(body.event_date || body.date || "");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(eventDate)) {
    return "Please provide a valid event date.";
  }

  const startTime = String(body.start_time || "10:00");
  const endTime = String(body.end_time || "16:00");

  const timeToMinutes = (time) => {
    const match = time.match(/^([01]\d|2[0-3]):([0-5]\d)$/);
    return match ? Number(match[1]) * 60 + Number(match[2]) : NaN;
  };

  if (
    !Number.isFinite(timeToMinutes(startTime)) ||
    !Number.isFinite(timeToMinutes(endTime)) ||
    timeToMinutes(startTime) >= timeToMinutes(endTime)
  ) {
    return "End time must be later than start time.";
  }

  const attendeeCount = Number(body.attendee_count ?? 0);

  if (!Number.isInteger(attendeeCount) || attendeeCount < 0) {
    return "Attendee count must be a non-negative whole number.";
  }

  const status = getEventStatus(body.status);

  if (!status) {
    return "Invalid event status.";
  }

  return null;
}

function buildEventPayload(body, oldEvent = {}) {
  return {
    name: String(body.name ?? oldEvent.name ?? "").trim(),
    event_type:
      body.event_type ?? body.type ?? oldEvent.event_type ?? oldEvent.type ?? "Conference",
    event_date: body.event_date ?? body.date ?? oldEvent.event_date ?? "",
    start_time: body.start_time ?? oldEvent.start_time ?? "10:00",
    end_time: body.end_time ?? oldEvent.end_time ?? "16:00",
    venue_id: body.venue_id ?? oldEvent.venue_id ?? null,
    venue: body.venue ?? oldEvent.venue ?? null,
    attendee_count: Number(
      body.attendee_count ?? oldEvent.attendee_count ?? 0
    ),
    status: getEventStatus(body.status ?? oldEvent.status ?? "Scheduled"),
    budget: Number(body.budget ?? oldEvent.budget ?? 0),
    resource_ids: Array.isArray(body.resource_ids)
      ? body.resource_ids
      : [],
  };
}

function findVenue(db, venueId) {
  if (venueId === null || venueId === undefined || venueId === "") {
    return null;
  }

  const venueColumns = getTableColumns(db, "venues");

  if (!hasColumn(venueColumns, "id")) return null;

  return rowsToObjects(
    db.exec("SELECT * FROM venues WHERE id = ?", [Number(venueId)])
  )[0] || null;
}


function checkVenueConflict(db, payload, ignoredId = null) {
  if (
    payload.venue_id === null ||
    payload.venue_id === undefined ||
    payload.venue_id === ""
  ) {
    return null;
  }

  const columns = getTableColumns(db, "events");

  const requiredColumns = [
    "venue_id",
    "start_time",
    "end_time",
  ];

  if (
    !requiredColumns.every((column) => hasColumn(columns, column)) ||
    (!hasColumn(columns, "event_date") && !hasColumn(columns, "date"))
  ) {
    throw new Error(
      "Cannot verify venue conflicts: required event date/time columns are missing."
    );
  }

  const dateColumn = hasColumn(columns, "event_date")
    ? "event_date"
    : "date";

  const events = rowsToObjects(
    db.exec(
      `SELECT * FROM events
       WHERE CAST(venue_id AS INTEGER) = ?
         AND "${dateColumn}" = ?
         AND LOWER(TRIM(COALESCE(status, 'scheduled'))) <> 'cancelled'
         AND (? IS NULL OR id <> ?)`,
      [
        Number(payload.venue_id),
        payload.event_date,
        ignoredId,
        ignoredId,
      ]
    )
  );

  const toMinutes = (value) => {
    const match = String(value ?? "").match(
      /^([01]?\d|2[0-3]):([0-5]\d)$/
    );

    if (!match) return NaN;

    return Number(match[1]) * 60 + Number(match[2]);
  };

  const newStart = toMinutes(payload.start_time);
  const newEnd = toMinutes(payload.end_time);

  if (
    !Number.isFinite(newStart) ||
    !Number.isFinite(newEnd) ||
    newStart >= newEnd
  ) {
    return "Please provide a valid event time range.";
  }

  const conflictingEvent = events.find((event) => {
    const existingStart = toMinutes(event.start_time);
    const existingEnd = toMinutes(event.end_time);

    if (
      !Number.isFinite(existingStart) ||
      !Number.isFinite(existingEnd) ||
      existingStart >= existingEnd
    ) {
      return false;
    }

    return (
      newStart < existingEnd &&
      existingStart < newEnd
    );
  });

  if (conflictingEvent) {
    return `This venue is already booked by "${conflictingEvent.name}" from ${conflictingEvent.start_time} to ${conflictingEvent.end_time} on this date. Please choose another time or venue.`;
  }

  return null;
}


// GET all events
router.get("/", authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const columns = getTableColumns(db, "events");

    const events = rowsToObjects(
      db.exec("SELECT * FROM events ORDER BY id DESC")
    ).map(normalizeEvent);

    const venueColumns = getTableColumns(db, "venues");

    const enriched = events.map((event) => {
      const venue = event.venue_id
        ? findVenue(db, event.venue_id)
        : null;

      return {
        ...event,
        venue_name:
          venue?.name ?? event.venue_name ?? event.venue ?? null,
      };
    });

    res.json(enriched);
  } catch (error) {
    console.error("Fetch events error:", error);
    res.status(500).json({
      message: "Failed to fetch events.",
    });
  }
});

// GET one event
router.get("/:id", authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid event ID." });
    }

    const event = getExistingEvent(db, id);

    if (!event) {
      return res.status(404).json({ message: "Event not found." });
    }

    const venue = event.venue_id
      ? findVenue(db, event.venue_id)
      : null;

    res.json({
      ...normalizeEvent(event),
      venue_name: venue?.name ?? event.venue ?? null,
    });
  } catch (error) {
    console.error("Fetch event error:", error);
    res.status(500).json({ message: "Failed to fetch event." });
  }
});

// CREATE event
router.post(
  "/",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      const db = getDatabase();
      const payload = buildEventPayload(req.body);

      const validationError = validatePayload({
        ...req.body,
        status: payload.status,
      });

      if (validationError) {
        return res.status(400).json({ message: validationError });
      }

      const venue = findVenue(db, payload.venue_id);

      if (!venue) {
        return res.status(400).json({
          message: "Please select a valid venue.",
        });
      }

      const capacity = Number(venue.capacity || 0);

      if (capacity > 0 && payload.attendee_count > capacity) {
        return res.status(400).json({
          message: `This venue can accommodate ${capacity} attendees only.`,
        });
      }

      const conflict = checkVenueConflict(db, payload);

      if (conflict) {
        return res.status(400).json({ message: conflict });
      }

      const columns = getTableColumns(db, "events");

      const valuesByColumn = {
        name: payload.name,
        type: payload.event_type,
        event_type: payload.event_type,
        event_date: payload.event_date,
        date: payload.event_date,
        start_time: payload.start_time,
        end_time: payload.end_time,
        venue_id: Number(payload.venue_id),
        venue: venue.name,
        attendee_count: payload.attendee_count,
        status: payload.status,
        budget: payload.budget,
        organizer_id: req.user.id,
      };

      const insertColumns = columns.filter(
        (column) =>
          Object.prototype.hasOwnProperty.call(valuesByColumn, column) &&
          column !== "id"
      );

      if (!insertColumns.includes("name")) {
        return res.status(500).json({
          message: "The events table is missing its name column.",
        });
      }

      const placeholders = insertColumns.map(() => "?").join(", ");
      const columnList = insertColumns.map((column) => `"${column}"`).join(", ");
      const values = insertColumns.map((column) => valuesByColumn[column]);

      db.run(
        `INSERT INTO events (${columnList}) VALUES (${placeholders})`,
        values
      );

      const result = db.exec("SELECT last_insert_rowid() AS id");
      const id = result[0].values[0][0];

      saveDatabase();

      res.status(201).json({
        message: "Event scheduled successfully.",
        id,
      });
    } catch (error) {
      console.error("Create event error:", error);
      res.status(500).json({
        message: "Failed to create event.",
        detail: error.message,
      });
    }
  }
);

// UPDATE event
router.put(
  "/:id",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      const db = getDatabase();
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid event ID." });
      }

      const oldEvent = getExistingEvent(db, id);

      if (!oldEvent) {
        return res.status(404).json({ message: "Event not found." });
      }

      if (
        req.user.role !== "Admin" &&
        Number(oldEvent.organizer_id) !== Number(req.user.id)
      ) {
        return res.status(403).json({
          message: "You can only update your own events.",
        });
      }

      const payload = buildEventPayload(req.body, oldEvent);
      const validationError = validatePayload({
        ...payload,
        status: payload.status,
      });

      if (validationError) {
        return res.status(400).json({ message: validationError });
      }

      const venue = findVenue(db, payload.venue_id);

      if (!venue) {
        return res.status(400).json({
          message: "Please select a valid venue.",
        });
      }

      const capacity = Number(venue.capacity || 0);

      if (capacity > 0 && payload.attendee_count > capacity) {
        return res.status(400).json({
          message: `This venue can accommodate ${capacity} attendees only.`,
        });
      }

      const conflict = checkVenueConflict(db, payload, id);

      if (conflict) {
        return res.status(400).json({ message: conflict });
      }

      const columns = getTableColumns(db, "events");

      const valuesByColumn = {
        name: payload.name,
        type: payload.event_type,
        event_type: payload.event_type,
        event_date: payload.event_date,
        date: payload.event_date,
        start_time: payload.start_time,
        end_time: payload.end_time,
        venue_id: Number(payload.venue_id),
        venue: venue.name,
        attendee_count: payload.attendee_count,
        status: payload.status,
        budget: payload.budget,
      };

      const updateColumns = columns.filter(
        (column) =>
          Object.prototype.hasOwnProperty.call(valuesByColumn, column) &&
          column !== "id" &&
          column !== "organizer_id"
      );

      const assignments = updateColumns
        .map((column) => `"${column}" = ?`)
        .join(", ");

      const values = updateColumns.map((column) => valuesByColumn[column]);
      values.push(id);

      db.run(
        `UPDATE events SET ${assignments} WHERE id = ?`,
        values
      );

      saveDatabase();

      res.json({ message: "Event schedule updated successfully." });
    } catch (error) {
      console.error("Update event error:", error);
      res.status(500).json({
        message: "Failed to update event.",
        detail: error.message,
      });
    }
  }
);

// DELETE event
router.delete(
  "/:id",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      const db = getDatabase();
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid event ID." });
      }

      const event = getExistingEvent(db, id);

      if (!event) {
        return res.status(404).json({ message: "Event not found." });
      }

      if (
        req.user.role !== "Admin" &&
        Number(event.organizer_id) !== Number(req.user.id)
      ) {
        return res.status(403).json({
          message: "You can only delete your own events.",
        });
      }

      db.run("DELETE FROM events WHERE id = ?", [id]);
      saveDatabase();

      res.json({ message: "Event deleted successfully." });
    } catch (error) {
      console.error("Delete event error:", error);
      res.status(500).json({
        message: "Failed to delete event.",
      });
    }
  }
);

module.exports = router;