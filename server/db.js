
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "eventsphere.db");

let db;

async function initializeDatabase() {
  const SQL = await initSqlJs();

  // Load the existing database or create a new one.
  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys = ON");

  // Users table
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL
        CHECK (role IN ('Admin', 'Organizer', 'Vendor', 'Attendee')),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Events table
  db.run(`
    CREATE TABLE IF NOT EXISTS events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT,
      event_date TEXT,
      venue TEXT,
      budget REAL DEFAULT 0,
      status TEXT DEFAULT 'Planned',
      organizer_id INTEGER,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (organizer_id) REFERENCES users(id)
    )
  `);

  // Venues table
  db.run(`
    CREATE TABLE IF NOT EXISTS venues (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE,
      address TEXT NOT NULL DEFAULT '',
      city TEXT NOT NULL DEFAULT '',
      state TEXT NOT NULL DEFAULT '',
      country TEXT NOT NULL DEFAULT '',
      postal_code TEXT NOT NULL DEFAULT '',
      capacity INTEGER NOT NULL DEFAULT 0
        CHECK (capacity >= 0),
      cost_per_day REAL NOT NULL DEFAULT 0
        CHECK (cost_per_day >= 0),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Migrate existing events table for scheduling.
  const eventInfo = db.exec("PRAGMA table_info(events)");

  const eventColumns = eventInfo.length
    ? eventInfo[0].values.map((column) => column[1])
    : [];

  function addColumnIfMissing(columnName, definition) {
    if (!eventColumns.includes(columnName)) {
      db.run(
        `ALTER TABLE events ADD COLUMN "${columnName}" ${definition}`
      );
      eventColumns.push(columnName);
    }
  }

  addColumnIfMissing("venue_id", "INTEGER");
  addColumnIfMissing("start_time", "TEXT DEFAULT '10:00'");
  addColumnIfMissing("end_time", "TEXT DEFAULT '16:00'");
  addColumnIfMissing("attendee_count", "INTEGER DEFAULT 0");

  // Link existing events to venues by matching venue names.
  const existingEvents = db.exec(
    "SELECT id, venue FROM events WHERE venue_id IS NULL"
  );

  if (existingEvents.length) {
    for (const [eventId, venueName] of existingEvents[0].values) {
      if (!venueName || !String(venueName).trim()) {
        continue;
      }

      const matchingVenue = db.exec(
        `SELECT id
         FROM venues
         WHERE LOWER(TRIM(name)) = LOWER(TRIM(?))
         LIMIT 1`,
        [String(venueName)]
      );

      if (matchingVenue.length && matchingVenue[0].values.length) {
        const venueId = matchingVenue[0].values[0][0];

        db.run(
          "UPDATE events SET venue_id = ? WHERE id = ?",
          [venueId, eventId]
        );
      }
    }
  }

  // Persist the schema migration and data.
  saveDatabase();

  console.log("EventSphere database initialized successfully!");

  return db;
}

function saveDatabase() {
  if (!db) {
    throw new Error("Database is not initialized");
  }

  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

module.exports = {
  initializeDatabase,
  saveDatabase,
  getDatabase: () => db,
};
