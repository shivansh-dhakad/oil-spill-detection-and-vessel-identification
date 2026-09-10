const API_HOST = import.meta.env.VITE_API_BASE_URL ? import.meta.env.VITE_API_BASE_URL.replace(/\/$/, "") : "";
const BASE = `${API_HOST}/api`;

async function handle(res) {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed (${res.status})`);
  }
  return res.json();
}

export const api = {
  health: () => fetch(`${BASE}/health`).then(handle),

  listPredictions: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== "all"))
    ).toString();
    return fetch(`${BASE}/predictions${qs ? `?${qs}` : ""}`).then(handle);
  },

  getPrediction: (id) => fetch(`${BASE}/predictions/${id}`).then(handle),

  getStats: () => fetch(`${BASE}/predictions/stats/summary`).then(handle),

  listIncidents: (params = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v !== undefined && v !== "" && v !== "all"))
    ).toString();
    return fetch(`${BASE}/incidents${qs ? `?${qs}` : ""}`).then(handle);
  },

  updateIncidentStatus: (incidentId, status) =>
    fetch(`${BASE}/incidents/${encodeURIComponent(incidentId)}/status`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    }).then(handle),

  listAlerts: (params = {}) => {
    const qs = new URLSearchParams(params).toString();
    return fetch(`${BASE}/alerts${qs ? `?${qs}` : ""}`).then(handle);
  },

  markAlertRead: (alertId) =>
    fetch(`${BASE}/alerts/${encodeURIComponent(alertId)}/read`, { method: "PATCH" }).then(handle),

  createBatch: ({ total, sourceName }) =>
    fetch(`${BASE}/predictions/batch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ total, sourceName }),
    }).then(handle),

  getBatch: (batchId) => fetch(`${BASE}/predictions/batch/${batchId}`).then(handle),

  appendBatchLog: (batchId, entry) =>
    fetch(`${BASE}/predictions/batch/${batchId}/logs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(entry),
    }).then(handle),

  /**
   * Kicks off a real detection run. Returns { jobId, statusUrl, streamUrl, meta }
   * immediately - the pipeline itself runs asynchronously. Navigate to
   * /processing/:jobId (passing `meta` along) to show live progress.
   */
  createPrediction: ({ file, sourceType, sensor, latitude, longitude, timestamp, lookbackDays, skipAis }) => {
    const form = new FormData();
    if (file) form.append("file", file);
    form.append("sourceType", sourceType || "sar_image");
    form.append("sensor", sensor || "Sentinel-1A IW");
    if (latitude !== undefined && latitude !== "") form.append("latitude", latitude);
    if (longitude !== undefined && longitude !== "") form.append("longitude", longitude);
    if (timestamp) form.append("timestamp", timestamp);
    if (lookbackDays) form.append("lookbackDays", lookbackDays);
    if (skipAis) form.append("skipAis", "true");
    return fetch(`${BASE}/predictions`, { method: "POST", body: form }).then(handle);
  },

  /** One-shot poll of job status (stage progress + result once complete). */
  getJobStatus: (jobId, meta = {}) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null && v !== ""))
    ).toString();
    return fetch(`${BASE}/predictions/jobs/${jobId}${qs ? `?${qs}` : ""}`).then(handle);
  },

  cancelJob: (jobId) =>
    fetch(`${BASE}/predictions/jobs/${jobId}/cancel`, { method: "POST" }).then(handle),

  /**
   * Opens a live Server-Sent Events connection for job progress.
   * `onUpdate(jobStatusJson)` fires on every stage change; the connection
   * closes itself once the ML service reports a terminal status. Returns a
   * cleanup function to close the connection early (e.g. on unmount).
   */
  streamJob: (jobId, meta = {}, onUpdate, onError) => {
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(meta).filter(([, v]) => v !== undefined && v !== null && v !== ""))
    ).toString();
    // The Node proxy only forwards the raw Flask stream, so `meta` (needed to
    // label the finalized prediction) is applied via a follow-up status poll
    // once the stream reports completion, not on the stream URL itself.
    const source = new EventSource(`${BASE}/predictions/jobs/${jobId}/stream`);
    source.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.status === "complete") {
          // Fetch once more through the metadata-aware endpoint so the
          // backend finalizes the prediction record with the right name/sensor.
          api
            .getJobStatus(jobId, meta)
            .then(onUpdate)
            .catch(() => onUpdate(data));
          source.close();
        } else {
          onUpdate(data);
          if (data.status === "failed") source.close();
        }
      } catch (e) {
        // ignore malformed frames
      }
    };
    source.onerror = () => {
      if (onError) onError();
    };
    return () => source.close();
  },

  fileUrl: (jobId, filename) => `${BASE}/predictions/files/${jobId}/${encodeURIComponent(filename)}`,
};
