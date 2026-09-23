import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../api.js";
import SpillMap from "../components/SpillMap.jsx";
import AnalysisReport from "../components/AnalysisReport.jsx";
import "../dashboard.css";
import "../results.css";

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const rise = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.7, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] } }),
};

// In-page navigation. Only entries whose section actually rendered are shown.
const NAV = [
  { id: "investigation", label: "Investigation" },
  { id: "source", label: "Scene" },
  { id: "detection", label: "Detection" },
  { id: "conditions", label: "Conditions" },
  { id: "hindcast", label: "Hindcast" },
  { id: "forecast", label: "Forecast" },
  { id: "attribution", label: "Attribution" },
  { id: "traffic", label: "Traffic" },
];

function severityInfo(severity) {
  if (severity === "critical") return { label: "Critical slick confirmed", tone: "is-hot" };
  if (severity === "advisory") return { label: "Advisory slick detected", tone: "is-warn" };
  return { label: "Clean scene", tone: "is-clean" };
}

function probColor(probability) {
  if (probability >= 75) return "#0f7f8c";
  if (probability >= 45) return "#8a6412";
  return "#6b7d92";
}

function rankColor(rank) {
  if (rank === 1) return "#7f1d1d";
  if (rank === 2) return "#f97316";
  if (rank === 3) return "#eab308";
  return "#2563eb";
}

function tierBadge(tier) {
  if (!tier) return null;
  if (tier.includes("PROBABLE")) return { label: "Probable source", cls: "is-good" };
  if (tier.includes("CANDIDATE")) return { label: "Candidate", cls: "is-info" };
  return { label: "Low confidence", cls: "" };
}

function formatUtcDate(val, fallback = "—") {
  if (!val) return fallback;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val).replace("T", " ");
    return d.toISOString().slice(0, 19).replace("T", " ") + " UTC";
  } catch {
    return String(val);
  }
}

function formatUtcDay(val, fallback = "—") {
  if (!val) return fallback;
  try {
    const d = new Date(val);
    if (isNaN(d.getTime())) return String(val).slice(0, 10);
    return d.toISOString().slice(0, 10);
  } catch {
    return String(val);
  }
}

function Metric({ icon, label, value, tone = "", text = false, i = 0 }) {
  return (
    <motion.div className={`lr-m ${tone}`} variants={rise} custom={i} initial="hidden" animate="show">
      <div className="lr-m-label">
        <span>{label}</span>
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className={`lr-m-num ${text ? "is-text" : ""}`} title={text ? String(value) : undefined}>
        {value}
      </div>
    </motion.div>
  );
}

function Dial({ value, clean }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div className={`lr-dial ${clean ? "is-clean" : ""}`} style={{ "--v": `${v}%` }}>
      <div className="lr-dial-in">
        <b>{v}%</b>
        <span>confidence</span>
      </div>
    </div>
  );
}

/** Page head: eyebrow, big title, status chips and the run "dial card". */
function ResultHead({ prediction, sev, spillDetected, regionName }) {
  const confidence = prediction.confidence ?? 0;
  return (
    <header className="lr-head">
      <div>
        <motion.span className="lt-eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
          Results · Case file #{prediction.id}
        </motion.span>
        <h1 className={`lr-title lt-display ${spillDetected ? "" : "is-clean"}`}>
          {spillDetected ? "Slick confirmed" : "Clear waters"}
          <em>{regionName}</em>
        </h1>
        <motion.p
          className="lr-sub"
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        >
          {prediction.sensor || "Sentinel-1"} SAR oil spill detection
          {spillDetected ? " and AIS trajectory attribution: where it drifted from, and which vessels were there." : ". Nothing to trace on this scene."}
        </motion.p>
        <div className="lr-chips">
          <span className={`lr-pill ${sev.tone}`}>
            <i />
            {sev.label}
          </span>
          <span className="lr-pill">{formatUtcDate(prediction.acquiredAt)}</span>
        </div>
        <div className="lr-actions">
          {spillDetected && (
            <button type="button" className="lt-btn lt-btn-ink" onClick={() => document.getElementById("investigation")?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              Open investigation
              <span className="material-symbols-outlined">arrow_downward</span>
            </button>
          )}
          <Link to="/history" className="lt-btn lt-btn-ghost">
            <span className="material-symbols-outlined">history</span>
            Prediction history
          </Link>
          <Link to="/" className="lt-btn lt-btn-ghost">
            <span className="material-symbols-outlined">add</span>
            New analysis
          </Link>
        </div>
      </div>

      <motion.div className="lr-dialcard" variants={rise} initial="hidden" animate="show" custom={2}>
        <div className="lr-dialrow">
          <Dial value={confidence} clean={!spillDetected} />
          <div className="lr-dialrow-copy">
            <div className="lr-k">Slick area</div>
            <div className="lr-v">
              {spillDetected ? `${prediction.slickAreaKm2 ?? 0}${prediction.areaIsCoveragePercent ? "%" : " km²"}` : "None"}
            </div>
          </div>
        </div>
        <div style={{ marginTop: 8 }}>
          <div className="lr-kv is-mono">
            <span>Run ID</span>
            <span>#{prediction.id}</span>
          </div>
          <div className="lr-kv">
            <span>Sensor</span>
            <span>{prediction.sensor || "Sentinel-1"}</span>
          </div>
          <div className="lr-kv is-mono">
            <span>Acquired</span>
            <span>{formatUtcDay(prediction.acquiredAt)}</span>
          </div>
          <div className="lr-kv">
            <span>Severity</span>
            <span style={{ textTransform: "capitalize" }}>{prediction.severity || "—"}</span>
          </div>
        </div>
      </motion.div>
    </header>
  );
}

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function PredictionResults() {
  const { id } = useParams();
  const [prediction, setPrediction] = useState(null);
  const [error, setError] = useState(null);
  const [selectedCandidate, setSelectedCandidate] = useState(null);
  const [avail, setAvail] = useState([]);
  const [active, setActive] = useState("investigation");

  useEffect(() => {
    let cancelled = false;
    api
      .getPrediction(id)
      .then((data) => {
        if (cancelled) return;
        setPrediction(data);
        const candidatesList = Array.isArray(data?.candidates) ? data.candidates : [];
        const withTrack = candidatesList.find((c) => (c?.trackPoints || []).length > 1);
        setSelectedCandidate(withTrack || candidatesList[0] || null);
      })
      .catch((e) => !cancelled && setError(e.message));
    return () => {
      cancelled = true;
    };
  }, [id]);

  // Work out which nav targets actually rendered (report sections are conditional).
  useEffect(() => {
    if (!prediction) return undefined;
    const t = setTimeout(() => {
      const ids = NAV.filter((n) => document.getElementById(n.id)).map((n) => n.id);
      setAvail((prev) => (prev.join() === ids.join() ? prev : ids));
    }, 80);
    return () => clearTimeout(t);
  }, [prediction, selectedCandidate]);

  // Highlight the section currently in view.
  useEffect(() => {
    if (!avail.length) return undefined;
    const els = avail.map((n) => document.getElementById(n)).filter(Boolean);
    const io = new IntersectionObserver(
      (entries) => {
        const vis = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (vis) setActive(vis.target.id);
      },
      { rootMargin: "-130px 0px -60% 0px" }
    );
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [avail]);

  if (error) {
    return (
      <main className="lt-page lr-page">
        <div className="lr-state is-error">
          <h3 className="lt-display">Couldn't load this run</h3>
          <p style={{ margin: "0 0 20px" }}>{error}</p>
          <Link to="/" className="lt-btn lt-btn-ink">Back to dashboard</Link>
        </div>
      </main>
    );
  }
  if (!prediction) {
    return (
      <main className="lt-page lr-page">
        <div className="lr-state">Loading prediction…</div>
      </main>
    );
  }

  const sev = severityInfo(prediction.severity);
  const spillDetected = prediction.detection === "detected";
  const candidatesList = Array.isArray(prediction.candidates) ? prediction.candidates : [];

  function selectVesselByMmsi(mmsiOrVessel) {
    if (!mmsiOrVessel) return;
    if (typeof mmsiOrVessel === "object") {
      const targetMmsi = mmsiOrVessel.mmsi || mmsiOrVessel.vesselId;
      const match = candidatesList.find((c) => targetMmsi && (String(c.mmsi) === String(targetMmsi) || String(c.vesselId) === String(targetMmsi)));
      setSelectedCandidate(match || mmsiOrVessel);
      return;
    }
    const mmsiStr = String(mmsiOrVessel);
    const match = candidatesList.find((c) => String(c.mmsi) === mmsiStr || String(c.vesselId) === mmsiStr);
    if (match) setSelectedCandidate(match);
  }

  const regionName = prediction.region?.name || "Unknown region";
  // null when the run has no real geolocation ("0°N, 0°E" is Null Island, not "unknown").
  const regionLat = prediction.region?.lat ?? null;
  const regionLon = prediction.region?.lon ?? null;
  const overlayFile = prediction.files?.overlay || prediction.files?.overlayThumbnail;
  const overlayPreviewFile = prediction.files?.overlayThumbnail || overlayFile;
  const centroidText = prediction.map?.spillCenter
    ? `${prediction.map.spillCenter.lat.toFixed(4)}°N, ${prediction.map.spillCenter.lon.toFixed(4)}°E`
    : regionLat != null && regionLon != null
    ? `${regionLat.toFixed(4)}°N, ${regionLon.toFixed(4)}°E`
    : "—";

  /* ---------------------------- clean scene ---------------------------- */
  if (!spillDetected) {
    return (
      <main className="lt-page lr-page">
        <ResultHead prediction={prediction} sev={sev} spillDetected={false} regionName={regionName} />
        <section className="lr-section" style={{ borderTop: 0 }}>
          <Reveal>
            <div className="lr-card lr-clean-card">
              <span className="lr-ico">
                <span className="material-symbols-outlined">check_circle</span>
              </span>
              <h2 className="lt-display">No oil spill detected</h2>
              <p>
                The model classified this scene as clean water ({prediction.confidence ?? 0}% confidence). Geolocation, drift hindcast, and AIS vessel attribution were skipped, since there's nothing to trace on a clean scene.
              </p>
              {prediction.files?.jobId && overlayFile && (
                <a className="lr-thumb" href={api.fileUrl(prediction.files.jobId, overlayFile)} target="_blank" rel="noreferrer" title="Open full-resolution scene">
                  <img src={api.fileUrl(prediction.files.jobId, overlayPreviewFile)} alt="SAR scene (no spill detected)" loading="lazy" />
                </a>
              )}
              <div className="lr-actions" style={{ justifyContent: "center" }}>
                <Link to="/" className="lt-btn lt-btn-ink">Back to dashboard</Link>
              </div>
            </div>
          </Reveal>
        </section>
      </main>
    );
  }

  /* ------------------------------ full page ---------------------------- */
  return (
    <main className="lt-page lr-page">
      <ResultHead prediction={prediction} sev={sev} spillDetected regionName={regionName} />

      {/* ============================ METRICS ============================ */}
      <div className="lr-metrics-wrap">
        <div className="lr-metrics" aria-label="Key figures">
          <Metric i={0} tone="is-ink" icon="warning" label="Spill status" value="Confirmed" />
          <Metric
            i={1}
            icon="straighten"
            label={prediction.areaIsCoveragePercent ? "Slick coverage" : "Est. slick area"}
            value={`${prediction.slickAreaKm2 ?? 0}${prediction.areaIsCoveragePercent ? "%" : " km²"}`}
          />
          <Metric i={2} tone="is-sea" icon="model_training" label="AI confidence" value={`${prediction.confidence ?? 0}%`} />
          <Metric
            i={3}
            text
            icon="target"
            label="Attributed target"
            value={candidatesList[0] ? candidatesList[0].name || `MMSI: ${candidatesList[0].mmsi}` : "None"}
          />
          <Metric i={4} text icon="location_on" label="Spill centroid" value={centroidText} />
        </div>
      </div>

      {/* ============================ SECTION NAV ============================ */}
      {avail.length > 1 && (
        <nav className="lr-nav" aria-label="Report sections">
          <div className="lr-nav-in">
            {NAV.filter((n) => avail.includes(n.id)).map((n) => (
              <button
                key={n.id}
                type="button"
                className={active === n.id ? "is-on" : ""}
                onClick={() => document.getElementById(n.id)?.scrollIntoView({ behavior: "smooth", block: "start" })}
              >
                {n.label}
              </button>
            ))}
          </div>
        </nav>
      )}

      {/* ========================= 01 INVESTIGATION ========================= */}
      <section id="investigation" className="lr-section">
        <Reveal>
          <span className="lt-eyebrow">01 · Investigation</span>
        </Reveal>
        <Reveal i={1}>
          <h2 className="lt-h2 lt-display">
            Where it drifted,
            <br />
            <em>who was there.</em>
          </h2>
        </Reveal>
        <Reveal i={2}>
          <p className="lt-lede">
            The detected slick, its reconstructed source track and forward drift, plus every candidate vessel. Pick a vessel to draw its journey on the map.
          </p>
        </Reveal>

        <div className="lr-invest">
          {/* ---------------- MAP ---------------- */}
          <Reveal>
            <div className="lr-map">
              <div className="lr-map-canvas">
                <SpillMap
                  spillCenter={prediction.map?.spillCenter || null}
                  spillPolygon={prediction.map?.spillPolygon || []}
                  driftOrigin={prediction.map?.driftOrigin || null}
                  trajectoryPoints={prediction.map?.trajectoryPoints || []}
                  forwardTrajectoryPoints={prediction.map?.forwardTrajectoryPoints || []}
                  forwardFinalParticle={prediction.map?.forwardFinalParticle || null}
                  vessels={prediction.map?.vessels || []}
                  selectedVessel={selectedCandidate}
                  fallbackCenter={{ lat: regionLat, lon: regionLon }}
                />
              </div>

              <div className="lr-hud">
                <div className="lr-hud-head">
                  <span className="material-symbols-outlined">air</span>
                  Hydrodynamic telemetry
                </div>
                <div className="lr-kv">
                  <span>Surface wind</span>
                  <span>
                    {prediction.weatherWindKts != null ? prediction.weatherWindKts : "—"} kts {prediction.weatherWindDir || ""}
                  </span>
                </div>
                <div className="lr-kv">
                  <span>Current</span>
                  <span>
                    {prediction.currentMs != null ? prediction.currentMs : "—"} m/s {prediction.currentDir || ""}
                  </span>
                </div>
                <div className="lr-kv">
                  <span>Spill origin</span>
                  <span>{prediction.spillOriginTime ? prediction.spillOriginTime.replace(" UTC", "") : "—"}</span>
                </div>
                <div className="lr-kv">
                  <span>Sensor</span>
                  <span>
                    {prediction.sensor || "Sentinel-1"} · {formatUtcDay(prediction.acquiredAt)}
                  </span>
                </div>
              </div>

              <div className="lr-coord">
                <em>CENTER</em>
                <span>{centroidText}</span>
              </div>
            </div>
          </Reveal>

          {/* ---------------- ATTRIBUTION PANEL ---------------- */}
          <Reveal i={1}>
            <aside className="lr-side">
              <div className="lr-side-head">
                <h3 className="lt-display">Top 10 vessel attribution</h3>
                <span className="lr-count">TOP {Math.min(10, candidatesList.length)}</span>
              </div>
              <p className="lr-side-sub">
                {prediction.candidatesEvaluated && prediction.candidatesEvaluated > 10
                  ? `Ranked top 10 of ${prediction.candidatesEvaluated.toLocaleString()} candidate vessels via drift & kinematics`
                  : "Drift & spatiotemporal trajectory match"}
              </p>

              {candidatesList.length === 0 ? (
                <div className="lr-empty">No vessel candidates within attribution range for this scene.</div>
              ) : (
                <div className="lr-vlist">
                  {candidatesList.slice(0, 10).map((c) => {
                    const isSelected = selectedCandidate && selectedCandidate.mmsi === c.mmsi;
                    const tier = tierBadge(c.confidenceTier);
                    const pc = probColor(c.probability ?? 0);
                    const hasTrackMetrics = c.proximityNm != null || c.timeDeltaMin != null;
                    return (
                      <button
                        key={c.mmsi || c.name}
                        type="button"
                        onClick={() => setSelectedCandidate(c)}
                        className={`lr-vessel ${isSelected ? "is-on" : ""}`}
                        style={{ "--rk": rankColor(c.rank) }}
                      >
                        <div className="lr-vrow">
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div className="lr-vname">
                              <span className="lr-rank" style={{ background: rankColor(c.rank), color: c.rank === 3 ? "#0c2340" : "#fff" }}>
                                {c.rank}
                              </span>
                              <strong>{c.name || `MMSI: ${c.mmsi}`}</strong>
                              {c.flag && c.flag !== "UNKNOWN" && <span className="lr-tag">{c.flag}</span>}
                              {tier && <span className={`lr-tag ${tier.cls}`}>{tier.label}</span>}
                            </div>
                            <div className="lr-vmeta">
                              <span>MMSI {c.mmsi}</span>
                              <span>·</span>
                              <span style={{ color: "#0c2340", fontWeight: 600 }}>{c.vesselType || "Vessel"}</span>
                              {c.imo && (
                                <>
                                  <span>·</span>
                                  <span style={{ color: "#0f7f8c" }}>IMO {c.imo}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="lr-vprob">
                            <b style={{ color: pc }}>{c.probability ?? 0}%</b>
                            <span style={{ color: pc }}>{c.label || "Candidate"}</span>
                            {c.overallScore != null && c.overallScore !== c.probability && <small>Match {c.overallScore}%</small>}
                          </div>
                        </div>

                        <div className="lr-bar">
                          <span style={{ width: `${Math.max(6, Math.min(100, c.probability ?? 0))}%`, background: pc }} />
                        </div>

                        <div className="lr-vstats">
                          <div>
                            <span>{c.proximityNm != null ? "Proximity" : c.temporalScore != null ? "Time overlap" : "Score"}</span>
                            <b>
                              {c.proximityNm != null ? `${c.proximityNm} NM` : c.temporalScore != null ? `${c.temporalScore}%` : `${c.overallScore || c.probability || 0}%`}
                            </b>
                          </div>
                          <div>
                            <span>{c.timeDeltaMin != null ? "Time delta" : c.qualityScore != null ? "Data quality" : "Mode"}</span>
                            <b style={{ color: "#c23e18" }}>
                              {c.timeDeltaMin != null ? `${c.timeDeltaMin} min` : c.qualityScore != null ? `${c.qualityScore}%` : c.dataMode || "Presence"}
                            </b>
                          </div>
                          <div>
                            <span>{hasTrackMetrics ? "Trajectory" : "Evidence tier"}</span>
                            <b style={{ color: "#0f7f8c" }}>
                              {hasTrackMetrics ? c.trajectoryMatch : (c.confidenceTier || c.label || "").replace("_SOURCE_VESSEL", "").replace("_VESSEL", "")}
                            </b>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedCandidate && (
                <div className="lr-detail">
                  <div className="lr-detail-head">
                    <span>Selected target</span>
                    <small>{selectedCandidate.imo ? `IMO ${selectedCandidate.imo}` : `MMSI ${selectedCandidate.mmsi}`}</small>
                  </div>

                  <div className="lr-kvgrid is-flush" style={{ gridTemplateColumns: "1fr 1fr" }}>
                    <div className="lr-kv is-mono"><span>MMSI</span><span>{selectedCandidate.mmsi || "—"}</span></div>
                    <div className="lr-kv is-mono"><span>IMO</span><span>{selectedCandidate.imo || "—"}</span></div>
                    <div className="lr-kv is-mono"><span>Callsign</span><span>{selectedCandidate.callsign || "—"}</span></div>
                    <div className="lr-kv"><span>Flag</span><span>{selectedCandidate.flag || "—"}</span></div>
                    <div className="lr-kv"><span>Type</span><span title={selectedCandidate.vesselType}>{selectedCandidate.vesselType || "Unknown"}</span></div>
                    <div className="lr-kv">
                      <span>AIS mode</span>
                      <span style={{ color: "#0f7f8c" }}>
                        {selectedCandidate.dataMode === "PRESENCE_ONLY" ? "AIS presence" : selectedCandidate.dataMode || "AIS fix"}
                      </span>
                    </div>
                    {selectedCandidate.speedKts != null && <div className="lr-kv is-mono"><span>SOG</span><span>{selectedCandidate.speedKts} kts</span></div>}
                    {selectedCandidate.headingDeg != null && <div className="lr-kv is-mono"><span>COG</span><span>{selectedCandidate.headingDeg}°</span></div>}
                    {selectedCandidate.proximityNm != null && <div className="lr-kv is-mono"><span>Proximity</span><span style={{ color: "#c23e18" }}>{selectedCandidate.proximityNm} NM</span></div>}
                    {selectedCandidate.loaBeamM && <div className="lr-kv"><span>LOA × Beam</span><span>{selectedCandidate.loaBeamM}</span></div>}
                    {selectedCandidate.draftM != null && <div className="lr-kv is-mono"><span>Draft</span><span>{selectedCandidate.draftM} m</span></div>}
                    {selectedCandidate.temporalScore != null && <div className="lr-kv is-mono"><span>Time window</span><span>{selectedCandidate.temporalScore}%</span></div>}
                    {selectedCandidate.qualityScore != null && <div className="lr-kv is-mono"><span>Data quality</span><span>{selectedCandidate.qualityScore}%</span></div>}
                    {selectedCandidate.overallScore != null && <div className="lr-kv is-mono"><span>Attribution match</span><span style={{ color: "#0f7f8c" }}>{selectedCandidate.overallScore}%</span></div>}
                  </div>

                  {(selectedCandidate.trackPoints || []).length < 2 && (
                    <div className="lr-note is-warn">No historical AIS track available for this vessel: the map shows the last known position only, no path.</div>
                  )}
                  {(selectedCandidate.transmissionFrom || selectedCandidate.transmissionTo) && (
                    <div className="lr-kv is-mono" style={{ marginTop: 6 }}>
                      <span>AIS window</span>
                      <span>
                        {selectedCandidate.transmissionFrom ? selectedCandidate.transmissionFrom.slice(0, 10) : "Start"} →{" "}
                        {selectedCandidate.transmissionTo ? selectedCandidate.transmissionTo.slice(0, 10) : "End"}
                      </span>
                    </div>
                  )}

                  <div className="lr-note">
                    <b>
                      Kinematic drift synthesis
                      {selectedCandidate.confidenceTier ? ` · ${selectedCandidate.confidenceTier.replace("_SOURCE_VESSEL", "").replace("_VESSEL", "")}` : ""}
                    </b>
                    <div style={{ marginTop: 6 }}>
                      {selectedCandidate.explanation ? (
                        selectedCandidate.explanation
                      ) : selectedCandidate.timeDeltaMin != null ? (
                        <>
                          Vessel crossed the spill zone <b>{Math.abs(selectedCandidate.timeDeltaMin)} min prior</b> to SAR radar capture; downwind plume dispersion aligns with discharge wake geometry.
                        </>
                      ) : (
                        `AIS transmissions for ${selectedCandidate.name} were identified inside the regional observation window with ${selectedCandidate.overallScore || selectedCandidate.probability}% spatiotemporal alignment.`
                      )}
                    </div>
                    <div className="lr-fine" style={{ marginTop: 8 }}>
                      {prediction.disclaimer || "Notice: probabilistic score for maritime inspection prioritising, not judicial confirmation."}
                    </div>
                  </div>
                </div>
              )}
            </aside>
          </Reveal>
        </div>
      </section>

      {/* ====================== 02+ FULL ANALYSIS REPORT ====================== */}
      <AnalysisReport prediction={prediction} selectedCandidate={selectedCandidate} onSelectVessel={selectVesselByMmsi} />

      <p className="lr-foot">
        Vessel attribution is probabilistic and does not establish causation. Rankings show relative likelihood among evaluated candidates and are not calibrated probabilities.
      </p>
    </main>
  );
}

function Reveal({ children, i = 0 }) {
  return (
    <motion.div variants={rise} custom={i} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.12 }}>
      {children}
    </motion.div>
  );
}