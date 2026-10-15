
const express = require("express");
const jwt = require("jsonwebtoken");
const { getDatabase, saveDatabase } = require("../db");

const router = express.Router();

// Allowed resource types
const RESOURCE_TYPES = [
  "Audio",
  "Lighting",
  "Furniture",
  "Catering",
  "Decoration",
  "Photography",
  "Video",
  "Other",
];

// Authentication middleware
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

  if (!process.env.JWT_SECRET) {
    console.error("JWT_SECRET is not configured.");

    return res.status(500).json({
      message: "Authentication configuration error.",
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

// Role-based authorization
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

// Convert SQL.js results into JavaScript objects
function rowsToObjects(result) {
  if (!result.length) return [];

  const { columns, values } = result[0];

  return values.map((row) =>
    Object.fromEntries(
      columns.map((column, index) => [column, row[index]])
    )
  );
}

// Create the resources table if it doesn't exist
function ensureResourcesTable() {
  const db = getDatabase();

  db.run(`
    CREATE TABLE IF NOT EXISTS resources (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      type TEXT NOT NULL DEFAULT 'Other',
      description TEXT NOT NULL DEFAULT '',
      quantity INTEGER NOT NULL DEFAULT 1
        CHECK (quantity >= 0),
      unit_cost REAL NOT NULL DEFAULT 0
        CHECK (unit_cost >= 0),
      availability_status TEXT NOT NULL DEFAULT 'Available'
        CHECK (
          availability_status IN (
            'Available',
            'Unavailable',
            'Maintenance'
          )
        ),
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )
  `);

  saveDatabase();
}

// Validate incoming resource data
function validateResource(body) {
  const {
    name,
    type = "Other",
    description = "",
    quantity = 1,
    unit_cost = 0,
    availability_status = "Available",
  } = body;

  if (typeof name !== "string" || !name.trim()) {
    return { error: "Resource name is required." };
  }

  if (
    typeof type !== "string" ||
    !RESOURCE_TYPES.includes(type)
  ) {
    return {
      error: `Resource type must be one of: ${RESOURCE_TYPES.join(", ")}.`,
    };
  }

  if (typeof description !== "string") {
    return { error: "Description must be text." };
  }

  const numericQuantity = Number(quantity);
  const numericCost = Number(unit_cost);

  if (
    !Number.isInteger(numericQuantity) ||
    numericQuantity < 0
  ) {
    return {
      error: "Quantity must be a non-negative whole number.",
    };
  }

  if (!Number.isFinite(numericCost) || numericCost < 0) {
    return {
      error: "Unit cost must be a non-negative number.",
    };
  }

  const allowedStatuses = [
    "Available",
    "Unavailable",
    "Maintenance",
  ];

  if (!allowedStatuses.includes(availability_status)) {
    return {
      error: `Availability status must be one of: ${allowedStatuses.join(", ")}.`,
    };
  }

  return {
    value: {
      name: name.trim(),
      type,
      description: description.trim(),
      quantity: numericQuantity,
      unit_cost: numericCost,
      availability_status,
    },
  };
}

// GET all resources
router.get("/", authenticateToken, (req, res) => {
  try {
    ensureResourcesTable();

    const db = getDatabase();

    const resources = rowsToObjects(
      db.exec(`
        SELECT *
        FROM resources
        ORDER BY name COLLATE NOCASE
      `)
    );

    res.json(resources);
  } catch (error) {
    console.error("Fetch resources error:", error);

    res.status(500).json({
      message: "Failed to fetch resources.",
    });
  }
});

// GET one resource
router.get("/:id", authenticateToken, (req, res) => {
  try {
    ensureResourcesTable();

    const id = Number(req.params.id);

    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({
        message: "Invalid resource ID.",
      });
    }

    const db = getDatabase();

    const resources = rowsToObjects(
      db.exec(
        "SELECT * FROM resources WHERE id = ?",
        [id]
      )
    );

    if (!resources.length) {
      return res.status(404).json({
        message: "Resource not found.",
      });
    }

    res.json(resources[0]);
  } catch (error) {
    console.error("Fetch resource error:", error);

    res.status(500).json({
      message: "Failed to fetch resource.",
    });
  }
});

// CREATE resource
router.post(
  "/",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      ensureResourcesTable();

      const validation = validateResource(req.body);

      if (validation.error) {
        return res.status(400).json({
          message: validation.error,
        });
      }

      const resource = validation.value;
      const db = getDatabase();

      db.run(
        `INSERT INTO resources (
          name,
          type,
          description,
          quantity,
          unit_cost,
          availability_status
        ) VALUES (?, ?, ?, ?, ?, ?)`,
        [
          resource.name,
          resource.type,
          resource.description,
          resource.quantity,
          resource.unit_cost,
          resource.availability_status,
        ]
      );

      const result = db.exec(
        "SELECT last_insert_rowid() AS id"
      );

      const id = result[0].values[0][0];

      saveDatabase();

      res.status(201).json({
        message: "Resource created successfully.",
        id,
        resource: {
          id,
          ...resource,
        },
      });
    } catch (error) {
      console.error("Create resource error:", error);

      res.status(500).json({
        message: "Failed to create resource.",
      });
    }
  }
);

// UPDATE resource
router.put(
  "/:id",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      ensureResourcesTable();

      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          message: "Invalid resource ID.",
        });
      }

      const db = getDatabase();

      const existing = rowsToObjects(
        db.exec(
          "SELECT id FROM resources WHERE id = ?",
          [id]
        )
      );

      if (!existing.length) {
        return res.status(404).json({
          message: "Resource not found.",
        });
      }

      const validation = validateResource(req.body);

      if (validation.error) {
        return res.status(400).json({
          message: validation.error,
        });
      }

      const resource = validation.value;

      db.run(
        `UPDATE resources
         SET name = ?,
             type = ?,
             description = ?,
             quantity = ?,
             unit_cost = ?,
             availability_status = ?
         WHERE id = ?`,
        [
          resource.name,
          resource.type,
          resource.description,
          resource.quantity,
          resource.unit_cost,
          resource.availability_status,
          id,
        ]
      );

      saveDatabase();

      res.json({
        message: "Resource updated successfully.",
        resource: {
          id,
          ...resource,
        },
      });
    } catch (error) {
      console.error("Update resource error:", error);

      res.status(500).json({
        message: "Failed to update resource.",
      });
    }
  }
);

// DELETE resource
router.delete(
  "/:id",
  authenticateToken,
  allowRoles("Admin", "Organizer"),
  (req, res) => {
    try {
      ensureResourcesTable();

      const id = Number(req.params.id);

      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({
          message: "Invalid resource ID.",
        });
      }

      const db = getDatabase();

      const existing = rowsToObjects(
        db.exec(
          "SELECT id FROM resources WHERE id = ?",
          [id]
        )
      );

      if (!existing.length) {
        return res.status(404).json({
          message: "Resource not found.",
        });
      }

      db.run(
        "DELETE FROM resources WHERE id = ?",
        [id]
      );

      saveDatabase();

      res.json({
        message: "Resource deleted successfully.",
      });
    } catch (error) {
      console.error("Delete resource error:", error);

      res.status(500).json({
        message: "Failed to delete resource.",
      });
    }
  }
);

module.exports = router;