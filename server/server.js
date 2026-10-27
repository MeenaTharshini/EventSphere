
const express = require("express");
const cors = require("cors");
require("dotenv").config();

const { initializeDatabase } = require("./db");
const { connectMongoDB } = require("./mongo");

const app = express();
const PORT = process.env.PORT || 5000;

// Route imports
const authRoutes = require("./routes/auth");
const eventRoutes = require("./routes/events");
const venueRoutes = require("./routes/venues");
const resourceRoutes = require("./routes/resources");

// CORS configuration
app.use(
  cors({
    origin: "http://localhost:5173",
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// Middleware
app.use(express.json());

// Existing API routes
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

// Start server after both database initializations
async function startServer() {
  try {
    // Keep the existing SQLite database available
    await initializeDatabase();

    // Connect to MongoDB Atlas
    await connectMongoDB();

    app.listen(PORT, () => {
      console.log(`EventSphere server running on port ${PORT}`);
    });
  } catch (error) {
    console.error("Startup failed:", error.message);
    process.exit(1);
  }
}

startServer();
