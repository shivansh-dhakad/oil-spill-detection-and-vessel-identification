import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../api.js";
import "../dashboard.css";
import "../history.css";
import "../batch.css";

function isSafeProduct(file) {
  return (
    /\.safe(?:\.zip)?$/i.test(file.name) ||
    /\.safe\.zip$/i.test(file.webkitRelativePath || "") ||
    /\.zip$/i.test(file.name)
  );
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const rise = {
  hidden: { opacity: 0, y: 22 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.7, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] } }),
};

function Metric({ icon, label, value, tone = "", i = 0 }) {
  return (
    <motion.div className={`lt-bm ${tone}`} variants={rise} custom={i} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
      <div className="lt-bm-label">
        <span>{label}</span>
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className="lt-bm-num">{value}</div>
    </motion.div>
  );
}

export default function BatchProcessing() {
  const [files, setFiles] = useState([]);
  const [folderName, setFolderName] = useState("");
  const [batch, setBatch] = useState(null);
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(null);
  const [logFilter, setLogFilter] = useState("all");

  // Execution mode & concurrency
  const [executionMode, setExecutionMode] = useState("one_by_one"); // "one_by_one" | "batch"
  const [batchSize, setBatchSize] = useState(2);

  const runRef = useRef(false);

  function scanFolder(fileList) {
    const selected = Array.from(fileList || []);
    const validFiles = selected.filter(isSafeProduct);
    const firstPath = selected[0]?.webkitRelativePath || "";
    setFolderName(firstPath.split("/")[0] || "Selected folder");
    setFiles(validFiles);
    setLogs([]);
    setBatch(null);
    setError(
      validFiles.length
        ? null
        : "No Sentinel-1 .SAFE or .SAFE.zip products were found in the selected folder."
    );
  }

  async function waitForCompletion(jobId, meta, onUpdate) {
    for (;;) {
      if (!runRef.current) {
        throw new Error("Batch processing paused by user.");
      }
      const job = await api.getJobStatus(jobId, meta);
      if (onUpdate) onUpdate(job);
      if (job.status === "complete") return job;
      if (job.status === "failed") throw new Error(job.error || "The ML service rejected this file.");
      if (job.status === "cancelled") throw new Error("Job was cancelled.");
      await sleep(1200);
    }
  }

  async function processFile(file, batchId) {
    const fileName = file.webkitRelativePath || file.name;
    const sourceType = "safe_zip";

    try {
      setLogs((current) => [
        { fileName, status: "processing", message: "Uploading & initializing pipeline...", timestamp: new Date() },
        ...current.filter((l) => l.fileName !== fileName),
      ]);
      await api.appendBatchLog(batchId, { fileName, status: "processing", message: "Submitting to pipeline" }).catch(() => {});

      const submitted = await api.createPrediction({ file, sourceType, sensor: "Sentinel-1A IW" });

      const result = await waitForCompletion(
        submitted.jobId,
        { sourceType, sensor: "Sentinel-1A IW", originalName: file.name },
        (job) => {
          if (job.status === "complete" || job.status === "failed") return;
          const currentStage = (job.stages || []).find((stage) => stage.status === "running");
          const message = currentStage?.message || "Analyzing SAR data...";
          setLogs((current) => current.map((log) => (log.fileName === fileName ? { ...log, message, jobId: submitted.jobId } : log)));
          api.appendBatchLog(batchId, { fileName, jobId: submitted.jobId, status: "processing", message }).catch(() => {});
        }
      );

      const mlResult = result.result || {};
      const detection = mlResult.detection || {};
      const isSpill = Boolean(detection.is_oil_spill || (mlResult.classification_status || "").toLowerCase().includes("spill"));

      const entry = {
        fileName,
        status: "completed",
        message: mlResult.classification_status || (isSpill ? "Spill Detected" : "No Spill"),
        jobId: submitted.jobId,
        predictionId: result.predictionId,
        classificationStatus: isSpill ? "Spill Detected" : "Clean Waters",
        isSpill,
        confidence: detection.confidence_percent ?? null,
        processingTimeSeconds: mlResult.processing_time_seconds ?? mlResult.elapsed_seconds ?? null,
        quickLook: mlResult.files?.quick_look || mlResult.files?.overlay_thumbnail || null,
        timestamp: new Date(),
      };

      setLogs((current) => [entry, ...current.filter((log) => log.fileName !== fileName)]);
      await api.appendBatchLog(batchId, entry);
    } catch (e) {
      const entry = {
        fileName,
        status: "skipped",
        message: e.message || "File error or pipeline failure",
        isSpill: false,
        timestamp: new Date(),
      };
      setLogs((current) => [entry, ...current.filter((log) => log.fileName !== fileName)]);
      await api.appendBatchLog(batchId, entry).catch(() => {});
    }
  }

  async function startBatch() {
    if (!files.length || running) return;
    setRunning(true);
    setStopping(false);
    setError(null);
    runRef.current = true;

    const activeConcurrency = executionMode === "one_by_one" ? 1 : Math.max(1, Math.min(10, Number(batchSize) || 1));

    try {
      const created = await api.createBatch({ total: files.length, sourceName: folderName });
      setBatch(created);

      let cursor = 0;
      async function worker() {
        while (runRef.current) {
          const index = cursor++;
          if (index >= files.length) return;
          await processFile(files[index], created.id);
          try {
            setBatch(await api.getBatch(created.id));
          } catch {
            // best effort state update
          }
        }
      }

      await Promise.all(Array.from({ length: Math.min(activeConcurrency, files.length) }, () => worker()));

      try {
        setBatch(await api.getBatch(created.id));
      } catch {
        // best effort final fetch
      }
    } catch (e) {
      setError(e.message);
    } finally {
      runRef.current = false;
      setRunning(false);
      setStopping(false);
    }
  }

  function stopBatch() {
    setStopping(true);
    runRef.current = false;
  }

  useEffect(() => () => {
    runRef.current = false;
  }, []);

  const processedCount = logs.filter((l) => l.status === "completed" || l.status === "skipped").length;
  const spillCount = logs.filter((l) => l.isSpill || l.classificationStatus === "Spill Detected").length;
  const activeCount = logs.filter((l) => l.status === "processing").length;
  const percentage = files.length > 0 ? Math.min(100, Math.round((processedCount / files.length) * 100)) : 0;

  // Files with no log yet are shown as "queued" so the whole batch is visible up front.
  const rows = useMemo(() => {
    const seen = new Set(logs.map((l) => l.fileName));
    const queued = files
      .map((f) => f.webkitRelativePath || f.name)
      .filter((name) => !seen.has(name))
      .map((fileName) => ({ fileName, status: "queued", message: "Waiting in queue" }));
    return [...logs, ...queued];
  }, [logs, files]);
  const queuedCount = rows.filter((r) => r.status === "queued").length;

  const filteredRows = rows.filter((log) => {
    if (logFilter === "completed") return log.status === "completed";
    if (logFilter === "spills") return log.isSpill || log.classificationStatus === "Spill Detected";
    if (logFilter === "processing") return log.status === "processing";
    if (logFilter === "queued") return log.status === "queued";
    if (logFilter === "skipped") return log.status === "skipped";
    return true;
  });

  const FILTERS = [
    { id: "all", label: "All" },
    { id: "processing", label: `Active ${activeCount}` },
    { id: "queued", label: `Queued ${queuedCount}` },
    { id: "spills", label: `Spills ${spillCount}` },
    { id: "completed", label: "Done" },
    { id: "skipped", label: "Skipped" },
  ];

  const modeLabel = executionMode === "one_by_one" ? "one file at a time" : `${batchSize} files in parallel`;

  return (
    <main className="lt-page lt-history">
      {/* ============================ HEAD ============================ */}
      <header className="lt-hist-head">
        <div className="lt-hist-copy">
          <motion.span className="lt-eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
            Batch · Multi-scene ingestion
          </motion.span>
          <h1 className="lt-hist-title lt-display">
            Many scenes,
            <br />
            <em>one sitting.</em>
          </h1>
          <motion.p className="lt-hist-sub" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
            Point at a folder of Sentinel-1 SAFE archives. Every product is found automatically and run through the full pipeline, one after another or in parallel.
          </motion.p>
        </div>

        {/* ---------- configuration card ---------- */}
        <motion.div className="lt-upload lt-cfg" variants={rise} initial="hidden" animate="show" custom={2}>
          <label className={`lt-folder ${running ? "is-disabled" : ""}`}>
            <input
              type="file"
              className="hidden"
              webkitdirectory="true"
              directory="true"
              multiple
              disabled={running}
              onChange={(e) => scanFolder(e.target.files)}
            />
            <span className="lt-folder-ico">
              <span className="material-symbols-outlined">folder_zip</span>
            </span>
            <span className="lt-folder-text">
              <b>{folderName || "Choose a folder"}</b>
              <small>Scans .SAFE and .SAFE.zip files, including subfolders</small>
            </span>
            {files.length > 0 && <span className="lt-chip">{files.length} found</span>}
          </label>

          <div className="lt-cfg-row">
            <span className="lt-cfg-label">Run mode</span>
            <div className="lt-seg" role="group" aria-label="Execution mode">
              <button type="button" disabled={running} className={executionMode === "one_by_one" ? "is-on" : ""} aria-pressed={executionMode === "one_by_one"} onClick={() => setExecutionMode("one_by_one")}>
                One by one
              </button>
              <button type="button" disabled={running} className={executionMode === "batch" ? "is-on" : ""} aria-pressed={executionMode === "batch"} onClick={() => setExecutionMode("batch")}>
                In parallel
              </button>
            </div>
          </div>

          <div className={`lt-cfg-row ${executionMode === "one_by_one" ? "is-off" : ""}`}>
            <span className="lt-cfg-label">Parallel files</span>
            <div className="lt-stepper">
              <button type="button" aria-label="Fewer" disabled={running || executionMode === "one_by_one" || batchSize <= 2} onClick={() => setBatchSize((n) => Math.max(2, n - 1))}>
                <span className="material-symbols-outlined">remove</span>
              </button>
              <b>{executionMode === "one_by_one" ? 1 : batchSize}</b>
              <button type="button" aria-label="More" disabled={running || executionMode === "one_by_one" || batchSize >= 10} onClick={() => setBatchSize((n) => Math.min(10, n + 1))}>
                <span className="material-symbols-outlined">add</span>
              </button>
            </div>
          </div>

          {error && <div className="lt-error">{error}</div>}

          <div className="lt-cfg-actions">
            <button type="button" className="lt-btn lt-btn-ink lt-run" onClick={startBatch} disabled={!files.length || running}>
              <span className={`material-symbols-outlined ${running ? "lt-spin" : ""}`}>{running ? "progress_activity" : "play_arrow"}</span>
              {running ? "PROCESSING…" : "START BATCH"}
            </button>
            {running && (
              <button type="button" className="lt-btn lt-btn-ghost" onClick={stopBatch} disabled={stopping}>
                <span className="material-symbols-outlined">stop_circle</span>
                {stopping ? "Stopping…" : "Stop"}
              </button>
            )}
          </div>
          <p className="lt-cfg-note">
            {files.length === 0 ? "No folder selected yet." : `${files.length} product${files.length === 1 ? "" : "s"} ready, ${modeLabel}.`}
          </p>
        </motion.div>
      </header>

      <div className="lt-hist-wrap">
        {/* ============================ METRICS ============================ */}
        <section className="lt-bmetrics" aria-label="Batch metrics">
          <Metric i={0} icon="inventory_2" label="Scenes found" value={files.length} />
          <Metric i={1} icon="task_alt" label="Processed" value={processedCount} />
          <Metric i={2} icon="sync" label="Active" value={activeCount} />
          <Metric i={3} tone="is-ink" icon="warning" label="Spills detected" value={spillCount} />
          <Metric i={4} tone="is-sea" icon="donut_large" label="Progress" value={`${percentage}%`} />
        </section>

        {/* ============================ PROGRESS ============================ */}
        <section className="lt-prog" aria-label="Batch progress">
          <div className="lt-prog-top">
            <span>
              {processedCount} of {files.length} scenes finished
              {batch?.id && <em> · {batch.id}</em>}
            </span>
            <b>{percentage}%</b>
          </div>
          <div className="lt-prog-track">
            <motion.div className="lt-prog-fill" initial={{ width: 0 }} animate={{ width: `${percentage}%` }} transition={{ duration: 0.4, ease: "easeOut" }} />
          </div>
        </section>

        {/* ============================ STREAM ============================ */}
        <section className="lt-ledger">
          <div className="lt-ledger-head">
            <h2 className="lt-display">Batch execution stream</h2>
            <div className="lt-seg" role="group" aria-label="Filter records">
              {FILTERS.map((f) => (
                <button key={f.id} type="button" className={logFilter === f.id ? "is-on" : ""} aria-pressed={logFilter === f.id} onClick={() => setLogFilter(f.id)}>
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="lt-log-scroll">
            {filteredRows.length === 0 ? (
              <div className="lt-state">
                <h3 className="lt-display">{files.length === 0 ? "No folder yet" : "Nothing here"}</h3>
                <p>{files.length === 0 ? "Choose a folder above, then start the batch. Each scene shows up here as it moves through the pipeline." : "No scenes match this filter."}</p>
              </div>
            ) : (
              filteredRows.map((log) => {
                const isSpill = log.isSpill || log.classificationStatus === "Spill Detected";
                const state = log.status === "completed" ? (isSpill ? "hot" : "clean") : log.status === "skipped" ? "warn" : log.status === "processing" ? "live" : "wait";
                const icon = { hot: "warning", clean: "check_circle", warn: "error_outline", live: "progress_activity", wait: "schedule" }[state];
                return (
                  <div key={log.fileName} className={`lt-log is-${state}`}>
                    <span className={`material-symbols-outlined lt-log-ico ${state === "live" ? "lt-spin" : ""}`}>{icon}</span>

                    <div className="lt-log-main">
                      <div className="lt-log-name" title={log.fileName}>{log.fileName}</div>
                      <div className="lt-log-msg">
                        {log.status === "completed" ? "Analysis complete" : log.message}
                        {log.processingTimeSeconds != null && ` · ${log.processingTimeSeconds}s`}
                      </div>
                    </div>

                    <div className="lt-log-tag">
                      {log.status === "completed" && <span className={`lt-result ${isSpill ? "is-hot" : "is-clean"}`}><i />{log.classificationStatus || "Processed"}</span>}
                      {log.status === "skipped" && <span className="lt-result is-warn"><i />Skipped</span>}
                      {log.status === "processing" && <span className="lt-result is-live"><i />Running</span>}
                      {log.status === "queued" && <span className="lt-result is-wait"><i />Queued</span>}
                    </div>

                    <div className="lt-log-conf">{log.confidence != null ? `${log.confidence}%` : ""}</div>

                    <div className="lt-log-actions">
                      {log.quickLook && log.jobId && (
                        <a className="lt-btn lt-btn-ghost lt-btn-sm" href={api.fileUrl(log.jobId, log.quickLook)} target="_blank" rel="noreferrer">
                          Quick look
                        </a>
                      )}
                      {log.predictionId && (
                        <Link className="lt-btn lt-btn-ink lt-btn-sm" to={`/results/${log.predictionId}`}>
                          View result
                        </Link>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}
