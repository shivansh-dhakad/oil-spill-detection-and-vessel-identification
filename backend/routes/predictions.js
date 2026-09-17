const fs = require("fs");
const path = require("path");
const express = require("express");
const multer = require("multer");
const {
  listPredictions,
  getPrediction,
  getStats,
  createPredictionFromMlResult,
  getPredictionIdForJob,
  linkJobToPrediction,
  cancelPredictionJob,
  isJobCancelled,
} = require("../data/store");
const mlClient = require("../data/mlClient");

const router = express.Router();

// .SAFE.zip archives are commonly 700MB-1.5GB+. Buffering that entirely in
// process memory (the old `multer.memoryStorage()`) meant Node held the
// whole archive in RAM just to immediately re-stream it to Flask - on
// anything but a beefy box that's what was crashing the request (and
// dragging down the rest of the app) for SAFE uploads specifically, while
// small plain-image uploads sailed through unnoticed. diskStorage writes
// the upload straight to disk as it arrives, and mlClient streams it back
// off disk (see data/mlClient.js), so at no point does the full file sit in
// memory.
const UPLOADS_DIR = path.join(__dirname, "..", "uploads");
if (!fs.existsSync(UPLOADS_DIR)) fs.mkdirSync(UPLOADS_DIR, { recursive: true });

// Keep this at or above ml_service's MAX_UPLOAD_MB (server.py), or large
// files will get rejected here instead of there.
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB || 3072);
const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOADS_DIR),
    filename: (req, file, cb) => {
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
      cb(null, `${unique}_${file.originalname}`);
    },
  }),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 },
});

// .tif/.tiff uploads frequently carry their own embedded georeferencing
// (and sometimes an acquisition timestamp) - the ML service (tif_processor.py)
// reads that straight from the file, so this route shouldn't force the user
// to re-enter coordinates for those uploads the way a plain non-georeferenced
// image (.png/.jpg/.bmp) still needs. If a .tif turns out to have no usable
// embedded geolocation, the ML service itself reports a clear 400 explaining
// that manual coordinates are needed - this route just doesn't block it
// up front on a guess.
const GEO_CAPABLE_IMAGE_EXTENSIONS = new Set([".tif", ".tiff"]);

/** Best-effort cleanup of the temp upload once it's been handed to Flask (or failed to be). */
function cleanupUpload(filePath) {
  if (!filePath) return;
  fs.unlink(filePath, (err) => {
    if (err && err.code !== "ENOENT") {
      console.error(`[cleanupUpload] Failed to remove ${filePath}:`, err.message);
    }
  });
}

// GET /api/predictions?status=detected&minConfidence=90&region=Bengal&search=PRED
router.get("/", (req, res) => {
  const { status, minConfidence, region, search } = req.query;
  res.json({ predictions: listPredictions({ status, minConfidence, region, search }) });
});

// GET /api/predictions/stats/summary
router.get("/stats/summary", (req, res) => {
  res.json(getStats());
});

// GET /api/predictions/:id
router.get("/:id", (req, res) => {
  const prediction = getPrediction(req.params.id);
  if (!prediction) return res.status(404).json({ error: "Prediction not found" });
  res.json(prediction);
});

// ----------------------------------------------------------------------- //
// Real detection pipeline (Flask ML service)
// ----------------------------------------------------------------------- //

// POST /api/predictions  (multipart/form-data)
//   file            (required) - .SAFE.zip / .zip archive, a Sentinel-1
//                                 georeferenced .tif/.tiff, or a plain SAR image
//   sourceType      "safe_zip" | "sar_image"
//   sensor          display label, e.g. "Sentinel-1A IW"
//   latitude, longitude   required for non-georeferenced images (.png/.jpg/.bmp);
//                          optional for .tif/.tiff (auto-extracted server-side
//                          when the file carries embedded georeferencing)
//   timestamp             optional ISO 8601 UTC acquisition time - also
//                          auto-extracted from .tif/.tiff metadata when present
//   lookbackDays          optional, default 20
//   skipAis               optional "true"/"false"
//
// Kicks off the pipeline asynchronously and returns immediately with a
// job_id - the frontend shows the /processing/:jobId page and polls/streams
// GET /api/predictions/jobs/:jobId until it reports status "complete".
router.post("/", (req, res, next) => {
  upload.single("file")(req, res, (err) => {
    if (err) {
      if (err.code === "LIMIT_FILE_SIZE") {
        return res.status(413).json({
          error: `File exceeds the upload limit (${MAX_UPLOAD_MB} MB). Raise MAX_UPLOAD_MB in the backend's ` +
            `environment (and ml_service's matching MAX_UPLOAD_MB) if you need to allow larger files.`,
        });
      }
      return res.status(400).json({ error: err.message });
    }
    next();
  });
}, async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: "No file provided (field name must be 'file')." });
    }
    const { sourceType, sensor, latitude, longitude, timestamp, lookbackDays, forecastHours, skipAis } = req.body;

    const uploadedExt = path.extname(req.file.originalname || "").toLowerCase();
    const isGeoCapableImage = GEO_CAPABLE_IMAGE_EXTENSIONS.has(uploadedExt);

    if (
      sourceType === "sar_image" &&
      !isGeoCapableImage &&
      (latitude === undefined || longitude === undefined || latitude === "" || longitude === "")
    ) {
      return res.status(400).json({
        error:
          "latitude and longitude are required for this image type (SAFE archives and georeferenced " +
          ".tif/.tiff files carry their own geolocation).",
      });
    }

    let mlResponse;
    try {
      mlResponse = await mlClient.submitAnalysis({
        filePath: req.file.path,
        fileName: req.file.originalname,
        fields: {
          latitude,
          longitude,
          timestamp,
          lookback_days: lookbackDays,
          forecast_hours: forecastHours,
          skip_ais: skipAis,
        },
      });
    } finally {
      // The Flask side has its own copy on disk (or the request failed) -
      // either way Node's temp copy is no longer needed.
      cleanupUpload(req.file.path);
    }

    res.status(202).json({
      jobId: mlResponse.job_id,
      statusUrl: `/api/predictions/jobs/${mlResponse.job_id}`,
      streamUrl: `/api/predictions/jobs/${mlResponse.job_id}/stream`,
      meta: { originalName: req.file.originalname, sourceType, sensor },
    });
  } catch (err) {
    if (err.response) {
      // ML service reachable but rejected the request (bad input, model not loaded, etc).
      return res.status(err.response.status).json(err.response.data);
    }
    console.error("[POST /api/predictions] ML service unreachable:", err.message);
    return res.status(502).json({
      error: "Could not reach the ML analysis service. Is ml_service/server.py running?",
      detail: err.message,
    });
  }
});

// GET /api/predictions/jobs/:jobId
// Proxies stage-by-stage job status from the Flask service. Once the ML
// service reports status "complete", the result is converted into a
// Prediction record (once - subsequent polls reuse the same record) and
// `predictionId` is included so the frontend can navigate to /results/:id.
router.get("/jobs/:jobId", async (req, res) => {
  const { jobId } = req.params;
  if (isJobCancelled(jobId)) {
    return res.json({ job_id: jobId, status: "cancelled", result: null, predictionId: null });
  }
  try {
    const job = await mlClient.getJobStatus(jobId);

    let predictionId = getPredictionIdForJob(jobId);
    if (job.status === "complete" && job.result && !predictionId) {
      // Meta (original filename / sourceType / sensor) isn't tracked by the
      // Flask service, so this reads it back from the query string that the
      // frontend echoes on each poll (set from the /processing page).
      const record = createPredictionFromMlResult(job.result, {
        jobId,
        originalName: req.query.originalName,
        sourceType: req.query.sourceType,
        sensor: req.query.sensor,
      });
      linkJobToPrediction(jobId, record.id);
      predictionId = record.id;
    }

    res.json({ ...job, predictionId });
  } catch (err) {
    if (err.response) return res.status(err.response.status).json(err.response.data);
    console.error(`[GET /api/predictions/jobs/${jobId}] ML service unreachable:`, err.message);
    res.status(502).json({ error: "Could not reach the ML analysis service.", detail: err.message });
  }
});

// POST /api/predictions/jobs/:jobId/cancel
router.post("/jobs/:jobId/cancel", async (req, res) => {
  cancelPredictionJob(req.params.jobId);
  try {
    res.json(await mlClient.cancelJob(req.params.jobId));
  } catch (err) {
    // The local cancellation marker already prevents history persistence. A
    // worker that predates the cancel endpoint can finish in the background,
    // but its result will still be discarded by the backend.
    res.json({ job_id: req.params.jobId, status: "cancelled" });
  }
});

// GET /api/predictions/jobs/:jobId/stream
// Proxies the Flask Server-Sent Events stream so the frontend can show live
// stage progress without polling.
router.get("/jobs/:jobId/stream", async (req, res) => {
  try {
    const mlResponse = await mlClient.openJobStream(req.params.jobId);
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    mlResponse.data.pipe(res);
    req.on("close", () => mlResponse.data.destroy());
  } catch (err) {
    const status = err.response?.status || 502;
    res.status(status).json({ error: "Could not open ML service progress stream.", detail: err.message });
  }
});

// GET /api/predictions/files/:jobId/:filename
// Streams a generated output file (mask/overlay PNG, trajectory CSV/PNG)
// back through Node.
router.get("/files/:jobId/:filename", async (req, res) => {
  try {
    const mlResponse = await mlClient.openJobFile(req.params.jobId, req.params.filename);
    if (mlResponse.headers["content-type"]) {
      res.setHeader("Content-Type", mlResponse.headers["content-type"]);
    }
    mlResponse.data.pipe(res);
  } catch (err) {
    res.status(err.response?.status || 404).json({ error: "File not found." });
  }
});

// ----------------------------------------------------------------------- //
// Batch Processing In-Memory State & Endpoints
// ----------------------------------------------------------------------- //
const batches = new Map();

// POST /api/predictions/batch
router.post("/batch", (req, res) => {
  const { total = 0, sourceName = "Batch folder" } = req.body;
  const batchId = `BATCH-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const batchRecord = {
    id: batchId,
    sourceName,
    total: Number(total) || 0,
    processed: 0,
    percentage: 0,
    status: "running",
    logs: [],
    createdAt: new Date().toISOString(),
  };
  batches.set(batchId, batchRecord);
  res.status(201).json(batchRecord);
});

// GET /api/predictions/batch/:batchId
router.get("/batch/:batchId", (req, res) => {
  const batch = batches.get(req.params.batchId);
  if (!batch) {
    return res.status(404).json({ error: "Batch not found" });
  }
  res.json(batch);
});

// POST /api/predictions/batch/:batchId/logs
router.post("/batch/:batchId/logs", (req, res) => {
  const batch = batches.get(req.params.batchId);
  if (!batch) {
    return res.status(404).json({ error: "Batch not found" });
  }
  const entry = { ...req.body, timestamp: new Date().toISOString() };
  
  // Replace or add log entry
  const existingIdx = batch.logs.findIndex((l) => l.fileName === entry.fileName);
  if (existingIdx >= 0) {
    batch.logs[existingIdx] = entry;
  } else {
    batch.logs.unshift(entry);
  }

  const finishedCount = batch.logs.filter((l) => l.status === "completed" || l.status === "skipped").length;
  batch.processed = finishedCount;
  batch.percentage = batch.total > 0 ? Math.min(100, Math.round((finishedCount / batch.total) * 100)) : 100;
  if (batch.processed >= batch.total && batch.total > 0) {
    batch.status = "complete";
  }
  res.json(batch);
});

module.exports = router;