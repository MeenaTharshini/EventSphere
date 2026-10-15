
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { initializeDatabase } = require("./db");

const app = express();
const PORT = process.env.PORT || 5000;

const authRoutes = require("./routes/auth");
const eventRoutes = require("./routes/events");
const venueRoutes = require("./routes/venues");
const resourceRoutes = require("./routes/resources");

// CORS must run before API routes
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

app.use(express.json());

// API routes — register each only once
app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);
app.use("/api/venues", venueRoutes);
app.use("/api/resources", resourceRoutes);

// Root endpoint
app.get("/", (req, res) => {
  res.send("Welcome to EventSphere API!");
});

// Health endpoint
app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "EventSphere backend is running!",
  });
});

// Start server after database initialization
async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(`EventSphere server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Startup failed:", error);
    process.exit(1);
  }
}

startServer();