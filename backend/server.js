require("dotenv").config();

const express = require("express");
const cors = require("cors");
const morgan = require("morgan");
const path = require("path");
const fs = require("fs");

const predictionsRouter = require("./routes/predictions");
const mlClient = require("./data/mlClient");

const app = express();
const PORT = process.env.PORT || 4000;

const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(cors());
app.use(morgan("dev"));
app.use(express.json());

app.get("/api/health", async (req, res) => {
  let mlService = { status: "unreachable" };
  try {
    mlService = await mlClient.health();
  } catch (err) {
    mlService = { status: "unreachable", detail: err.message };
  }
  res.json({
    status: "ok",
    service: "VarunaDrishti API",
    time: new Date().toISOString(),
    mlService,
  });
});

app.use("/api/predictions", predictionsRouter);

app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: err.message || "Internal server error" });
});

app.listen(PORT, () => {
  console.log(`VarunaDrishti API listening on http://localhost:${PORT}`);
});
