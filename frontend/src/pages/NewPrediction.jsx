import { useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { motion, useScroll, useTransform } from "framer-motion";
import { api } from "../api.js";
import AnalysisModal from "../components/AnalysisModal.jsx";
import "../dashboard.css";

/* ------------------------------------------------------------------ data */

const STAGES = [
  { icon: "folder_open", tag: "Input", title: "Extraction", text: "Unpacks the .SAFE archive, reads the VV and VH measurement bands and the product's own metadata." },
  { icon: "tune", tag: "Input", title: "Preprocessing", text: "Calibrates raw values to sigma-0 dB, then resizes and normalizes to exactly what the model was trained on." },
  { icon: "memory", tag: "Detection", title: "Model inference", text: "A UNet++ network labels every pixel as oil or open water, averaging four flipped and rotated passes for stability." },
  { icon: "layers", tag: "Detection", title: "Segmentation", text: "Cleans specks out of the mask and renders the overlay and quick-look thumbnail you see in the results." },
  { icon: "location_on", tag: "Where", title: "Geolocation", text: "Maps the slick's outline to latitude and longitude, and snaps the seed point offshore if the centroid lands on land." },
  { icon: "air", tag: "Context", title: "Ocean & wind data", text: "Pulls currents and wind for the look-back window, falling back to Copernicus in-situ observations when currents are missing." },
  { icon: "history", tag: "When", title: "Drift hindcast", text: "Runs OpenDrift backwards in time to estimate where and roughly when the oil was released." },
  { icon: "trending_up", tag: "Next", title: "Drift forecast", text: "Projects the slick forward 24 hours so responders know where it is heading." },
  { icon: "directions_boat", tag: "Who", title: "Vessel attribution", text: "Finds ships that were near the estimated origin from GFW and AISStream, and ranks them by the evidence." },
];

const WEIGHTS = [
  { label: "Haversine proximity", pct: 45, color: "#0c2340" },
  { label: "Time proximity", pct: 25, color: "#0f7f8c" },
  { label: "Trajectory intersection", pct: 15, color: "#c8962e" },
  { label: "Vessel type risk", pct: 10, color: "#e2532b" },
  { label: "Speed anomaly", pct: 5, color: "#7d90a6" },
];

const SOURCES = [
  { name: "Open-Meteo", note: "Wind, waves and ocean currents (currents from 2022 onward)" },
  { name: "Copernicus In-Situ", note: "Buoy and drifter currents as a fallback" },
  { name: "Global Fishing Watch", note: "Historical vessel presence and identity" },
  { name: "AISStream", note: "Live vessel position reports" },
];

const TICKER = ["Sentinel-1 SAR", "VV / VH", "UNet++", "OpenDrift", "Global Fishing Watch", "AISStream", "Copernicus Marine", "Isolation Forest"];

const rise = {
  hidden: { opacity: 0, y: 28 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.75, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] } }),
};

/* ------------------------------------------------------- generated chart art */

// Organic, wobbly closed curve - stacked, these read as bathymetry contours
// and as an oil slick spreading at the same time.
function blobPath(cx, cy, r, seed, n = 120) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2;
    const wob = 1 + 0.09 * Math.sin(3 * t + seed) + 0.055 * Math.sin(5 * t + seed * 1.7) + 0.03 * Math.sin(9 * t + seed * 2.3);
    const rr = r * wob;
    pts.push(`${(cx + rr * Math.cos(t)).toFixed(1)},${(cy + rr * 0.82 * Math.sin(t)).toFixed(1)}`);
  }
  return `M${pts.join("L")}Z`;
}

function starPoints(cx, cy, R, r) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5;
    const rad = i % 2 === 0 ? R : r;
    pts.push(`${(cx + rad * Math.cos(a)).toFixed(1)},${(cy + rad * Math.sin(a)).toFixed(1)}`);
  }
  return pts.join(" ");
}

function SlickChart() {
  const rings = useMemo(
    () => Array.from({ length: 17 }, (_, i) => ({ d: blobPath(400, 400, 46 + i * 21, i * 0.22), major: i % 4 === 0 })),
    []
  );
  const slick = useMemo(() => blobPath(400, 400, 30, 1.3, 90), []);

  return (
    <svg viewBox="0 0 800 800" className="lt-art-svg" aria-hidden="true">
      <g stroke="rgba(12,35,64,0.08)" strokeWidth="1">
        {[100, 200, 300, 400, 500, 600, 700].map((v) => (
          <g key={v}>
            <line x1={v} y1="0" x2={v} y2="800" />
            <line x1="0" y1={v} x2="800" y2={v} />
          </g>
        ))}
      </g>

      <g className="lt-sway">
        {rings.map((r, i) => (
          <path key={i} d={r.d} fill="none" stroke="#0c2340" strokeOpacity={r.major ? 0.5 : 0.2} strokeWidth={r.major ? 1.6 : 1} />
        ))}
      </g>

      {/* hindcast: where it came from */}
      <path className="lt-flow is-back" d="M400 400 C 340 455 275 500 215 565" fill="none" stroke="#c8962e" strokeWidth="2.4" strokeLinecap="round" />
      <polygon points={starPoints(215, 565, 13, 5.5)} fill="#c8962e" stroke="#f3efe6" strokeWidth="2" />
      <text x="140" y="545" fill="#8a6412">HINDCAST ORIGIN</text>

      {/* candidate vessel near the origin */}
      <line x1="262" y1="606" x2="222" y2="572" stroke="#0c2340" strokeWidth="1.4" strokeDasharray="2 5" />
      <polygon points="262,592 273,614 251,614" fill="#0c2340" stroke="#f3efe6" strokeWidth="2" />
      <text x="286" y="636" fill="#0c2340">CANDIDATE VESSEL</text>

      {/* forecast: where it is going */}
      <path className="lt-flow" d="M400 400 C 470 350 545 330 610 245" fill="none" stroke="#0f7f8c" strokeWidth="2.4" strokeLinecap="round" />
      <circle cx="610" cy="245" r="8" fill="#f3efe6" stroke="#0f7f8c" strokeWidth="2.4" />
      <text x="626" y="242" fill="#0f7f8c">T+24H</text>

      {/* the slick */}
      <circle className="lt-pulse" cx="400" cy="400" r="34" fill="none" stroke="#e2532b" strokeWidth="2" />
      <path d={slick} fill="#e2532b" fillOpacity="0.92" stroke="#f3efe6" strokeWidth="2" />
      <text x="442" y="388" fill="#c23e18">DETECTION</text>
    </svg>
  );
}

/* -------------------------------------------------------------- small bits */

function Line({ children, delay = 0 }) {
  return (
    <span className="lt-line">
      <motion.span
        className="lt-line-inner"
        initial={{ y: "108%" }}
        animate={{ y: 0 }}
        transition={{ duration: 0.95, delay, ease: [0.16, 1, 0.3, 1] }}
      >
        {children}
      </motion.span>
    </span>
  );
}

function Reveal({ children, i = 0, className = "", style }) {
  return (
    <motion.div
      className={className}
      style={style}
      variants={rise}
      custom={i}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, amount: 0.2 }}
    >
      {children}
    </motion.div>
  );
}

function scrollToId(id) {
  document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

/* -------------------------------------------------------------------- page */

export default function NewPrediction() {
  const [file, setFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [activeJob, setActiveJob] = useState(null); // { jobId, meta }

  const inputRef = useRef(null);
  const navigate = useNavigate();
  const accept = ".zip,.SAFE.zip";

  // Scroll-driven cover: the hero stays pinned and fades/zooms while the
  // content "curtain" slides up over it.
  const { scrollY, scrollYProgress } = useScroll();
  const copyY = useTransform(scrollY, [0, 700], [0, -70]);
  const copyOpacity = useTransform(scrollY, [0, 520], [1, 0]);
  const artScale = useTransform(scrollY, [0, 900], [1, 1.22]);
  const artRotate = useTransform(scrollY, [0, 900], [0, 10]);
  const artOpacity = useTransform(scrollY, [0, 800], [1, 0.25]);

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
      const { jobId } = await api.createPrediction({ file, sourceType, sensor });
      setActiveJob({ jobId, meta: { sourceType, sensor, originalName: file.name } });
    } catch (e) {
      setError(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="lt-page">
      <motion.div className="lt-progress" style={{ scaleX: scrollYProgress }} />

      {/* ============================ COVER ============================ */}
      <section className="lt-hero" aria-label="VarunaDrishti cover">
        <div className="lt-hero-art-wrap">
          <motion.div className="lt-hero-art" style={{ scale: artScale, rotate: artRotate, opacity: artOpacity }}>
            <SlickChart />
          </motion.div>
        </div>

        <div className="lt-hero-inner">
          <motion.div className="lt-hero-copy" style={{ y: copyY, opacity: copyOpacity }}>
            <motion.span className="lt-eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.1, duration: 0.8 }}>
              VarunaDrishti · Maritime surveillance
            </motion.span>

            <h1 className="lt-h1 lt-display">
              <Line delay={0.15}>Read the sea.</Line>
              <Line delay={0.3}>
                <em>Trace the slick.</em>
              </Line>
            </h1>

            <motion.p className="lt-hero-sub" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.7, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
              Upload a Sentinel-1 scene. Detect oil on the water, reconstruct where it drifted from, and rank the vessels that could have been there.
            </motion.p>

            <motion.div className="lt-hero-cta" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.85, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
              <button type="button" className="lt-btn lt-btn-ink" onClick={() => scrollToId("analyze")}>
                Start an analysis
                <span className="material-symbols-outlined">arrow_downward</span>
              </button>
              <Link to="/batch" className="lt-btn lt-btn-ghost">
                <span className="material-symbols-outlined">queue_play_next</span>
                Batch processing
              </Link>
            </motion.div>
          </motion.div>
        </div>

        <div className="lt-hero-foot">
          <span>Sentinel-1 SAR · VV / VH · 9-stage pipeline</span>
          <span className="lt-cue">
            Scroll
            <span className="lt-cue-line" />
          </span>
        </div>
      </section>

      {/* ============================ CURTAIN ============================ */}
      <div className="lt-curtain">
        <div className="lt-ticker" aria-hidden="true">
          <div className="lt-ticker-track">
            {[0, 1].map((k) => (
              <div className="lt-ticker-set" key={k}>
                {TICKER.map((t) => (
                  <span key={`${k}-${t}`}>{t}</span>
                ))}
              </div>
            ))}
          </div>
        </div>

        {/* ---------- 01 Analyze ---------- */}
        <section id="analyze" className="lt-section">
          <div className="lt-split">
            <div>
              <Reveal><span className="lt-eyebrow">01 · Analyze</span></Reveal>
              <Reveal i={1}>
                <h2 className="lt-h2 lt-display">
                  Bring a scene.<br />
                  <em>Get a case file.</em>
                </h2>
              </Reveal>
              <Reveal i={2}>
                <p className="lt-lede">
                  Drop in a Sentinel-1 SAFE archive. The pipeline runs in the background and you can watch each stage complete.
                </p>
              </Reveal>
              <Reveal i={3}>
                <ul className="lt-facts">
                  <li>
                    <span className="lt-fact-ico"><span className="material-symbols-outlined">my_location</span></span>
                    <div><strong>No coordinates to type</strong>SAFE archives carry their own location and acquisition time.</div>
                  </li>
                  <li>
                    <span className="lt-fact-ico"><span className="material-symbols-outlined">speed</span></span>
                    <div><strong>Live progress</strong>A status window tracks every stage from extraction to vessel attribution.</div>
                  </li>
                  <li>
                    <span className="lt-fact-ico"><span className="material-symbols-outlined">check_circle</span></span>
                    <div><strong>Clean scene, quick answer</strong>If no oil is found the run stops early, since there is nothing to trace.</div>
                  </li>
                </ul>
              </Reveal>
            </div>

            <Reveal i={2}>
              <div className="lt-upload">
                <div className="lt-upload-head">
                  <span className="lt-eyebrow is-plain">New analysis</span>
                  <div className="lt-chips">
                    <span className="lt-chip">.SAFE.zip</span>
                  </div>
                </div>

                <div
                  className={`lt-drop ${dragOver ? "is-over" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
                  onDragLeave={() => setDragOver(false)}
                  onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
                >
                  <div className="lt-drop-icon">
                    <span className="material-symbols-outlined">cloud_upload</span>
                  </div>
                  <h3 className="lt-display">Drop a .SAFE.zip here</h3>
                  <p>Sentinel-1 GRD SAFE archive</p>
                  <label className="lt-btn lt-btn-ink lt-pick">
                    <span className="material-symbols-outlined">file_open</span>
                    Select file
                    <input ref={inputRef} accept={accept} className="hidden" type="file" onChange={(e) => handleFiles(e.target.files)} />
                  </label>

                  {file && (
                    <div className="lt-file">
                      <div style={{ minWidth: 0 }}>
                        <div className="lt-file-name">{file.name}</div>
                        <div className="lt-file-meta">{(file.size / (1024 * 1024)).toFixed(2)} MB</div>
                      </div>
                      <button type="button" className="lt-x" onClick={() => setFile(null)} title="Remove file">
                        <span className="material-symbols-outlined">close</span>
                      </button>
                    </div>
                  )}
                </div>

                {error && <div className="lt-error">{error}</div>}

                <button type="button" className="lt-btn lt-btn-ink lt-run" onClick={handleRunAnalysis} disabled={submitting}>
                  <span className={`material-symbols-outlined ${submitting ? "lt-spin" : ""}`}>{submitting ? "progress_activity" : "bolt"}</span>
                  {submitting ? "SUBMITTING…" : "RUN ANALYSIS"}
                </button>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------- 02 Pipeline ---------- */}
        <section className="lt-section">
          <div className="lt-pipe">
            <div className="lt-sticky">
              <Reveal><span className="lt-eyebrow">02 · Pipeline</span></Reveal>
              <Reveal i={1}>
                <h2 className="lt-h2 lt-display">
                  Nine stages,<br />
                  <em>one case file.</em>
                </h2>
              </Reveal>
              <Reveal i={2}>
                <p className="lt-lede">
                  From raw radar backscatter to a ranked list of suspects. Each stage feeds the next, and every missing input is reported as missing, never guessed.
                </p>
              </Reveal>
            </div>

            <div className="lt-stages">
              {STAGES.map((s, i) => (
                <Reveal key={s.title} className="lt-stage">
                  <div className="lt-stage-num lt-display">{String(i + 1).padStart(2, "0")}</div>
                  <div>
                    <h3 className="lt-stage-title">{s.title}</h3>
                    <p>{s.text}</p>
                  </div>
                  <span className="lt-stage-tag lt-mono">
                    <span className="material-symbols-outlined">{s.icon}</span>
                    {s.tag}
                  </span>
                </Reveal>
              ))}
            </div>
          </div>
        </section>

        {/* ---------- 03 Under the hood ---------- */}
        <section className="lt-section">
          <Reveal><span className="lt-eyebrow">03 · Under the hood</span></Reveal>
          <Reveal i={1}>
            <h2 className="lt-h2 lt-display">
              The models and <em>the evidence.</em>
            </h2>
          </Reveal>

          <div className="lt-bento">
            <Reveal className="s-7">
              <div className="lt-card is-ink" style={{ height: "100%" }}>
                <span className="lt-eyebrow">Detection model</span>
                <h3 className="lt-display">UNet++ segmentation</h3>
                <p>
                  Every pixel of a two-band (VH + VV) radar scene is classified as oil or water. Four test-time passes (original, two flips, a 180° rotation) are averaged before thresholding, then tiny specks are removed.
                </p>
                <div className="lt-stats">
                  <div className="lt-stat"><b>512²</b><span>Input size</span></div>
                  <div className="lt-stat"><b>2</b><span>SAR bands</span></div>
                  <div className="lt-stat"><b>4×</b><span>TTA passes</span></div>
                </div>
              </div>
            </Reveal>

            <Reveal i={1} className="s-5">
              <div className="lt-card" style={{ height: "100%" }}>
                <span className="lt-eyebrow">Vessel score</span>
                <h3 className="lt-display">Five weighted factors</h3>
                <p>The blend is then discounted by AIS track quality, so a sparse track can never look more certain than it is.</p>
                <div className="lt-wbar">
                  {WEIGHTS.map((w, i) => (
                    <motion.div
                      key={w.label}
                      style={{ flex: w.pct, background: w.color }}
                      initial={{ scaleX: 0 }}
                      whileInView={{ scaleX: 1 }}
                      viewport={{ once: true }}
                      transition={{ duration: 0.9, delay: 0.15 + i * 0.08, ease: [0.16, 1, 0.3, 1] }}
                    >
                      {w.pct >= 10 ? `${w.pct}%` : ""}
                    </motion.div>
                  ))}
                </div>
                <ul className="lt-legend">
                  {WEIGHTS.map((w) => (
                    <li key={w.label}>
                      <span><i style={{ background: w.color }} />{w.label}</span>
                      <b>{w.pct}%</b>
                    </li>
                  ))}
                </ul>
              </div>
            </Reveal>

            <Reveal i={1} className="s-5">
              <div className="lt-card is-sea" style={{ height: "100%" }}>
                <span className="lt-eyebrow">Anomaly detection</span>
                <h3 className="lt-display">Isolation Forest</h3>
                <p>
                  Flags unusual vessel behaviour (speed, heading changes, distance and timing gaps) from 8 positional features. It contributes 15% of the final ranking, and only for vessels with a real AIS track.
                </p>
              </div>
            </Reveal>

            <Reveal i={2} className="s-7">
              <div className="lt-card" style={{ height: "100%" }}>
                <span className="lt-eyebrow">Data sources</span>
                <h3 className="lt-display">Four feeds, one picture</h3>
                <div className="lt-sources">
                  {SOURCES.map((s) => (
                    <div className="lt-source" key={s.name}>
                      <b>{s.name}</b>
                      <span>{s.note}</span>
                    </div>
                  ))}
                </div>
              </div>
            </Reveal>
          </div>
        </section>

        {/* ---------- CTA ---------- */}
        <div className="lt-cta-wrap">
          <Reveal>
            <div className="lt-cta">
              <span className="lt-eyebrow">Ready when you are</span>
              <h2 className="lt-display">
                Next scene, <em>please.</em>
              </h2>
              <div className="lt-cta-row">
                <button type="button" className="lt-btn lt-btn-paper" onClick={() => scrollToId("analyze")}>
                  <span className="material-symbols-outlined">cloud_upload</span>
                  Upload a scene
                </button>
                <Link to="/batch" className="lt-btn lt-btn-outline-paper">
                  <span className="material-symbols-outlined">queue_play_next</span>
                  Batch processing
                </Link>
                <Link to="/history" className="lt-btn lt-btn-outline-paper">
                  <span className="material-symbols-outlined">history</span>
                  Prediction history
                </Link>
              </div>
            </div>
          </Reveal>
        </div>

        <p className="lt-note">
          Vessel attribution is probabilistic and does not establish causation. Rankings show relative likelihood among evaluated candidates and are not calibrated probabilities.
        </p>
      </div>

      {/* Status window shown during analysis (unchanged component) */}
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
