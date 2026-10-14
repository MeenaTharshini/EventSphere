
const express = require("express");
const jwt = require("jsonwebtoken");
const { getDatabase, saveDatabase } = require("../db");

const router = express.Router();

function authenticateToken(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ")
    ? header.split(" ")[1]
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
  if (!result.length) return [];

  const { columns, values } = result[0];

  return values.map((row) =>
    Object.fromEntries(
      columns.map((column, index) => [column, row[index]])
    )
  );
}

function validateVenue(body) {
  const {
    name,
    address = "",
    city = "",
    state = "",
    country = "",
    postal_code = "",
    capacity = 0,
    cost_per_day = 0,
  } = body;

  if (typeof name !== "string" || !name.trim()) {
    return { error: "Venue name is required." };
  }

  for (const [label, value] of [
    ["Address", address],
    ["City", city],
    ["State", state],
    ["Country", country],
    ["Postal code", postal_code],
  ]) {
    if (typeof value !== "string") {
      return { error: `${label} must be text.` };
    }
  }

  const numericCapacity = Number(capacity);
  const numericCost = Number(cost_per_day);

  if (
    !Number.isInteger(numericCapacity) ||
    numericCapacity < 0
  ) {
    return { error: "Capacity must be a non-negative whole number." };
  }

  if (!Number.isFinite(numericCost) || numericCost < 0) {
    return { error: "Venue cost must be a non-negative number." };
  }

  return {
    value: {
      name: name.trim(),
      address: address.trim(),
      city: city.trim(),
      state: state.trim(),
      country: country.trim(),
      postal_code: postal_code.trim(),
      capacity: numericCapacity,
      cost_per_day: numericCost,
    },
  };
}

// GET all venues
router.get("/", authenticateToken, (req, res) => {
  try {
    const db = getDatabase();
    const venues = rowsToObjects(
      db.exec("SELECT * FROM venues ORDER BY name COLLATE NOCASE")
    );

    res.json(venues);
  } catch (error) {
    console.error("Fetch venues error:", error);
    res.status(500).json({ message: "Failed to fetch venues." });
  }
});

// GET one venue
router.get("/:id", authenticateToken, (req, res) => {
  try {
    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ message: "Invalid venue ID." });
    }

    const db = getDatabase();
    const venues = rowsToObjects(
      db.exec("SELECT * FROM venues WHERE id = ?", [id])
    );

    if (!venues.length) {
      return res.status(404).json({ message: "Venue not found." });
    }

    res.json(venues[0]);
  } catch (error) {
    console.error("Fetch venue error:", error);
    res.status(500).json({ message: "Failed to fetch venue." });
  }
});

// CREATE venue
router.post(
  "/",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      const validation = validateVenue(req.body);

      if (validation.error) {
        return res.status(400).json({ message: validation.error });
      }

      const v = validation.value;
      const db = getDatabase();

      db.run(
        `INSERT INTO venues
          (name, address, city, state, country, postal_code,
           capacity, cost_per_day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          v.name, v.address, v.city, v.state, v.country,
          v.postal_code, v.capacity, v.cost_per_day,
        ]
      );

      const id = db.exec("SELECT last_insert_rowid() AS id")[0].values[0][0];
      saveDatabase();

      res.status(201).json({
        message: "Venue created successfully.",
        id,
      });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        return res.status(409).json({
          message: "A venue with this name already exists.",
        });
      }

      console.error("Create venue error:", error);
      res.status(500).json({ message: "Failed to create venue." });
    }
  }
);

// UPDATE venue
router.put(
  "/:id",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid venue ID." });
      }

      const db = getDatabase();
      const existing = rowsToObjects(
        db.exec("SELECT id FROM venues WHERE id = ?", [id])
      );

      if (!existing.length) {
        return res.status(404).json({ message: "Venue not found." });
      }

      const validation = validateVenue(req.body);

      if (validation.error) {
        return res.status(400).json({ message: validation.error });
      }

      const v = validation.value;

      db.run(
        `UPDATE venues
         SET name = ?, address = ?, city = ?, state = ?,
             country = ?, postal_code = ?, capacity = ?, cost_per_day = ?
         WHERE id = ?`,
        [
          v.name, v.address, v.city, v.state, v.country,
          v.postal_code, v.capacity, v.cost_per_day, id,
        ]
      );

      saveDatabase();
      res.json({ message: "Venue updated successfully." });
    } catch (error) {
      if (String(error.message).includes("UNIQUE")) {
        return res.status(409).json({
          message: "A venue with this name already exists.",
        });
      }

      console.error("Update venue error:", error);
      res.status(500).json({ message: "Failed to update venue." });
    }
  }
);

// DELETE venue
router.delete(
  "/:id",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ message: "Invalid venue ID." });
      }

      const db = getDatabase();
      const existing = rowsToObjects(
        db.exec("SELECT id FROM venues WHERE id = ?", [id])
      );

      if (!existing.length) {
        return res.status(404).json({ message: "Venue not found." });
      }

      db.run("DELETE FROM venues WHERE id = ?", [id]);
      saveDatabase();

      res.json({ message: "Venue deleted successfully." });
    } catch (error) {
      console.error("Delete venue error:", error);
      res.status(500).json({ message: "Failed to delete venue." });
    }
  }
);

module.exports = router;
