
const express = require("express");
const cors = require("cors");
const {
  initializeDatabase
} = require("./db");

const app = express();
const PORT = 5000;
require("dotenv").config();
const authRoutes = require("./routes/auth");
const eventRoutes = require("./routes/events");

app.use(cors());
app.use(express.json());
app.use("/api/auth", authRoutes);
app.use("/api/events", eventRoutes);

app.get("/", (req, res) => {
  res.send("Welcome to EventSphere API!");
});

app.get("/api/health", (req, res) => {
  res.json({
    success: true,
    message: "EventSphere backend is running!"
  });
});

async function startServer() {
  try {
    await initializeDatabase();

    app.listen(PORT, () => {
      console.log(
        `EventSphere server running on port ${PORT}`
      );
    });
  } catch (error) {
    console.error("Startup failed:", error);
    process.exit(1);
  }
}

startServer();