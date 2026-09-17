import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../api.js";

function isSafeProduct(file) {
  return (
    /\.safe(?:\.zip)?$/i.test(file.name) ||
    /\.safe\.zip$/i.test(file.webkitRelativePath || "") ||
    /\.tif(?:f)?$/i.test(file.name) ||
    /\.zip$/i.test(file.name)
  );
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
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState(null);
  const [logFilter, setLogFilter] = useState("all");

  // Execution Mode & Batch Size configuration
  const [executionMode, setExecutionMode] = useState("one_by_one"); // "one_by_one" | "batch"
  const [batchSize, setBatchSize] = useState(2); // Concurrent workers when in batch mode

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
        : "No Sentinel-1 .SAFE, .SAFE.zip, or GeoTIFF products were found in the selected folder."
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
    const sourceType = file.name.toLowerCase().endsWith(".tif") || file.name.toLowerCase().endsWith(".tiff")
      ? "sar_image"
      : "safe_zip";

    try {
      setLogs((current) => [
        { fileName, status: "processing", message: "Uploading & initializing pipeline...", timestamp: new Date() },
        ...current.filter((l) => l.fileName !== fileName),
      ]);
      await api.appendBatchLog(batchId, { fileName, status: "processing", message: "Submitting to pipeline" }).catch(() => {});

      const submitted = await api.createPrediction({
        file,
        sourceType,
        sensor: "Sentinel-1A IW",
      });

      const result = await waitForCompletion(
        submitted.jobId,
        {
          sourceType,
          sensor: "Sentinel-1A IW",
          originalName: file.name,
        },
        (job) => {
          if (job.status === "complete" || job.status === "failed") return;
          const currentStage = (job.stages || []).find((stage) => stage.status === "running");
          const message = currentStage?.message || "Analyzing SAR data...";
          setLogs((current) =>
            current.map((log) => (log.fileName === fileName ? { ...log, message, jobId: submitted.jobId } : log))
          );
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

    // Determine actual concurrency based on user selection
    const activeConcurrency = executionMode === "one_by_one"
      ? 1
      : Math.max(1, Math.min(10, Number(batchSize) || 1));

    try {
      const created = await api.createBatch({ total: files.length, sourceName: folderName });
      setBatch(created);

      let cursor = 0;
      async function worker(workerId) {
        while (runRef.current) {
          const index = cursor++;
          if (index >= files.length) return;
          await processFile(files[index], created.id);
          try {
            const latest = await api.getBatch(created.id);
            setBatch(latest);
          } catch {
            // best effort state update
          }
        }
      }

      const workers = Array.from({ length: Math.min(activeConcurrency, files.length) }, (_, i) => worker(i + 1));
      await Promise.all(workers);

      try {
        const finalBatch = await api.getBatch(created.id);
        setBatch(finalBatch);
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

  const filteredLogs = logs.filter((log) => {
    if (logFilter === "completed") return log.status === "completed";
    if (logFilter === "spills") return log.isSpill || log.classificationStatus === "Spill Detected";
    if (logFilter === "processing") return log.status === "processing";
    if (logFilter === "skipped") return log.status === "skipped";
    return true;
  });

  return (
    <main className="pt-16 min-h-screen bg-dots-pattern pb-12">
      <div className="max-w-[1400px] mx-auto p-5 md:p-8 space-y-6">
        {/* Header Title Section */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 text-primary font-mono text-xs uppercase tracking-[0.18em] font-bold">
              <span className="w-2 h-2 rounded-full bg-primary shadow-glow animate-pulse" />
              Automated Pipeline Ingestion
            </div>
            <h1 className="text-3xl font-bold font-display text-slate-heading tracking-tight mt-1">
              Batch &amp; Multi-Scene Processing
            </h1>
            <p className="mt-1 text-sm text-slate-subtle">
              Process Sentinel-1 SAFE archives and GeoTIFFs sequentially (one by one) or in parallel batches.
            </p>
          </div>
          <div className="flex items-center gap-2.5 flex-wrap">
            <div className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-cyan-500/10 border border-cyan-400/25 text-primary text-xs font-mono font-semibold">
              <span className="material-symbols-outlined text-sm">folder_open</span>
              <span>Recursive Directory Scanning</span>
            </div>
            <Link
              to="/"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-abyss-950 text-xs font-bold font-mono transition-all shadow-glow hover:shadow-glow-lg"
            >
              <span className="material-symbols-outlined text-base">add_circle</span>
              <span>Single Scene</span>
            </Link>
          </div>
        </div>

        {/* TOP CONFIGURATION CARD */}
        <section className="bg-card-white rounded-2xl border border-border-soft shadow-sm p-5 md:p-6 space-y-5">
          {/* File Picker & Mode Selection */}
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* Folder Select Dropzone */}
            <label className="lg:col-span-6 cursor-pointer rounded-xl border-2 border-dashed border-slate-300 hover:border-primary hover:bg-cyan-50/20 p-5 transition-all block group">
              <input
                type="file"
                className="hidden"
                webkitdirectory="true"
                directory="true"
                multiple
                disabled={running}
                onChange={(e) => scanFolder(e.target.files)}
              />
              <div className="flex items-center gap-4">
                <div className="w-12 h-12 rounded-xl bg-sky-50 text-primary group-hover:scale-105 transition-transform flex items-center justify-center shrink-0 border border-sky-100 shadow-sm">
                  <span className="material-symbols-outlined text-2xl">folder_zip</span>
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-slate-heading truncate">
                    {folderName || "Click to browse & select folder"}
                  </div>
                  <div className="text-xs text-slate-subtle mt-0.5">
                    Scans .SAFE, .SAFE.zip, and .tif files recursively
                  </div>
                </div>
                {files.length > 0 && (
                  <span className="px-2.5 py-1 rounded-full bg-emerald-50 text-emerald-700 font-mono text-xs font-bold border border-emerald-200">
                    {files.length} Found
                  </span>
                )}
              </div>
            </label>

            {/* Execution Controls: One by One vs Batch */}
            <div className="lg:col-span-6 flex flex-col justify-between h-full space-y-3 p-4 rounded-xl bg-slate-50/70 border border-slate-200">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-slate-700 flex items-center gap-1.5 uppercase tracking-wide font-mono">
                  <span className="material-symbols-outlined text-primary text-sm">tune</span>
                  Execution Mode
                </span>
                <span className="text-[11px] font-mono text-slate-500">
                  {executionMode === "one_by_one" ? "Sequential (1 File at a time)" : `${batchSize} Parallel Workers`}
                </span>
              </div>

              {/* Mode Toggle Buttons */}
              <div className="grid grid-cols-2 gap-2">
                <button
                  type="button"
                  disabled={running}
                  onClick={() => setExecutionMode("one_by_one")}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                    executionMode === "one_by_one"
                      ? "bg-primary text-abyss-950 font-bold border-primary shadow-sm"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <span className="material-symbols-outlined text-base">format_list_numbered</span>
                  One by One (Sequential)
                </button>

                <button
                  type="button"
                  disabled={running}
                  onClick={() => setExecutionMode("batch")}
                  className={`p-2.5 rounded-lg border text-xs font-semibold flex items-center justify-center gap-2 transition-all ${
                    executionMode === "batch"
                      ? "bg-primary text-abyss-950 font-bold border-primary shadow-sm"
                      : "bg-white text-slate-600 border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  <span className="material-symbols-outlined text-base">dataset</span>
                  Concurrent Batch
                </button>
              </div>

              {/* Batch Size Selection (Enabled when in batch mode) */}
              <div className="pt-2 border-t border-slate-200/80 flex items-center justify-between gap-3 flex-wrap">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-slate-600 font-medium">Batch Concurrency:</span>
                  <div className="flex items-center gap-1">
                    {[2, 3, 4, 5].map((num) => (
                      <button
                        key={num}
                        type="button"
                        disabled={running || executionMode === "one_by_one"}
                        onClick={() => {
                          setExecutionMode("batch");
                          setBatchSize(num);
                        }}
                        className={`w-7 h-7 rounded-md text-xs font-mono font-bold transition-all ${
                          executionMode === "batch" && batchSize === num
                            ? "bg-slate-900 text-white shadow-xs"
                            : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100 disabled:opacity-40"
                        }`}
                      >
                        {num}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-[11px] text-slate-500 font-mono">Custom:</span>
                  <input
                    type="number"
                    min="1"
                    max="10"
                    disabled={running || executionMode === "one_by_one"}
                    value={executionMode === "one_by_one" ? 1 : batchSize}
                    onChange={(e) => {
                      const val = Math.max(1, Math.min(10, parseInt(e.target.value) || 1));
                      setBatchSize(val);
                      if (val > 1) setExecutionMode("batch");
                    }}
                    className="w-16 h-8 text-center text-xs font-mono font-bold rounded-lg border border-slate-300 bg-white focus:outline-hidden focus:border-primary disabled:opacity-40"
                  />
                  <span className="text-[11px] text-slate-400">files</span>
                </div>
              </div>
            </div>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between gap-4 pt-3 border-t border-slate-100 flex-wrap">
            <div className="text-xs text-slate-500 font-mono">
              {files.length === 0
                ? "No folder selected."
                : `Ready to analyze ${files.length} file(s) in ${
                    executionMode === "one_by_one" ? "Sequential (1 by 1) mode" : `Concurrent batches of ${batchSize}`
                  }.`}
            </div>

            <div className="flex items-center gap-3">
              {running && (
                <button
                  type="button"
                  onClick={stopBatch}
                  disabled={stopping}
                  className="h-11 px-5 rounded-xl bg-rose-50 text-rose-700 hover:bg-rose-100 border border-rose-200 font-mono text-xs font-bold flex items-center gap-2 transition-colors"
                >
                  <span className="material-symbols-outlined text-base">stop_circle</span>
                  {stopping ? "Stopping..." : "Stop Batch"}
                </button>
              )}

              <button
                type="button"
                onClick={startBatch}
                disabled={!files.length || running}
                className="h-11 px-7 rounded-xl bg-primary hover:bg-primary-hover disabled:opacity-50 disabled:cursor-not-allowed text-abyss-950 font-mono text-xs font-bold flex items-center justify-center gap-2 shadow-glow transition-all"
              >
                <span className={`material-symbols-outlined ${running ? "animate-spin" : ""}`}>
                  {running ? "progress_activity" : "play_arrow"}
                </span>
                {running ? "PROCESSING BATCH..." : "START BATCH ANALYSIS"}
              </button>
            </div>
          </div>

          {error && (
            <div className="px-4 py-3 rounded-xl bg-rose-50 border border-rose-200 text-xs font-mono text-rose-700 flex items-center gap-2">
              <span className="material-symbols-outlined text-base">error</span>
              <span>{error}</span>
            </div>
          )}
        </section>

        {/* METRICS HUD CARDS */}
        <section className="grid grid-cols-2 lg:grid-cols-5 gap-3.5">
          <div className="bg-card-white border border-border-soft rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-subtle">
              <span className="text-[10px] font-mono font-bold tracking-wider uppercase">Scenes Found</span>
              <span className="material-symbols-outlined text-primary text-lg">inventory_2</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-display text-slate-heading">{files.length}</div>
          </div>

          <div className="bg-card-white border border-border-soft rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-subtle">
              <span className="text-[10px] font-mono font-bold tracking-wider uppercase">Processed</span>
              <span className="material-symbols-outlined text-emerald-600 text-lg">task_alt</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-display text-emerald-700">{processedCount}</div>
          </div>

          <div className="bg-card-white border border-border-soft rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-subtle">
              <span className="text-[10px] font-mono font-bold tracking-wider uppercase">Active In Pipeline</span>
              <span className="material-symbols-outlined text-cyan-600 text-lg">sync</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-display text-cyan-700">{activeCount}</div>
          </div>

          <div className="bg-card-white border border-border-soft rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-subtle">
              <span className="text-[10px] font-mono font-bold tracking-wider uppercase">Spills Detected</span>
              <span className="material-symbols-outlined text-rose-600 text-lg">warning</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-display text-rose-700">{spillCount}</div>
          </div>

          <div className="bg-card-white border border-border-soft rounded-xl p-4 shadow-sm">
            <div className="flex items-center justify-between text-slate-subtle">
              <span className="text-[10px] font-mono font-bold tracking-wider uppercase">Progress</span>
              <span className="material-symbols-outlined text-primary text-lg">donut_large</span>
            </div>
            <div className="mt-2 text-2xl font-bold font-display text-primary">{percentage}%</div>
          </div>
        </section>

        {/* PROGRESS BAR */}
        <section className="bg-card-white border border-border-soft rounded-2xl shadow-sm p-5 space-y-2">
          <div className="flex items-center justify-between text-xs">
            <div className="font-semibold text-slate-700 flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-base">hourglass_top</span>
              <span>
                Batch Progress: {processedCount} of {files.length} scenes completed
              </span>
            </div>
            <span className="font-mono font-bold text-primary">{percentage}%</span>
          </div>
          <div className="h-3 rounded-full bg-slate-100 overflow-hidden relative">
            <motion.div
              className="h-full bg-gradient-to-r from-teal-400 to-cyan-500 rounded-full shadow-sm"
              initial={{ width: 0 }}
              animate={{ width: `${percentage}%` }}
              transition={{ duration: 0.4, ease: "easeOut" }}
            />
          </div>
        </section>

        {/* LOGS TABLE WITH FILTERS */}
        <section className="bg-card-white border border-border-soft rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border-soft flex items-center justify-between gap-4 flex-wrap bg-slate-50/50">
            <div className="flex items-center gap-2">
              <span className="material-symbols-outlined text-primary text-lg">terminal</span>
              <h2 className="text-sm font-bold font-display text-slate-heading">Batch Execution Stream</h2>
              <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-slate-200 text-slate-700 font-bold">
                {filteredLogs.length} Records
              </span>
            </div>

            {/* Filter Pills */}
            <div className="flex items-center gap-1.5 text-xs font-mono">
              {[
                { id: "all", label: "All" },
                { id: "processing", label: `Active (${activeCount})` },
                { id: "spills", label: `Spills (${spillCount})` },
                { id: "completed", label: "Completed" },
                { id: "skipped", label: "Skipped" },
              ].map((f) => (
                <button
                  key={f.id}
                  onClick={() => setLogFilter(f.id)}
                  className={`px-3 py-1 rounded-lg transition-colors font-medium text-[11px] ${
                    logFilter === f.id
                      ? "bg-slate-900 text-white font-bold shadow-xs"
                      : "bg-white text-slate-600 border border-slate-200 hover:bg-slate-100"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>
          </div>

          <div className="divide-y divide-slate-100 max-h-[460px] overflow-y-auto">
            {filteredLogs.length === 0 ? (
              <div className="p-12 text-center text-xs font-mono text-slate-400">
                {files.length === 0
                  ? "Select a folder above and click 'Start Batch Analysis' to begin."
                  : "No events match the selected filter."}
              </div>
            ) : (
              filteredLogs.map((log, index) => {
                const isCompleted = log.status === "completed";
                const isSkipped = log.status === "skipped";
                const isProcessing = log.status === "processing";
                const isSpill = log.isSpill || log.classificationStatus === "Spill Detected";

                return (
                  <motion.div
                    key={`${log.fileName}-${index}`}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="px-5 py-3.5 flex items-center gap-3.5 text-xs hover:bg-slate-50/80 transition-colors"
                  >
                    {/* Status Icon */}
                    <span
                      className={`material-symbols-outlined text-base shrink-0 ${
                        isCompleted
                          ? isSpill
                            ? "text-rose-600"
                            : "text-emerald-600"
                          : isSkipped
                          ? "text-amber-600"
                          : "text-primary animate-spin"
                      }`}
                    >
                      {isCompleted
                        ? isSpill
                          ? "warning"
                          : "check_circle"
                        : isSkipped
                        ? "error_outline"
                        : "progress_activity"}
                    </span>

                    {/* File Name */}
                    <div className="font-mono font-semibold text-slate-800 truncate flex-1 min-w-0" title={log.fileName}>
                      {log.fileName}
                    </div>

                    {/* Classification Status / Message */}
                    <div className="shrink-0 font-mono text-[11px] font-semibold">
                      {isCompleted ? (
                        <span
                          className={`px-2.5 py-0.5 rounded-full border ${
                            isSpill
                              ? "bg-rose-50 text-rose-700 border-rose-200"
                              : "bg-emerald-50 text-emerald-700 border-emerald-200"
                          }`}
                        >
                          {log.classificationStatus || "Processed"}
                        </span>
                      ) : isSkipped ? (
                        <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-200">
                          {log.message}
                        </span>
                      ) : (
                        <span className="text-cyan-700 animate-pulse">{log.message}</span>
                      )}
                    </div>

                    {/* Confidence */}
                    {log.confidence != null && (
                      <span className="shrink-0 font-mono text-slate-600 text-[11px] w-14 text-right">
                        {log.confidence}% conf
                      </span>
                    )}

                    {/* Elapsed Time */}
                    {log.processingTimeSeconds != null && (
                      <span className="shrink-0 font-mono text-slate-400 text-[10px] w-12 text-right">
                        {log.processingTimeSeconds}s
                      </span>
                    )}

                    {/* Action Links */}
                    <div className="shrink-0 flex items-center gap-2 pl-2">
                      {log.quickLook && log.jobId && (
                        <a
                          className="px-2 py-1 rounded bg-sky-50 hover:bg-sky-100 text-primary border border-sky-200 text-[10px] font-mono font-bold transition-colors"
                          href={api.fileUrl(log.jobId, log.quickLook)}
                          target="_blank"
                          rel="noreferrer"
                        >
                          QUICK LOOK ↗
                        </a>
                      )}

                      {log.predictionId && (
                        <Link
                          className="px-2.5 py-1 rounded bg-primary hover:bg-primary-hover text-abyss-950 text-[10px] font-mono font-bold transition-colors shadow-xs"
                          to={`/results/${log.predictionId}`}
                        >
                          VIEW RESULT →
                        </Link>
                      )}
                    </div>
                  </motion.div>
                );
              })
            )}
          </div>
        </section>
      </div>
    </main>
  );
}

