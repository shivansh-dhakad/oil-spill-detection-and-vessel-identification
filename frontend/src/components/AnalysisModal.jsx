import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../api.js";
import Stage3D from "./Stage3D.jsx";

const STAGE_META = {
  extraction: { label: "Extracting Input", icon: "folder_open" },
  preprocessing: { label: "Preprocessing Imagery", icon: "tune" },
  model_inference: { label: "Loading & Running Model", icon: "memory" },
  segmentation: { label: "Generating Segmentation", icon: "layers" },
  geolocation: { label: "Resolving Coordinates", icon: "location_on" },
  environmental_data: { label: "Fetching Ocean & Wind Data", icon: "air" },
  drift_hindcast: { label: "Backward Drift Hindcast", icon: "waves" },
  vessel_attribution: { label: "Cross-Referencing AIS", icon: "directions_boat" },
};
const STAGE_ORDER = Object.keys(STAGE_META);

function StatusIcon({ status }) {
  if (status === "running")
    return <span className="material-symbols-outlined text-primary animate-spin text-base">progress_activity</span>;
  if (status === "success")
    return <span className="material-symbols-outlined text-emerald-400 text-base">check_circle</span>;
  if (status === "warning")
    return <span className="material-symbols-outlined text-amber-400 text-base">warning</span>;
  if (status === "error")
    return <span className="material-symbols-outlined text-rose-400 text-base">error</span>;
  if (status === "skipped")
    return <span className="material-symbols-outlined text-slate-subtle text-base">remove_circle</span>;
  return <span className="material-symbols-outlined text-slate-subtle text-base">radio_button_unchecked</span>;
}

/**
 * Small status window shown over the upload page while a submitted job runs.
 * Streams stage progress via SSE and calls onComplete(predictionId) once the
 * ML service finishes, or lets the user close it on failure. A 3D scene up
 * top mirrors whichever stage is currently active, swapping automatically
 * as the pipeline advances.
 */
export default function AnalysisModal({ jobId, meta, onComplete, onClose }) {
  const [stages, setStages] = useState(
    Object.fromEntries(STAGE_ORDER.map((name) => [name, { name, status: "pending", message: "" }]))
  );
  const [status, setStatus] = useState("queued");
  const [error, setError] = useState(null);
  const doneRef = useRef(false);

  useEffect(() => {
    doneRef.current = false;

    const applyUpdate = (data) => {
      if (doneRef.current) return;
      setStatus(data.status);
      if (Array.isArray(data.stages)) {
        setStages((prev) => {
          const next = { ...prev };
          for (const s of data.stages) next[s.name] = s;
          return next;
        });
      }
      if (data.status === "complete") {
        doneRef.current = true;
        if (data.predictionId) {
          setTimeout(() => onComplete(data.predictionId), 400);
        } else {
          setError("Analysis finished but no prediction record was returned.");
        }
      } else if (data.status === "failed") {
        doneRef.current = true;
        setError(data.error || "Analysis failed.");
      }
    };

    const cleanup = api.streamJob(jobId, meta, applyUpdate, () => {
      if (doneRef.current) return;
      const poll = setInterval(async () => {
        try {
          const data = await api.getJobStatus(jobId, meta);
          applyUpdate(data);
          if (data.status === "complete" || data.status === "failed") clearInterval(poll);
        } catch (e) {
          clearInterval(poll);
          setError(e.message);
        }
      }, 1500);
    });

    return () => {
      doneRef.current = true;
      cleanup();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);

  const completedCount = STAGE_ORDER.filter((n) => stages[n]?.status === "success").length;
  const progressPct = Math.round((completedCount / STAGE_ORDER.length) * 100);

  // Which stage the big 3D panel should currently show: the one actively
  // running, falling back to the failed one, then the last completed one,
  // then the first stage before anything has started.
  const runningStage = STAGE_ORDER.find((n) => stages[n]?.status === "running");
  const failedStage = STAGE_ORDER.find((n) => stages[n]?.status === "error");
  const lastDoneStage = [...STAGE_ORDER].reverse().find((n) => stages[n]?.status === "success");
  const activeStageName = runningStage || failedStage || lastDoneStage || STAGE_ORDER[0];
  const activeStatus = stages[activeStageName]?.status || "pending";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-abyss-950/70 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 10 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md glass-panel rounded-2xl shadow-glow-lg p-5 space-y-4"
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-primary text-xl animate-pulse">satellite_alt</span>
            <h3 className="text-sm font-bold text-slate-heading">
              {error ? "Analysis Failed" : "Running Analysis…"}
            </h3>
          </div>
          {error && (
            <button
              onClick={onClose}
              className="p-1 rounded-lg text-slate-subtle hover:text-slate-heading hover:bg-white/10 transition-colors"
            >
              <span className="material-symbols-outlined text-lg">close</span>
            </button>
          )}
        </div>

        {/* 3D scene for the currently active stage */}
        <div className="relative rounded-xl border border-white/10 bg-black/20">
          <AnimatePresence mode="wait">
            <motion.div
              key={activeStageName}
              initial={{ opacity: 0, scale: 0.96 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.96 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            >
              <Stage3D stage={activeStageName} status={activeStatus} />
            </motion.div>
          </AnimatePresence>
          <div className="absolute bottom-1.5 left-1/2 -translate-x-1/2 px-2.5 py-0.5 rounded-full bg-black/40 border border-white/10 text-[10px] font-mono text-cyan-200 tracking-wide whitespace-nowrap">
            {STAGE_META[activeStageName]?.label}
          </div>
        </div>

        {!error && (
          <div className="space-y-1">
            <div className="w-full h-1.5 bg-white/10 rounded-full overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-cyan-400 to-teal-300 rounded-full transition-all duration-500 shadow-glow"
                style={{ width: `${progressPct}%` }}
              />
            </div>
            <div className="text-right text-[10px] font-mono text-slate-subtle">{progressPct}%</div>
          </div>
        )}

        <div className="space-y-1.5 max-h-56 overflow-y-auto custom-scrollbar">
          {STAGE_ORDER.map((name) => {
            const stage = stages[name] || { status: "pending" };
            const m = STAGE_META[name];
            const isActive = name === activeStageName;
            return (
              <div
                key={name}
                className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-xs transition-colors ${
                  stage.status === "running"
                    ? "bg-cyan-500/10"
                    : isActive
                    ? "bg-white/5"
                    : "bg-transparent"
                }`}
              >
                <StatusIcon status={stage.status} />
                <span className="material-symbols-outlined text-slate-subtle text-sm">{m.icon}</span>
                <span
                  className={`font-medium truncate ${
                    stage.status === "pending" ? "text-slate-subtle" : "text-slate-heading"
                  }`}
                >
                  {m.label}
                </span>
              </div>
            );
          })}
        </div>

        {error && (
          <div className="text-xs font-mono text-rose-300 bg-rose-500/10 border border-rose-400/25 rounded-lg px-3 py-2">
            {error}
          </div>
        )}

        {!error && status === "complete" && (
          <p className="text-center text-xs font-mono text-emerald-400">Done - loading results…</p>
        )}
      </motion.div>
    </div>
  );
}