import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../api.js";
import AnalysisModal from "../components/AnalysisModal.jsx";
import OrbitHero from "../components/OrbitHero.jsx";
import { AnalysisParametersCard, DetectionModelCard, VesselAnomalyCard } from "../components/SystemCapabilities.jsx";

const fadeUp = {
  hidden: { opacity: 0, y: 16 },
  show: (i = 0) => ({
    opacity: 1,
    y: 0,
    transition: { duration: 0.5, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] },
  }),
};

export default function NewPrediction() {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  // Set once analysis starts; rendering <AnalysisModal jobId={...}> mounts the modal.
  const [activeJob, setActiveJob] = useState(null); // { jobId, meta }

  const inputRef = useRef(null);
  const navigate = useNavigate();

  const accept = ".zip,.SAFE";

  function handleFiles(fileList) {
    if (fileList && fileList[0]) {
      setFile(fileList[0]);
      setError(null);
    }
  }

  async function handleRunAnalysis() {
    if (!file) {
      setError("Select a file to analyze first.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const sourceType = "safe_zip";
      const sensor = "Sentinel-1A IW";
      const { jobId } = await api.createPrediction({
        file,
        sourceType,
        sensor,
      });
      setActiveJob({ jobId, meta: { sourceType, sensor, originalName: file.name } });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="pt-16 h-screen flex flex-col overflow-hidden">
      {/* Everything below the header fills the remaining viewport height, no page scroll */}
      <div className="flex-1 min-h-0 flex flex-col p-4 md:p-6 gap-4 md:gap-5 max-w-[1400px] w-full mx-auto">
        {/* TOP ROW: page title + 3D hero + input option selector */}
        <motion.div
          initial="hidden"
          animate="show"
          custom={0}
          variants={fadeUp}
          className="shrink-0 flex items-center justify-between gap-4 flex-wrap"
        >
          <div className="flex items-center gap-4">
            <OrbitHero className="hidden md:block w-16 h-16 shrink-0" />
            <div>
              <h1 className="text-lg font-bold font-display tracking-tight gradient-text">
                Oil Spill Detection &amp; Vessel Attribution
              </h1>
              <p className="text-xs text-slate-subtle">Upload a scene to run detection</p>
            </div>
          </div>

          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-cyan-500/10 border border-cyan-400/25 text-primary shadow-glow">
            <span className="material-symbols-outlined text-lg">archive</span>
            <span className="text-sm font-semibold">Sentinel-1 .SAFE.zip</span>
          </div>
        </motion.div>

        {/* TWO-COLUMN WORKSPACE: fills remaining height, each column scrolls internally if needed */}
        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 overflow-hidden">
          {/* LEFT COLUMN: upload + run, then model summary cards */}
          <div className="lg:col-span-5 min-h-0 flex flex-col gap-4 md:gap-5 overflow-y-auto pr-1 custom-scrollbar">
            {/* Input area */}
            <motion.div
              initial="hidden"
              animate="show"
              custom={1}
              variants={fadeUp}
              className="glass-panel rounded-2xl shadow-glow-lg p-5 space-y-4 shrink-0"
            >
              <div
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOver(true);
                }}
                onDragLeave={() => setDragOver(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setDragOver(false);
                  handleFiles(e.dataTransfer.files);
                }}
                className={`relative group rounded-2xl border-2 border-dashed p-6 transition-all duration-300 flex flex-col items-center text-center overflow-hidden ${
                  dragOver ? "border-primary bg-cyan-500/10 shadow-glow scale-[1.01]" : "border-white/15 hover:border-cyan-400/50 hover:bg-cyan-500/5"
                }`}
              >
                {dragOver && (
                  <div className="pointer-events-none absolute inset-0">
                    <div className="absolute inset-x-0 h-1/3 animate-scan bg-gradient-to-b from-transparent via-cyan-400/20 to-transparent" />
                  </div>
                )}
                <div className="w-12 h-12 mb-3 rounded-2xl bg-cyan-500/10 border border-cyan-400/25 flex items-center justify-center text-primary group-hover:scale-110 group-hover:shadow-glow transition-all duration-300">
                  <span className="material-symbols-outlined text-2xl">cloud_upload</span>
                </div>
                <h3 className="text-sm font-bold text-slate-heading mb-1">
                  Drop a .SAFE.zip here, or browse
                </h3>
                <p className="text-xs text-slate-subtle mb-4">
                  Sentinel-1 .SAFE.zip archive
                </p>
                <label className="cursor-pointer px-5 py-2.5 rounded-xl bg-primary hover:bg-primary-hover hover:shadow-glow text-abyss-950 text-xs font-mono font-semibold flex items-center gap-2 shadow-sm transition-all duration-300">
                  <span className="material-symbols-outlined text-base">file_open</span>
                  Select .SAFE.zip
                  <input
                    ref={inputRef}
                    accept={accept}
                    className="hidden"
                    type="file"
                    onChange={(e) => handleFiles(e.target.files)}
                  />
                </label>

                {file && (
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="mt-4 w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-white/5 border border-white/10 text-left"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="material-symbols-outlined text-primary shrink-0">
                        archive
                      </span>
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-slate-heading truncate">{file.name}</div>
                        <div className="text-xs font-mono text-slate-subtle">{(file.size / (1024 * 1024)).toFixed(2)} MB</div>
                      </div>
                    </div>
                    <button
                      onClick={() => setFile(null)}
                      className="p-1.5 rounded-lg text-slate-subtle hover:text-rose-400 hover:bg-rose-500/10 transition-colors shrink-0"
                      title="Remove file"
                    >
                      <span className="material-symbols-outlined text-lg">close</span>
                    </button>
                  </motion.div>
                )}
              </div>

              {error && (
                <div className="text-xs font-mono text-rose-300 bg-rose-500/10 border border-rose-400/25 rounded-lg px-3 py-2">
                  {error}
                </div>
              )}

              <div className="flex items-center gap-2.5">
                {/* Run button, directly below the input area */}
                <button
                  onClick={handleRunAnalysis}
                  disabled={submitting}
                  className="flex-1 py-3 px-4 rounded-xl bg-primary hover:bg-primary-hover hover:shadow-glow-lg disabled:opacity-60 disabled:cursor-not-allowed text-abyss-950 shadow-glow flex items-center justify-center gap-2 font-mono text-xs font-semibold tracking-wide transition-all duration-300"
                >
                  <span className={`material-symbols-outlined text-lg ${submitting ? "animate-spin" : ""}`}>{submitting ? "progress_activity" : "bolt"}</span>
                  {submitting ? "SUBMITTING…" : "RUN ANALYSIS"}
                </button>
              </div>
            </motion.div>

            <motion.section
              initial="hidden"
              animate="show"
              custom={2}
              variants={fadeUp}
              className="relative bg-slate-900 rounded-2xl p-5 text-white shrink-0 overflow-hidden tilt-card"
            >
              <div className="pointer-events-none absolute -top-10 -right-10 w-32 h-32 rounded-full bg-cyan-400/10 blur-2xl animate-floatY" />
              <div className="relative flex items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2 text-cyan-300">
                    <span className="material-symbols-outlined text-xl">queue_play_next</span>
                    <span className="text-[10px] font-mono font-bold uppercase tracking-[0.16em]">Batch workspace</span>
                  </div>
                  <h2 className="mt-2 text-base font-bold font-display">Process a folder of SAFE products</h2>
                  <p className="mt-1 text-xs leading-5 text-slate-300">
                    Scan nested folders, run multiple Sentinel-1 archives, and follow progress and processing logs in one view.
                  </p>
                </div>
                <span className="material-symbols-outlined text-3xl text-cyan-300 animate-floatY">folder_zip</span>
              </div>
              <Link
                to="/batch"
                className="relative mt-4 w-full py-2.5 px-4 rounded-xl bg-cyan-400 hover:bg-cyan-300 hover:shadow-glow-lg text-slate-950 flex items-center justify-center gap-2 font-mono text-xs font-bold transition-all duration-300"
              >
                CONVERT TO BATCH PROCESSING
                <span className="material-symbols-outlined text-base">transform</span>
              </Link>
            </motion.section>

            {/* Pipeline at a glance: model + anomaly detector, side by side */}
            <motion.div initial="hidden" animate="show" custom={3} variants={fadeUp} className="grid grid-cols-2 gap-4">
              <div className="tilt-card"><DetectionModelCard /></div>
              <div className="tilt-card"><VesselAnomalyCard /></div>
            </motion.div>
          </div>

          {/* RIGHT COLUMN: analysis parameters, fills the full column height */}
          <motion.div
            initial="hidden"
            animate="show"
            custom={1.5}
            variants={fadeUp}
            className="lg:col-span-7 min-h-0"
          >
            <AnalysisParametersCard />
          </motion.div>
        </div>
      </div>

      {/* Small loading window shown during analysis */}
      {activeJob && (
        <AnalysisModal
          jobId={activeJob.jobId}
          meta={activeJob.meta}
          onComplete={(predictionId) => navigate(`/results/${predictionId}`)}
          onClose={() => setActiveJob(null)}
        />
      )}
    </main>
  );
}
