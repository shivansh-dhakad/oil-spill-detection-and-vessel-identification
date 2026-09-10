import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

const MAX_WORKERS = 2;

function isSafeProduct(file) {
  return /\.safe(?:\.zip)?$/i.test(file.name) || /\.safe\.zip$/i.test(file.webkitRelativePath || "");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export default function BatchProcessing() {
  const [files, setFiles] = useState([]);
  const [folderName, setFolderName] = useState("");
  const [batch, setBatch] = useState(null);
  const [logs, setLogs] = useState([]);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState(null);
  const runRef = useRef(false);

  function scanFolder(fileList) {
    const selected = Array.from(fileList || []);
    const safeFiles = selected.filter(isSafeProduct);
    const firstPath = selected[0]?.webkitRelativePath || "";
    setFolderName(firstPath.split("/")[0] || "Selected folder");
    setFiles(safeFiles);
    setLogs([]);
    setBatch(null);
    setError(
      safeFiles.length
        ? null
        : "No Sentinel-1 .SAFE or .SAFE.zip products were found in the selected folder."
    );
  }

  async function waitForCompletion(jobId, meta, onUpdate) {
    for (;;) {
      const job = await api.getJobStatus(jobId, meta);
      if (onUpdate) onUpdate(job);
      if (job.status === "complete") return job;
      if (job.status === "failed") throw new Error(job.error || "The ML service rejected this SAFE product.");
      await sleep(1200);
    }
  }

  async function processFile(file, batchId) {
    const fileName = file.webkitRelativePath || file.name;
    try {
      setLogs((current) => [{ fileName, status: "processing", message: "Submitting to the ML pipeline" }, ...current]);
      await api.appendBatchLog(batchId, { fileName, status: "processing", message: "Submitting to the ML pipeline" });
      const submitted = await api.createPrediction({
        file,
        sourceType: "safe_zip",
        sensor: "Sentinel-1A IW",
      });
      const result = await waitForCompletion(submitted.jobId, {
        sourceType: "safe_zip",
        sensor: "Sentinel-1A IW",
        originalName: file.name,
      }, (job) => {
        if (job.status === "complete" || job.status === "failed") return;
        const currentStage = (job.stages || []).find((stage) => stage.status === "running");
        const message = currentStage?.message || "Processing SAFE product";
        setLogs((current) => current.map((log) => log.fileName === fileName ? { ...log, message, jobId: submitted.jobId } : log));
        api.appendBatchLog(batchId, { fileName, jobId: submitted.jobId, status: "processing", message }).catch(() => {});
      });
      const mlResult = result.result || {};
      const detection = mlResult.detection || {};
      const entry = {
        fileName,
        status: "completed",
        message: mlResult.classification_status || (detection.is_oil_spill ? "Spill Detected" : "No Spill"),
        jobId: submitted.jobId,
        predictionId: result.predictionId,
        classificationStatus: mlResult.classification_status || (detection.is_oil_spill ? "Spill Detected" : "No Spill"),
        confidence: detection.confidence_percent ?? null,
        processingTimeSeconds: mlResult.processing_time_seconds ?? mlResult.elapsed_seconds ?? null,
        quickLook: mlResult.files?.quick_look || mlResult.files?.overlay_thumbnail || null,
      };
      setLogs((current) => [entry, ...current.filter((log) => log.fileName !== fileName)]);
      await api.appendBatchLog(batchId, entry);
    } catch (e) {
      const entry = { fileName, status: "skipped", message: e.message || "Corrupt or unreadable SAFE product" };
      setLogs((current) => [entry, ...current.filter((log) => log.fileName !== fileName)]);
      await api.appendBatchLog(batchId, entry).catch(() => {});
    }
  }

  async function startBatch() {
    if (!files.length || running) return;
    setRunning(true);
    setError(null);
    runRef.current = true;
    try {
      const created = await api.createBatch({ total: files.length, sourceName: folderName });
      setBatch(created);
      let cursor = 0;
      async function worker() {
        while (runRef.current) {
          const index = cursor++;
          if (index >= files.length) return;
          await processFile(files[index], created.id);
          const latest = await api.getBatch(created.id);
          setBatch(latest);
        }
      }
      await Promise.all(Array.from({ length: Math.min(MAX_WORKERS, files.length) }, worker));
      setBatch(await api.getBatch(created.id));
    } catch (e) {
      setError(e.message);
    } finally {
      runRef.current = false;
      setRunning(false);
    }
  }

  useEffect(() => () => {
    runRef.current = false;
  }, []);

  const processed = batch?.processed || 0;
  const percentage = batch?.percentage || 0;

  return (
    <main className="pt-16 min-h-screen bg-dots-pattern">
      <div className="max-w-[1400px] mx-auto p-5 md:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-primary font-bold">Bulk ingestion</p>
            <h1 className="text-3xl font-bold font-display text-slate-heading tracking-tight">Batch Processing</h1>
            <p className="mt-1 text-sm text-slate-subtle">Scan a Sentinel-1 folder and run every SAFE product through the live detection pipeline.</p>
          </div>
          <Link to="/history" className="text-xs font-mono font-bold text-primary hover:text-primary-hover">VIEW PREDICTION HISTORY</Link>
        </div>

        <section className="bg-card-white rounded-2xl border border-border-soft shadow-sm p-5 md:p-6">
          <div className="flex flex-col lg:flex-row lg:items-center gap-4">
            <label className="flex-1 cursor-pointer rounded-xl border-2 border-dashed border-slate-300 hover:border-primary hover:bg-cyan-50/30 p-5 transition-colors">
              <input type="file" className="hidden" webkitdirectory="true" directory="true" multiple onChange={(e) => scanFolder(e.target.files)} />
              <div className="flex items-center gap-3">
                <span className="material-symbols-outlined text-3xl text-primary">folder_zip</span>
                <div>
                  <div className="text-sm font-bold text-slate-heading">{folderName || "Select a folder to scan"}</div>
                  <div className="text-xs text-slate-subtle">Finds .SAFE and .SAFE.zip Sentinel-1 products recursively</div>
                </div>
              </div>
            </label>
            <button onClick={startBatch} disabled={!files.length || running} className="h-12 px-6 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-white font-mono text-xs font-bold flex items-center justify-center gap-2">
              <span className="material-symbols-outlined">{running ? "progress_activity" : "play_arrow"}</span>
              {running ? "PROCESSING" : "START BATCH"}
            </button>
          </div>
          {error && <div className="mt-4 px-3 py-2 rounded-lg bg-rose-50 border border-rose-200 text-xs font-mono text-rose-700">{error}</div>}
        </section>

        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {[{ label: "SAFE FOUND", value: files.length, icon: "inventory_2" }, { label: "PROCESSED", value: processed, icon: "task_alt" }, { label: "REMAINING", value: Math.max(0, files.length - processed), icon: "hourglass_top" }, { label: "COMPLETED", value: `${percentage}%`, icon: "donut_large" }].map((metric) => (
            <div key={metric.label} className="bg-card-white border border-border-soft rounded-xl p-4 shadow-sm">
              <div className="flex items-center justify-between text-slate-subtle"><span className="text-[10px] font-mono font-bold tracking-wider">{metric.label}</span><span className="material-symbols-outlined text-primary">{metric.icon}</span></div>
              <div className="mt-3 text-2xl font-bold font-display text-slate-heading">{metric.value}</div>
            </div>
          ))}
        </section>

        <section className="bg-card-white border border-border-soft rounded-2xl shadow-sm p-5">
          <div className="flex items-center justify-between gap-3 mb-4"><div><h2 className="text-sm font-bold font-display text-slate-heading">Processing progress</h2><p className="text-xs text-slate-subtle mt-1">Two workers run independently; corrupted products are logged and skipped.</p></div><span className="text-sm font-mono font-bold text-primary">{percentage}%</span></div>
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden"><div className="h-full bg-primary transition-all duration-500" style={{ width: `${percentage}%` }} /></div>
        </section>

        <section className="bg-card-white border border-border-soft rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border-soft flex items-center justify-between"><h2 className="text-sm font-bold font-display text-slate-heading">Processing logs</h2><span className="text-[10px] font-mono text-slate-subtle">{logs.length} EVENTS</span></div>
          <div className="divide-y divide-slate-100 max-h-[420px] overflow-y-auto">
            {!logs.length && <div className="p-8 text-center text-xs font-mono text-slate-400">Select a folder to begin.</div>}
            {logs.map((log, index) => <div key={`${log.fileName}-${index}`} className="px-5 py-3 flex items-center gap-3 text-xs"><span className={`material-symbols-outlined text-base ${log.status === "completed" ? "text-emerald-600" : log.status === "skipped" ? "text-amber-600" : "text-primary animate-spin"}`}>{log.status === "completed" ? "check_circle" : log.status === "skipped" ? "warning" : "progress_activity"}</span><span className="font-mono font-semibold text-slate-heading truncate flex-1" title={log.fileName}>{log.fileName}</span><span className={`font-semibold ${log.classificationStatus === "Spill Detected" ? "text-rose-600" : log.classificationStatus === "No Spill" ? "text-emerald-700" : "text-slate-subtle"}`}>{log.classificationStatus || log.message}</span>{log.confidence != null && <span className="text-slate-subtle">{log.confidence}%</span>}{log.processingTimeSeconds != null && <span className="text-slate-subtle">{log.processingTimeSeconds}s</span>}{log.quickLook && log.jobId && <a className="text-primary font-mono" href={api.fileUrl(log.jobId, log.quickLook)} target="_blank" rel="noreferrer">QUICK LOOK</a>}{log.predictionId && <Link className="text-primary font-mono" to={`/results/${log.predictionId}`}>RESULT</Link>}</div>)}
          </div>
        </section>
      </div>
    </main>
  );
}
