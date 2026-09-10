import { useEffect, useState, useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../api.js";
import SpillMap from "../components/SpillMap.jsx";
import AnalysisReport from "../components/AnalysisReport.jsx";

function severityBadge(severity) {
  if (severity === "critical")
    return { label: "Critical Slick Confirmed", cls: "bg-rose-50 text-rose-700 border-rose-200", dot: "bg-rose-500" };
  if (severity === "advisory")
    return { label: "Advisory Slick Detected", cls: "bg-amber-50 text-amber-700 border-amber-200", dot: "bg-amber-500" };
  return { label: "Clean Scene", cls: "bg-emerald-50 text-emerald-700 border-emerald-200", dot: "bg-emerald-500" };
}

function probLabelStyle(probability) {
  if (probability >= 75) return { text: "text-primary", bg: "bg-primary" };
  if (probability >= 45) return { text: "text-amber-700", bg: "bg-amber-500" };
  if (probability >= 20) return { text: "text-slate-600", bg: "bg-slate-400" };
  return { text: "text-slate-500", bg: "bg-slate-300" };
}

function tierBadge(tier) {
  if (!tier) return null;
  if (tier.includes("PROBABLE")) {
    return { label: "Probable Source", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" };
  }
  if (tier.includes("CANDIDATE")) {
    return { label: "Candidate", cls: "bg-sky-50 text-sky-700 border-sky-200" };
  }
  return { label: "Low Confidence", cls: "bg-slate-50 text-slate-600 border-slate-200" };
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

export default function PredictionResults() {
  const { id } = useParams();
  const [prediction, setPrediction] = useState(null);
  const [error, setError] = useState(null);
  const [panelOpen, setPanelOpen] = useState(true);
  const [selectedCandidate, setSelectedCandidate] = useState(null);

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

  if (error) {
    return (
      <main className="pt-24 max-w-2xl mx-auto text-center">
        <p className="text-rose-600 font-mono text-sm">{error}</p>
        <Link to="/" className="text-primary text-sm font-semibold mt-3 inline-block">
          Back to Dashboard
        </Link>
      </main>
    );
  }
  if (!prediction) {
    return (
      <main className="pt-24 max-w-2xl mx-auto text-center text-slate-subtle font-mono text-sm">
        Loading prediction…
      </main>
    );
  }

  const sev = severityBadge(prediction.severity);
  const spillDetected = prediction.detection === "detected";
  const candidatesList = Array.isArray(prediction.candidates) ? prediction.candidates : [];
  const regionName = prediction.region?.name || "Unknown Region";
  const regionLat = prediction.region?.lat ?? 0;
  const regionLon = prediction.region?.lon ?? 0;

  if (!spillDetected) {
    return (
      <div className="pt-16 min-h-screen bg-slate-50/70 flex flex-col">
        <section className="border-b border-border-soft bg-white px-8 py-4 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-slate-900 tracking-tight">Prediction Results</h1>
              <span
                className={`px-2.5 py-0.5 rounded-full border font-mono text-xs font-semibold flex items-center gap-1.5 ${sev.cls}`}
              >
                <span className={`inline-block w-1.5 h-1.5 rounded-full ${sev.dot}`}></span>
                {sev.label}
              </span>
            </div>
            <p className="text-xs text-slate-500 mt-1">
              {prediction.sensor || "Sentinel-1"} SAR oil spill detection
            </p>
          </div>
          <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm text-xs font-mono">
            <span className="text-slate-400 font-semibold">RUN ID</span>
            <span className="text-primary font-bold">#{prediction.id}</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-400 font-semibold">CONFIDENCE</span>
            <span className="text-teal-600 font-semibold">{prediction.confidence ?? 0}%</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-500">
              {formatUtcDate(prediction.acquiredAt)}
            </span>
          </div>
        </section>

        <main className="flex-1 flex items-center justify-center p-6">
          <div className="w-full max-w-sm bg-white rounded-2xl border border-border-soft shadow-sm p-8 text-center">
            <div className="mx-auto w-14 h-14 rounded-full bg-emerald-50 border border-emerald-200 flex items-center justify-center mb-4">
              <span className="material-symbols-outlined text-emerald-600 text-3xl">check_circle</span>
            </div>
            <h2 className="text-base font-bold text-slate-900">No Oil Spill Detected</h2>
            <p className="text-xs text-slate-500 mt-2 leading-relaxed">
              The model classified this scene as clean water ({prediction.confidence ?? 0}% confidence).
              Geolocation, drift hindcast, and AIS vessel attribution were skipped - there's nothing
              to trace on a clean scene.
            </p>

            {prediction.files?.jobId && (prediction.files?.overlayThumbnail || prediction.files?.overlay) && (
              <a
                href={api.fileUrl(prediction.files.jobId, prediction.files.overlay)}
                target="_blank"
                rel="noreferrer"
                className="mt-5 block rounded-xl overflow-hidden border border-slate-200 bg-slate-50"
                title="Open full-resolution scene"
              >
                <img
                  src={api.fileUrl(
                    prediction.files.jobId,
                    prediction.files.overlayThumbnail || prediction.files.overlay
                  )}
                  alt="SAR scene (no spill detected)"
                  loading="lazy"
                  className="w-full max-h-48 object-cover"
                />
              </a>
            )}

            <Link
              to="/"
              className="mt-6 inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-primary hover:bg-primary-hover text-white text-xs font-mono font-semibold transition-colors"
            >
              Back to Dashboard
            </Link>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="pt-16 flex flex-col min-h-screen bg-slate-50/70">
      {/* SUB-HEADER */}
      <section className="border-b border-border-soft bg-white px-8 py-4 flex flex-wrap items-center justify-between gap-4 z-30">
        <div>
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-slate-900 tracking-tight">
              Prediction Results: {regionName}
            </h1>
            <span
              className={`px-2.5 py-0.5 rounded-full border font-mono text-xs font-semibold flex items-center gap-1.5 ${sev.cls}`}
            >
              <span className={`inline-block w-1.5 h-1.5 rounded-full ${sev.dot} animate-ping`}></span>
              {sev.label}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1">
            {prediction.sensor || "Sentinel-1"} SAR oil spill detection &amp; AIS trajectory attribution analysis
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2.5 bg-slate-50 border border-slate-200 rounded-lg px-3 py-1.5 shadow-sm text-xs font-mono">
            <span className="text-slate-400 font-semibold">RUN ID</span>
            <span className="text-primary font-bold">#{prediction.id}</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-400 font-semibold">CONFIDENCE</span>
            <span className="text-teal-600 font-semibold">{prediction.confidence ?? 0}%</span>
            <span className="text-slate-300">|</span>
            <span className="text-slate-500">
              {formatUtcDate(prediction.acquiredAt)}
            </span>
          </div>
        </div>
      </section>

      {/* WORKSPACE: MAP + ATTRIBUTION PANEL */}
      <div className="relative flex-1 flex flex-col xl:flex-row min-h-[calc(100vh-17rem)] overflow-hidden p-6 gap-6">
        {/* MAP CANVAS */}
        <div className="relative w-full xl:flex-1 bg-white rounded-2xl border border-border-soft shadow-sm overflow-hidden h-[80vh] min-h-[300px] xl:min-h-0">
          {!panelOpen && (
            <button
              onClick={() => setPanelOpen(true)}
              className="absolute top-5 right-5 z-30 flex items-center gap-2 px-3.5 py-2 bg-white/95 hover:bg-white border border-sky-200 text-slate-800 text-xs font-semibold rounded-xl shadow-lg backdrop-blur-md transition-all hover:border-primary"
            >
              <span className="material-symbols-outlined text-primary text-base">dock_to_right</span>
              Vessel Attribution
              <span className="px-1.5 py-0.5 rounded bg-sky-100 text-primary font-mono text-[10px] font-bold">
                {Math.min(10, candidatesList.length)}
              </span>
            </button>
          )}

          <div className="absolute inset-0 z-0">
            <SpillMap
              spillCenter={prediction.map?.spillCenter || null}
              spillPolygon={prediction.map?.spillPolygon || []}
              driftOrigin={prediction.map?.driftOrigin || null}
              trajectoryPoints={prediction.map?.trajectoryPoints || []}
              vessels={prediction.map?.vessels || []}
              selectedVessel={selectedCandidate}
              fallbackCenter={{ lat: regionLat, lon: regionLon }}
            />
          </div>

          {/* HUD panel */}
          <div className="absolute top-5 left-5 z-20 w-56 sm:w-64 backdrop-blur-md border border-slate-200/80 rounded-xl shadow-lg p-2.5 bg-white/80">
            <div className="flex items-center justify-between pb-1.5 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <span className="material-symbols-outlined text-primary text-sm">air</span>
                <span className="text-[11px] font-bold text-slate-900">Hydrodynamic Telemetry</span>
              </div>
              <span className="px-1.5 py-0.5 rounded-md bg-teal-50 text-teal-700 font-mono text-[9px] font-semibold border border-teal-100">
                BUOY MET-09
              </span>
            </div>
            <div className="mt-1 divide-y divide-slate-100">
              <div className="flex items-center justify-between gap-3 py-1">
                <div className="flex items-center gap-1.5 text-slate-500 min-w-0">
                  <span className="material-symbols-outlined text-xs text-slate-400">cyclone</span>
                  <span className="font-mono text-[10px] font-medium uppercase truncate">Surface Wind</span>
                </div>
                <div className="font-mono text-sm text-slate-900 font-bold whitespace-nowrap">
                  {prediction.weatherWindKts != null ? prediction.weatherWindKts : "—"}{" "}
                  <span className="text-xs font-normal text-slate-500">kts</span>
                  <span className="text-[10px] font-normal text-slate-500 ml-1">{prediction.weatherWindDir || "—"}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 py-1">
                <div className="flex items-center gap-1.5 text-slate-500 min-w-0">
                  <span className="material-symbols-outlined text-xs text-teal-500">waves</span>
                  <span className="font-mono text-[10px] font-medium uppercase truncate">Current</span>
                </div>
                <div className="font-mono text-sm text-teal-700 font-bold whitespace-nowrap">
                  {prediction.currentMs != null ? prediction.currentMs : "—"}{" "}
                  <span className="text-xs font-normal text-slate-500">m/s</span>
                  <span className="text-[10px] font-normal text-slate-500 ml-1">{prediction.currentDir || "—"}</span>
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 py-1">
                <div className="flex items-center gap-1.5 text-slate-500 min-w-0">
                  <span className="material-symbols-outlined text-xs text-slate-400">event</span>
                  <span className="font-mono text-[10px] font-medium uppercase truncate">Spill Origin</span>
                </div>
                <div className="font-mono text-[10px] text-slate-800 font-semibold whitespace-nowrap">
                  {prediction.spillOriginTime ? prediction.spillOriginTime.replace(" UTC", "") : "—"}
                </div>
              </div>
              <div className="flex items-center justify-between gap-3 py-1">
                <div className="flex items-center gap-1.5 text-slate-500 min-w-0">
                  <span className="material-symbols-outlined text-xs text-primary">satellite_alt</span>
                  <span className="font-mono text-[10px] font-medium uppercase truncate">Sensor</span>
                </div>
                <div className="text-right min-w-0">
                  <div className="font-mono text-[10px] text-primary font-semibold truncate">{prediction.sensor || "Sentinel-1"}</div>
                  <div className="font-mono text-[10px] text-slate-500">
                    {formatUtcDay(prediction.acquiredAt)}
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Detection overlay thumbnail (real pipeline runs only) */}
          {prediction.files?.jobId && prediction.files?.overlay && (
            <a
              href={api.fileUrl(prediction.files.jobId, prediction.files.overlay)}
              target="_blank"
              rel="noreferrer"
              className="absolute bottom-5 left-5 z-20 group"
              title="Open full-resolution detection overlay"
            >
              <div className="w-28 h-28 rounded-xl overflow-hidden border-2 border-white shadow-lg bg-slate-100">
                <img
                  src={api.fileUrl(
                    prediction.files.jobId,
                    prediction.files.overlayThumbnail || prediction.files.overlay
                  )}
                  alt="Detection overlay"
                  loading="lazy"
                  className="w-full h-full object-cover group-hover:scale-105 transition-transform"
                />
              </div>
              <div className="mt-1 px-2 py-0.5 rounded-md bg-white/95 border border-slate-200 text-[10px] font-mono text-slate-600 shadow-sm inline-block">
                Overlay ↗
              </div>
            </a>
          )}

          {/* Coordinate pill */}
          <div className="absolute bottom-5 right-5 z-20 px-3 py-1.5 rounded-lg bg-white/95 border border-slate-200/80 shadow-md backdrop-blur-md hidden sm:flex items-center gap-3 text-xs font-mono">
            <span className="text-slate-400">CENTER</span>
            <span className="text-slate-800 font-medium">
              {prediction.map?.spillCenter
                ? `${prediction.map.spillCenter.lat.toFixed(4)}° N, ${prediction.map.spillCenter.lon.toFixed(4)}° E`
                : `${regionLat.toFixed(4)}° N, ${regionLon.toFixed(4)}° E`}
            </span>
            <span className="text-slate-200">|</span>
            <span className="text-slate-500">OpenStreetMap</span>
          </div>
        </div>

        {/* ATTRIBUTION PANEL */}
        {panelOpen && (
          <aside className="w-full xl:w-[440px] bg-white rounded-2xl border border-border-soft shadow-sm flex flex-col justify-between shrink-0 h-[80vh] min-h-[300px] p-5 overflow-hidden">
            <div className="flex-1 min-h-0 overflow-y-auto pr-1">
              <div className="pb-4 border-b border-slate-100 flex items-center justify-between sticky top-0 bg-white z-10">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="material-symbols-outlined text-primary text-xl">stacked_bar_chart</span>
                    <h3 className="text-base font-bold text-slate-900 tracking-tight">Top 10 Vessel Attribution</h3>
                  </div>
                  <p className="text-xs text-slate-500 mt-0.5">
                    {prediction.candidatesEvaluated && prediction.candidatesEvaluated > 10
                      ? `Ranked top 10 of ${prediction.candidatesEvaluated.toLocaleString()} candidate vessels via drift & kinematics`
                      : "Bayesian drift & spatiotemporal trajectory match"}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="px-2.5 py-1 rounded-full bg-slate-100 text-slate-600 font-mono text-xs font-semibold">
                    TOP {Math.min(10, candidatesList.length)}
                  </span>
                  <button
                    onClick={() => setPanelOpen(false)}
                    className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition-colors flex items-center justify-center shrink-0"
                    title="Collapse attribution panel"
                  >
                    <span className="material-symbols-outlined text-lg">chevron_right</span>
                  </button>
                </div>
              </div>

              {candidatesList.length === 0 ? (
                <div className="mt-6 text-center text-sm text-slate-500 py-10">
                  No vessel candidates within attribution range for this scene.
                </div>
              ) : (
                <div className="mt-4 flex flex-col gap-3">
                  {candidatesList.slice(0, 10).map((c) => {
                    const isTop = c.rank === 1;
                    const style = probLabelStyle(c.probability ?? 0);
                    const tier = tierBadge(c.confidenceTier);
                    const isSelected = selectedCandidate && selectedCandidate.mmsi === c.mmsi;
                    const hasTrackMetrics = c.proximityNm != null || c.timeDeltaMin != null;

                    return (
                      <button
                        key={c.mmsi || c.name}
                        onClick={() => setSelectedCandidate(c)}
                        className={`text-left p-3.5 rounded-xl border transition-all ${
                          isTop
                            ? "bg-sky-50/60 border-2 border-sky-300 shadow-xs"
                            : isSelected
                            ? "bg-slate-50 border-slate-300 ring-2 ring-primary/20"
                            : "bg-slate-50/50 hover:bg-slate-50 border-slate-100"
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-1.5 flex-wrap">
                              <span
                                className={`rounded-full text-white font-mono flex items-center justify-center font-bold shadow-xs shrink-0 ${
                                  isTop ? "w-6 h-6 bg-primary text-xs" : "w-5 h-5 bg-slate-200 !text-slate-700 text-xs"
                                }`}
                              >
                                {c.rank}
                              </span>
                              <span className={`font-bold text-slate-900 truncate ${isTop ? "text-sm" : "text-xs"}`}>
                                {c.name || `MMSI: ${c.mmsi}`}
                              </span>
                              {c.flag && c.flag !== "UNKNOWN" && (
                                <span className="px-1.5 py-0.2 rounded bg-sky-100 text-primary font-mono text-[10px] font-bold">
                                  {c.flag}
                                </span>
                              )}
                              {tier && (
                                <span className={`px-1.5 py-0.2 rounded border font-mono text-[9px] font-bold ${tier.cls}`}>
                                  {tier.label}
                                </span>
                              )}
                            </div>
                            <div className="font-mono text-[11px] text-slate-500 mt-1 flex items-center gap-1.5 flex-wrap">
                              <span>MMSI: {c.mmsi}</span>
                              <span>•</span>
                              <span className="text-slate-700 font-medium">{c.vesselType || "Vessel"}</span>
                              {c.imo && (
                                <>
                                  <span>•</span>
                                  <span className="text-teal-700">IMO {c.imo}</span>
                                </>
                              )}
                            </div>
                          </div>
                          <div className="text-right shrink-0">
                            <div className={`font-mono font-bold ${isTop ? "text-xl" : "text-sm"} ${style.text}`}>
                              {c.probability ?? 0}%
                            </div>
                            <div className={`font-mono text-[10px] uppercase font-semibold ${style.text}`}>
                              {c.label || "Candidate"}
                            </div>
                            {c.overallScore != null && c.overallScore !== c.probability && (
                              <div className="font-mono text-[9px] text-slate-400">
                                Match {c.overallScore}%
                              </div>
                            )}
                          </div>
                        </div>

                        {/* Progress Bar */}
                        <div className={`w-full bg-slate-200 rounded-full mt-2.5 overflow-hidden ${isTop ? "h-2" : "h-1.5"}`}>
                          <div
                            className={`h-full rounded-full transition-all ${style.bg}`}
                            style={{ width: `${Math.max(6, Math.min(100, c.probability ?? 0))}%` }}
                          />
                        </div>

                        {/* Telemetry Stat Cards */}
                        <div className="grid grid-cols-3 gap-2 mt-2.5 pt-2 border-t border-slate-100 text-center">
                          <div>
                            <div className="font-mono text-[10px] text-slate-400 font-medium">
                              {c.proximityNm != null ? "PROXIMITY" : c.temporalScore != null ? "TIME OVERLAP" : "SCORE"}
                            </div>
                            <div className="font-mono text-xs text-slate-800 font-semibold mt-0.5 truncate">
                              {c.proximityNm != null
                                ? `${c.proximityNm} NM`
                                : c.temporalScore != null
                                ? `${c.temporalScore}%`
                                : `${c.overallScore || c.probability || 0}%`}
                            </div>
                          </div>
                          <div>
                            <div className="font-mono text-[10px] text-slate-400 font-medium">
                              {c.timeDeltaMin != null ? "TIME DELTA" : c.qualityScore != null ? "DATA QUALITY" : "MODE"}
                            </div>
                            <div className="font-mono text-xs text-rose-600 font-semibold mt-0.5 truncate">
                              {c.timeDeltaMin != null
                                ? `${c.timeDeltaMin} min`
                                : c.qualityScore != null
                                ? `${c.qualityScore}%`
                                : c.dataMode || "Presence"}
                            </div>
                          </div>
                          <div>
                            <div className="font-mono text-[10px] text-slate-400 font-medium">
                              {hasTrackMetrics ? "TRAJECTORY" : "EVIDENCE TIER"}
                            </div>
                            <div className="font-mono text-xs text-teal-700 font-semibold mt-0.5 truncate">
                              {hasTrackMetrics
                                ? c.trajectoryMatch
                                : (c.confidenceTier || c.label || "").replace("_SOURCE_VESSEL", "").replace("_VESSEL", "")}
                            </div>
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedCandidate && (
                <div className="mt-5 pt-4 border-t border-slate-100">
                  <div className="flex items-center justify-between mb-2.5">
                    <span className="text-xs font-bold text-slate-900 flex items-center gap-1.5">
                      <span className="material-symbols-outlined text-sm text-primary">manage_search</span>
                      Selected Target Telemetry &amp; Specs
                    </span>
                    <span className="font-mono text-xs text-teal-700 font-semibold">
                      {selectedCandidate.imo ? `IMO: ${selectedCandidate.imo}` : `MMSI: ${selectedCandidate.mmsi}`}
                    </span>
                  </div>

                  <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 grid grid-cols-2 gap-y-2 gap-x-4 text-xs font-mono">
                    <div className="flex justify-between">
                      <span className="text-slate-400">MMSI:</span>
                      <span className="text-slate-800 font-semibold">{selectedCandidate.mmsi || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">IMO:</span>
                      <span className="text-slate-800 font-semibold">{selectedCandidate.imo || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Callsign:</span>
                      <span className="text-slate-800 font-semibold">{selectedCandidate.callsign || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Flag / Reg:</span>
                      <span className="text-slate-800 font-semibold">{selectedCandidate.flag || "—"}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">Vessel Type:</span>
                      <span className="text-slate-800 font-semibold truncate max-w-[110px]" title={selectedCandidate.vesselType}>
                        {selectedCandidate.vesselType || "Unknown"}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-400">AIS Mode:</span>
                      <span className="text-primary font-semibold truncate max-w-[110px]" title={selectedCandidate.dataMode}>
                        {selectedCandidate.dataMode === "PRESENCE_ONLY" ? "AIS Presence" : selectedCandidate.dataMode || "AIS Fix"}
                      </span>
                    </div>

                    {selectedCandidate.speedKts != null && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">SOG (Speed):</span>
                        <span className="text-primary font-semibold">{selectedCandidate.speedKts} kts</span>
                      </div>
                    )}
                    {selectedCandidate.headingDeg != null && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">COG (Heading):</span>
                        <span className="text-slate-800 font-semibold">{selectedCandidate.headingDeg}°</span>
                      </div>
                    )}
                    {selectedCandidate.proximityNm != null && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Proximity:</span>
                        <span className="text-rose-600 font-semibold">{selectedCandidate.proximityNm} NM</span>
                      </div>
                    )}
                    {selectedCandidate.loaBeamM && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">LOA x Beam:</span>
                        <span className="text-slate-800 font-semibold">{selectedCandidate.loaBeamM}</span>
                      </div>
                    )}
                    {selectedCandidate.draftM != null && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Draft:</span>
                        <span className="text-slate-800 font-semibold">{selectedCandidate.draftM} m</span>
                      </div>
                    )}
                    {selectedCandidate.temporalScore != null && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Time Window:</span>
                        <span className="text-teal-700 font-semibold">{selectedCandidate.temporalScore}% match</span>
                      </div>
                    )}
                    {selectedCandidate.qualityScore != null && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Data Quality:</span>
                        <span className="text-slate-800 font-semibold">{selectedCandidate.qualityScore}% score</span>
                      </div>
                    )}
                    {selectedCandidate.overallScore != null && (
                      <div className="flex justify-between">
                        <span className="text-slate-400">Attribution Match:</span>
                        <span className="text-primary font-semibold">{selectedCandidate.overallScore}%</span>
                      </div>
                    )}
                    {(selectedCandidate.trackPoints || []).length < 2 && (
                      <div className="col-span-2 pt-1 border-t border-slate-100 text-[11px] text-amber-700">
                        No historical AIS track available for this vessel — map shows last known position only, no path.
                      </div>
                    )}
                    {(selectedCandidate.transmissionFrom || selectedCandidate.transmissionTo) && (
                      <div className="col-span-2 pt-1 border-t border-slate-100 flex justify-between text-[11px]">
                        <span className="text-slate-400">AIS Window:</span>
                        <span className="text-slate-700 font-medium">
                          {selectedCandidate.transmissionFrom ? selectedCandidate.transmissionFrom.slice(0, 10) : "Start"} → {selectedCandidate.transmissionTo ? selectedCandidate.transmissionTo.slice(0, 10) : "End"}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="mt-3 p-3 rounded-xl bg-sky-50/40 border border-sky-100 text-xs text-slate-600 leading-relaxed">
                    <div className="flex items-center justify-between mb-1">
                      <p className="font-semibold text-slate-900 flex items-center gap-1.5 text-primary">
                        <span className="material-symbols-outlined text-sm">psychology</span>
                        Kinematic Drift Synthesis
                      </p>
                      {selectedCandidate.confidenceTier && (
                        <span className="px-1.5 py-0.5 rounded bg-sky-100 text-sky-800 font-mono text-[10px] font-bold">
                          {selectedCandidate.confidenceTier.replace("_SOURCE_VESSEL", "").replace("_VESSEL", "")}
                        </span>
                      )}
                    </div>
                    <p className="mt-1">
                      {selectedCandidate.explanation ? (
                        selectedCandidate.explanation
                      ) : selectedCandidate.timeDeltaMin != null ? (
                        <>
                          Vessel crossed spill zone{" "}
                          <span className="text-primary font-semibold">
                            {Math.abs(selectedCandidate.timeDeltaMin)} min prior
                          </span>{" "}
                          to SAR radar capture; downwind plume dispersion aligns with discharge wake geometry.
                        </>
                      ) : (
                        `AIS transmissions for ${selectedCandidate.name} were identified inside the regional observation window with ${selectedCandidate.overallScore || selectedCandidate.probability}% spatiotemporal alignment.`
                      )}
                    </p>
                    <p className="mt-1.5 text-slate-400 text-[10px] leading-normal">
                      {prediction.disclaimer ||
                        "Notice: Probabilistic score for maritime inspection prioritizing, not judicial confirmation."}
                    </p>
                  </div>
                </div>
              )}
            </div>
          </aside>
        )}
      </div>

      {/* FULL ANALYSIS REPORT */}
      <div className="px-6 pb-6">
        <AnalysisReport
          prediction={prediction}
          selectedCandidate={selectedCandidate}
          onSelectVessel={(v) => {
            const full = candidatesList.find((c) => c.mmsi && c.mmsi === v.mmsi);
            setSelectedCandidate(full || selectedCandidate);
          }}
        />
      </div>

      {/* FOOTER METRICS DOCK */}
      <footer className="border-t border-border-soft bg-white px-8 py-3.5 z-30">
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4 items-center">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div
              className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 border ${
                spillDetected ? "bg-rose-50 text-rose-600 border-rose-100" : "bg-emerald-50 text-emerald-600 border-emerald-100"
              }`}
            >
              <span className="material-symbols-outlined text-xl">{spillDetected ? "warning" : "check_circle"}</span>
            </div>
            <div>
              <div className="font-mono text-[10px] text-slate-400 uppercase font-semibold">Spill Status</div>
              <div className={`text-sm font-bold ${spillDetected ? "text-rose-700" : "text-emerald-700"}`}>
                {spillDetected ? "Confirmed" : "Clean"}
              </div>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-sky-50 text-primary flex items-center justify-center shrink-0 border border-sky-100">
              <span className="material-symbols-outlined text-xl">straighten</span>
            </div>
            <div>
              <div className="font-mono text-[10px] text-slate-400 uppercase font-semibold">
                {prediction.areaIsCoveragePercent ? "Slick Coverage" : "Est. Slick Area"}
              </div>
              <div className="font-mono text-sm font-bold text-slate-900">
                {prediction.slickAreaKm2 ?? 0}
                {prediction.areaIsCoveragePercent ? "%" : " km²"}
              </div>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center shrink-0 border border-teal-100">
              <span className="material-symbols-outlined text-xl">model_training</span>
            </div>
            <div>
              <div className="font-mono text-[10px] text-slate-400 uppercase font-semibold">AI Confidence</div>
              <div className="font-mono text-sm font-bold text-teal-700">{prediction.confidence ?? 0}%</div>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-sky-50/70 border border-sky-200 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-white text-primary flex items-center justify-center shrink-0 shadow-xs border border-sky-100">
              <span className="material-symbols-outlined text-xl">target</span>
            </div>
            <div>
              <div className="font-mono text-[10px] text-primary uppercase font-bold">Attributed Target</div>
              <div className="text-xs font-bold text-slate-900 truncate max-w-[130px]">
                {candidatesList[0] ? (candidatesList[0].name || `MMSI: ${candidatesList[0].mmsi}`) : "None"}
              </div>
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100 flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg bg-slate-100 text-slate-600 flex items-center justify-center shrink-0">
              <span className="material-symbols-outlined text-xl">location_on</span>
            </div>
            <div>
              <div className="font-mono text-[10px] text-slate-400 uppercase font-semibold">Spill Centroid</div>
              <div className="font-mono text-xs font-semibold text-slate-800">
                {prediction.map?.spillCenter?.lat != null
                  ? `${prediction.map.spillCenter.lat.toFixed(4)}°N, ${prediction.map.spillCenter.lon.toFixed(4)}°E`
                  : `${regionLat.toFixed(4)}°N, ${regionLon.toFixed(4)}°E`}
              </div>
            </div>
          </div>
        </div>
      </footer>
    </div>
  );
}