
const initSqlJs = require("sql.js");
const fs = require("fs");
const path = require("path");

const dbPath = path.join(__dirname, "eventsphere.db");

let db;

async function initializeDatabase() {
  const SQL = await initSqlJs();

  if (fs.existsSync(dbPath)) {
    const fileBuffer = fs.readFileSync(dbPath);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  db.run("PRAGMA foreign_keys = ON");

  // Existing users table
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

  // Existing events table
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

  // New venues table
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

  saveDatabase();

  console.log("EventSphere database initialized successfully!");
  return db;
}

function saveDatabase() {
  if (!db) throw new Error("Database is not initialized");

  const data = db.export();
  fs.writeFileSync(dbPath, Buffer.from(data));
}

module.exports = {
  initializeDatabase,
  saveDatabase,
  getDatabase: () => db
};
