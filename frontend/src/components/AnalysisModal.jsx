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
  drift_forecast: { label: "Forward Drift Forecasting", icon: "trending_up" },
  vessel_attribution: { label: "Cross-Referencing AIS", icon: "directions_boat" },
};
const STAGE_ORDER = Object.keys(STAGE_META);

function StatusIcon({ status }) {
  if (status === "running")
    return <span className="material-symbols-outlined text-[#0f7f8c] animate-spin text-base">progress_activity</span>;
  if (status === "success")
    return <span className="material-symbols-outlined text-[#0f7f8c] text-base">check_circle</span>;
  if (status === "warning")
    return <span className="material-symbols-outlined text-[#c8962e] text-base">warning</span>;
  if (status === "error")
    return <span className="material-symbols-outlined text-[#e2532b] text-base">error</span>;
  if (status === "skipped")
    return <span className="material-symbols-outlined text-[#6b7d92] opacity-60 text-base">remove_circle</span>;
  return <span className="material-symbols-outlined text-[#6b7d92] opacity-50 text-base">radio_button_unchecked</span>;
}

/**
 * Status modal shown over the dashboard / upload page while a submitted job runs.
 * Styled with the VarunaDrishti maritime survey-chart light theme to match Dashboard & History.
 */
export default function AnalysisModal({ jobId, meta, onComplete, onClose }) {
  const [stages, setStages] = useState(
    Object.fromEntries(STAGE_ORDER.map((name) => [name, { name, status: "pending", message: "" }]))
  );
  const [status, setStatus] = useState("queued");
  const [error, setError] = useState(null);
  const [cancelling, setCancelling] = useState(false);
  const doneRef = useRef(false);

  async function handleClose() {
    if (error || status === "complete") {
      onClose();
      return;
    }
    if (!window.confirm("Stop this analysis? Its result will not be saved to history.")) return;

    setCancelling(true);
    doneRef.current = true;
    try {
      await api.cancelJob(jobId);
    } catch (e) {
      doneRef.current = false;
      setCancelling(false);
      setError(e.message || "Unable to stop the analysis.");
      return;
    }
    onClose();
  }

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
      } else if (data.status === "cancelled") {
        doneRef.current = true;
        onClose();
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

  // Which stage the 3D panel should currently show: active running, failed, last completed, or first pending
  const runningStage = STAGE_ORDER.find((n) => stages[n]?.status === "running");
  const failedStage = STAGE_ORDER.find((n) => stages[n]?.status === "error");
  const lastDoneStage = [...STAGE_ORDER].reverse().find((n) => stages[n]?.status === "success");
  const activeStageName = runningStage || failedStage || lastDoneStage || STAGE_ORDER[0];
  const activeStatus = stages[activeStageName]?.status || "pending";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#0c2340]/45 backdrop-blur-md">
      <motion.div
        initial={{ opacity: 0, scale: 0.94, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
        className="w-full max-w-md bg-[#fbf9f3] text-[#0c2340] border border-[rgba(12,35,64,0.14)] rounded-3xl shadow-[0_28px_60px_-20px_rgba(12,35,64,0.35),0_0_0_1px_rgba(12,35,64,0.06)] p-6 space-y-4.5 relative overflow-hidden"
      >
        {/* Subtle decorative top accent line */}
        <div className="absolute top-0 inset-x-0 h-1 bg-gradient-to-r from-[#0f7f8c] via-[#c8962e] to-[#e2532b]" />

        {/* Modal Header */}
        <div className="flex items-center justify-between pt-1">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-[rgba(15,127,140,0.12)] border border-[rgba(15,127,140,0.25)] flex items-center justify-center text-[#0f7f8c] shadow-sm">
              <span className="material-symbols-outlined text-xl animate-pulse">satellite_alt</span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-mono font-bold tracking-widest text-[#0f7f8c] uppercase">
                  Live SAR Pipeline
                </span>
                <span className="w-1.5 h-1.5 rounded-full bg-[#0f7f8c] animate-ping" />
              </div>
              <h3 className="text-base font-bold font-display text-[#0c2340] tracking-tight">
                {error ? "Analysis Failed" : "Running Analysis…"}
              </h3>
            </div>
          </div>
          <button
            onClick={handleClose}
            disabled={cancelling}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-[#6b7d92] hover:text-[#e2532b] hover:bg-[rgba(226,83,43,0.08)] border border-transparent hover:border-[rgba(226,83,43,0.2)] disabled:opacity-60 transition-all"
            title={error ? "Close" : "Stop analysis"}
          >
            <span className="material-symbols-outlined text-lg">close</span>
          </button>
        </div>

        {/* 3D scene container */}
        <div className="relative rounded-2xl border border-[rgba(12,35,64,0.12)] bg-[#eae4d6]/60 overflow-hidden shadow-inner">
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
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 px-3 py-1 rounded-full bg-[#fbf9f3]/95 backdrop-blur-sm border border-[rgba(12,35,64,0.14)] text-[11px] font-mono font-semibold text-[#0c2340] tracking-wide shadow-sm whitespace-nowrap flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-[#0f7f8c]" />
            {STAGE_META[activeStageName]?.label}
          </div>
        </div>

        {/* Progress bar */}
        {!error && (
          <div className="space-y-1.5">
            <div className="flex items-center justify-between text-[11px] font-mono">
              <span className="text-[#6b7d92] font-medium">Pipeline Progress</span>
              <span className="text-[#0c2340] font-bold">{progressPct}%</span>
            </div>
            <div className="w-full h-2 bg-[rgba(12,35,64,0.08)] rounded-full overflow-hidden p-0.5 border border-[rgba(12,35,64,0.06)]">
              <div
                className="h-full bg-gradient-to-r from-[#0f7f8c] to-[#e2532b] rounded-full transition-all duration-500 shadow-sm"
                style={{ width: `${progressPct}%` }}
              />
            </div>
          </div>
        )}

        {/* Stages checklist */}
        <div className="space-y-1 max-h-56 overflow-y-auto pr-1 custom-scrollbar">
          {STAGE_ORDER.map((name) => {
            const stage = stages[name] || { status: "pending" };
            const m = STAGE_META[name];
            const isActive = name === activeStageName;
            const isRunning = stage.status === "running";
            const isSuccess = stage.status === "success";
            const isError = stage.status === "error";

            return (
              <div
                key={name}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-xs transition-all ${
                  isRunning
                    ? "bg-[rgba(15,127,140,0.12)] border border-[rgba(15,127,140,0.28)] text-[#0c2340] shadow-sm"
                    : isError
                    ? "bg-[rgba(226,83,43,0.08)] border border-[rgba(226,83,43,0.25)] text-[#e2532b]"
                    : isActive
                    ? "bg-[rgba(12,35,64,0.04)] border border-[rgba(12,35,64,0.08)] text-[#0c2340]"
                    : isSuccess
                    ? "text-[#3c4e64] hover:bg-[rgba(12,35,64,0.02)]"
                    : "text-[#6b7d92] opacity-75"
                }`}
              >
                <StatusIcon status={stage.status} />
                <span className={`material-symbols-outlined text-sm ${isRunning || isSuccess ? "text-[#0f7f8c]" : "text-[#6b7d92]"}`}>
                  {m.icon}
                </span>
                <span className={`font-medium truncate flex-1 ${isRunning ? "font-bold text-[#0c2340]" : ""}`}>
                  {m.label}
                </span>
                {isRunning && (
                  <span className="text-[10px] font-mono uppercase tracking-wider text-[#0f7f8c] font-bold">
                    Active
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Error message */}
        {error && (
          <div className="text-xs font-mono text-[#e2532b] bg-[rgba(226,83,43,0.08)] border border-[rgba(226,83,43,0.25)] rounded-xl px-3.5 py-2.5 flex items-center gap-2">
            <span className="material-symbols-outlined text-base text-[#e2532b] shrink-0">error</span>
            <span className="truncate">{error}</span>
          </div>
        )}

        {/* Done message */}
        {!error && status === "complete" && (
          <div className="flex items-center justify-center gap-2 text-xs font-mono font-bold text-[#0f7f8c] bg-[rgba(15,127,140,0.08)] border border-[rgba(15,127,140,0.2)] rounded-xl py-2 px-3">
            <span className="material-symbols-outlined text-base animate-spin">sync</span>
            <span>Done · Loading results…</span>
          </div>
        )}
      </motion.div>
    </div>
  );
}