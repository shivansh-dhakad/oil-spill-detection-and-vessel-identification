/**
 * mlClient.js - thin wrapper around the Flask ML service (ml_service/server.py).
 *
 * Keeps all axios/form-data plumbing for talking to the ML pipeline in one
 * place so routes/predictions.js stays focused on HTTP concerns.
 */

const fs = require("fs");
const axios = require("axios");
const FormData = require("form-data");

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:5001";

/**
 * Kicks off analysis for an uploaded file. `filePath`/`fileName` point at the
 * multer-diskStorage temp file (see routes/predictions.js) - we stream it
 * straight from disk into the multipart request instead of ever holding the
 * whole archive (up to a few GB for .SAFE.zip) in a single in-memory Buffer.
 * Returns { job_id, status_url, stream_url }.
 */
async function submitAnalysis({ filePath, fileName, fields }) {
  const form = new FormData();
  form.append("file", fs.createReadStream(filePath), { filename: fileName });

  const passthroughFields = [
    "latitude",
    "longitude",
    "timestamp",
    "lookback_days",
    "release_hours_ago",
    "skip_ais",
  ];
  for (const key of passthroughFields) {
    if (fields[key] !== undefined && fields[key] !== null && fields[key] !== "") {
      form.append(key, String(fields[key]));
    }
  }

  const response = await axios.post(`${ML_SERVICE_URL}/api/spill/analyze`, form, {
    headers: form.getHeaders(),
    maxBodyLength: Infinity,
    maxContentLength: Infinity,
    timeout: 10 * 60 * 1000, // large SAFE archives can take a while to stream through
  });
  return response.data;
}

async function getJobStatus(jobId) {
  const response = await axios.get(`${ML_SERVICE_URL}/api/spill/jobs/${jobId}`);
  return response.data;
}

async function cancelJob(jobId) {
  const response = await axios.post(`${ML_SERVICE_URL}/api/spill/jobs/${jobId}/cancel`);
  return response.data;
}

/** Returns an axios stream response for SSE proxying. */
function openJobStream(jobId) {
  return axios.get(`${ML_SERVICE_URL}/api/spill/jobs/${jobId}/stream`, {
    responseType: "stream",
    timeout: 0,
  });
}

/** Returns an axios stream response for a generated output file. */
function openJobFile(jobId, filename) {
  return axios.get(`${ML_SERVICE_URL}/api/spill/files/${jobId}/${encodeURIComponent(filename)}`, {
    responseType: "stream",
  });
}

async function health() {
  const response = await axios.get(`${ML_SERVICE_URL}/api/health`, { timeout: 5000 });
  return response.data;
}

module.exports = { ML_SERVICE_URL, submitAnalysis, getJobStatus, cancelJob, openJobStream, openJobFile, health };