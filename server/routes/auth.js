
const express = require("express");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const {
  getDatabase,
  saveDatabase
} = require("../db");

const router = express.Router();

const JWT_SECRET = process.env.JWT_SECRET;

if (!JWT_SECRET) {
  throw new Error("JWT_SECRET is missing from your .env file");
}

// Register Organizer, Vendor, or Attendee.
// Admin accounts must be created separately.
router.post("/register", async (req, res) => {
  try {
    const { name, email, password, role } = req.body;

    if (!name || !email || !password || !role) {
      return res.status(400).json({
        message: "All fields are required"
      });
    }

    if (password.length < 8) {
      return res.status(400).json({
        message: "Password must be at least 8 characters"
      });
    }

    const allowedRoles = ["Organizer", "Vendor", "Attendee"];

    if (!allowedRoles.includes(role)) {
      return res.status(403).json({
        message: "This role cannot be registered publicly"
      });
    }

    const db = getDatabase();
    const normalizedEmail = email.trim().toLowerCase();

    const existing = db.exec(
      "SELECT id FROM users WHERE email = ?",
      [normalizedEmail]
    );

    if (existing.length) {
      return res.status(409).json({
        message: "Email is already registered"
      });
    }

    const passwordHash = await bcrypt.hash(password, 12);

    db.run(
      `INSERT INTO users (name, email, password_hash, role)
       VALUES (?, ?, ?, ?)`,
      [name.trim(), normalizedEmail, passwordHash, role]
    );

    saveDatabase();

    return res.status(201).json({
      message: "Registration successful. You can now log in."
    });
  } catch (error) {
    console.error("Registration error:", error);
    return res.status(500).json({
      message: "Registration failed"
    });
  }
});

router.post("/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({
        message: "Email and password are required"
      });
    }

    const db = getDatabase();

    const result = db.exec(
      `SELECT id, name, email, password_hash, role
       FROM users WHERE email = ?`,
      [email.trim().toLowerCase()]
    );

    const user = result.length
      ? Object.fromEntries(
          result[0].columns.map((column, i) => [
            column,
            result[0].values[0][i]
          ])
        )
      : null;

    if (
      !user ||
      !(await bcrypt.compare(password, user.password_hash))
    ) {
      return res.status(401).json({
        message: "Invalid email or password"
      });
    }

    const token = jwt.sign(
      { id: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: "2h" }
    );

    return res.json({
      message: "Login successful",
      token,
      user: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role
      }
    });
  } catch (error) {
    console.error("Login error:", error);
    return res.status(500).json({
      message: "Login failed"
    });
  }
});

module.exports = router;
