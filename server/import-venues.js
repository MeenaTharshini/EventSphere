
const fs = require("fs");
const initSqlJs = require("sql.js");
const path = require("path");

const dbPath = path.join(__dirname, "eventsphere.db");
const sqlPath = path.join(
  process.env.USERPROFILE,
  "Downloads",
  "event-management-sample-database-v1-sql-sqlite.sql"
);

async function main() {
  if (!fs.existsSync(dbPath)) {
    throw new Error("EventSphere database not found.");
  }

  if (!fs.existsSync(sqlPath)) {
    throw new Error("Sample SQL dataset not found.");
  }

  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));

  const source = fs.readFileSync(sqlPath, "utf8");
  const match = source.match(
    /INSERT INTO "venues" \("id", "address", "capacity", "city", "country", "name", "postal_code", "state"\) VALUES([\s\S]*?);/
  );

  if (!match) {
    throw new Error("Could not find the venue records in the dataset.");
  }

  const rows = [...match[1].matchAll(
    /\(\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*,\s*(\d+)\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*,\s*'((?:''|[^'])*)'\s*\)/g
  )];

  if (rows.length !== 25) {
    throw new Error(
      `Expected 25 venue records, but parsed ${rows.length}. No changes made.`
    );
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO venues
      (name, address, capacity, city, state, country, postal_code)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  let added = 0;

  try {
    db.run("BEGIN TRANSACTION");

    for (const row of rows) {
      const [
        ,
        ,
        address,
        capacity,
        city,
        country,
        name,
        postalCode,
        state
      ] = row;

      insert.run([
        name.replace(/''/g, "'"),
        address.replace(/''/g, "'"),
        Number(capacity),
        city.replace(/''/g, "'"),
        state.replace(/''/g, "'"),
        country.replace(/''/g, "'"),
        postalCode.replace(/''/g, "'")
      ]);

      added += db.getRowsModified();
    }

    db.run("COMMIT");

    fs.writeFileSync(dbPath, Buffer.from(db.export()));

    console.log(`Import complete. New venues added: ${added}`);
    console.log(
      "Total venues:",
      db.exec("SELECT COUNT(*) FROM venues")[0].values[0][0]
    );
  } catch (error) {
    try {
      db.run("ROLLBACK");
    } catch {}

    throw error;
  } finally {
    insert.free();
    db.close();
  }
}

main().catch(error => {
  console.error("Venue import failed:", error.message);
  process.exitCode = 1;
});
