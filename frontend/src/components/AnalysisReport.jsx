import { useState } from "react";
import { api } from "../api.js";
import { motion } from "framer-motion";
import VesselProximityPanel from "./VesselProximityPanel.jsx";
import {
  BarChart,
  LineChart,
  RadarChart,
  VesselProximityToOriginChart,
  VesselKinematicsChart,
} from "./Charts.jsx";

/* ------------------------------------------------------------------ */
/* Shared building blocks with rich dark-theme cyber-maritime aesthetics */
/* ------------------------------------------------------------------ */

function SectionCard({
  icon,
  iconTone = "text-cyan-400 bg-cyan-950/50 border-cyan-400/20",
  title,
  subtitle,
  pill,
  children,
  className = "",
}) {
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, amount: 0.08 }}
      transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
      whileHover={{ y: -2 }}
      className={`bg-slate-900/90 rounded-2xl border border-cyan-400/15 shadow-[0_14px_40px_-24px_rgba(0,0,0,0.9)] p-5 transition-shadow duration-300 hover:border-cyan-400/35 hover:shadow-[0_18px_50px_-28px_rgba(8,145,178,0.65)] flex flex-col justify-between ${className}`}
    >
      <div>
        <div className="flex items-start justify-between gap-3 pb-4 border-b border-white/10">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${iconTone}`}>
              <span className="material-symbols-outlined text-lg">{icon}</span>
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-bold text-white tracking-tight truncate">{title}</h3>
              {subtitle && <p className="text-[11px] text-slate-400 mt-0.5 truncate">{subtitle}</p>}
            </div>
          </div>
          {pill}
        </div>
        <div className="pt-4 text-slate-300">{children}</div>
      </div>
    </motion.section>
  );
}

function RadialDial({ value, label }) {
  const safeValue = Math.max(0, Math.min(100, Number(value) || 0));
  return (
    <div
      className="relative w-32 h-32 rounded-full p-[7px] shrink-0 shadow-[0_0_34px_rgba(34,211,238,0.18)]"
      style={{ background: `conic-gradient(#22d3ee ${safeValue}%, rgba(148,163,184,0.16) ${safeValue}% 100%)` }}
    >
      <div className="relative w-full h-full rounded-full bg-[#0a1724] border border-cyan-300/20 flex flex-col items-center justify-center overflow-hidden">
        <div className="absolute inset-x-0 top-0 h-1/2 bg-gradient-to-b from-cyan-300/10 to-transparent" />
        <span className="relative text-2xl font-bold font-display text-white tracking-tight">{safeValue}%</span>
        <span className="relative text-[9px] font-mono uppercase tracking-[0.16em] text-cyan-200/70">{label}</span>
      </div>
    </div>
  );
}

function ReportHero({ prediction, detection, drift, geometry }) {
  const detected = prediction.detection === "detected";
  const confidence = detection.confidencePercent ?? prediction.confidence ?? 0;
  const coverage = detection.spillCoveragePercent != null ? `${detection.spillCoveragePercent}%` : "—";
  const origin =
    drift.originLatitude != null
      ? `${drift.originLatitude.toFixed(3)}°, ${drift.originLongitude.toFixed(3)}°`
      : "Awaiting origin";

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.985 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
      className="relative overflow-hidden rounded-3xl bg-slate-900 border border-cyan-300/20 p-5 md:p-7 text-white shadow-[0_24px_70px_-32px_rgba(8,145,178,0.8)]"
    >
      <div className="pointer-events-none absolute inset-0 opacity-60 bg-[radial-gradient(circle_at_78%_20%,rgba(34,211,238,0.22),transparent_32%),linear-gradient(115deg,transparent_30%,rgba(45,212,191,0.08),transparent_70%)]" />
      <div className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full border border-cyan-300/10 animate-[spin_24s_linear_infinite]" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent" />
      <div className="relative flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-cyan-200 font-mono text-[10px] font-bold tracking-[0.2em] uppercase">
            <span className="w-2 h-2 rounded-full bg-cyan-300 shadow-[0_0_12px_#67e8f9] animate-pulse" />
            Mission analysis // {prediction.id}
          </div>
          <h2 className="mt-3 text-2xl md:text-3xl font-bold font-display tracking-tight text-white">Full Analysis Report</h2>
          <p className="mt-2 max-w-xl text-xs md:text-sm leading-relaxed text-slate-300">
            Complete satellite detection, environmental context, drift reconstruction, and vessel attribution record.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            <span
              className={`px-2.5 py-1 rounded-full border font-mono text-[10px] font-bold ${
                detected
                  ? "bg-rose-500/15 border-rose-400/40 text-rose-200"
                  : "bg-emerald-500/15 border-emerald-400/40 text-emerald-200"
              }`}
            >
              {detected ? "OIL SPILL DETECTED" : "SCENE CLEAR"}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-cyan-200 font-mono text-[10px] font-bold">
              {prediction.sensor || "SENTINEL-1"}
            </span>
            <span className="px-2.5 py-1 rounded-full bg-white/5 border border-white/10 text-slate-300 font-mono text-[10px] font-bold">
              {prediction.severity || "UNCLASSIFIED"}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-5 md:pr-2">
          <RadialDial value={confidence} label="confidence" />
          <div className="grid gap-3 min-w-[138px]">
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400">Scene coverage</div>
              <div className="mt-0.5 text-sm font-bold text-cyan-200">{coverage}</div>
            </div>
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400">Slick area</div>
              <div className="mt-0.5 text-sm font-bold text-cyan-200">
                {geometry?.areaKm2 != null ? `${geometry.areaKm2.toFixed(2)} km²` : "—"}
              </div>
            </div>
            <div>
              <div className="text-[9px] font-mono uppercase tracking-wider text-slate-400">Origin</div>
              <div className="mt-0.5 text-xs font-semibold text-cyan-200 truncate" title={origin}>
                {origin}
              </div>
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function Stat({ value, label, tone = "text-white", small }) {
  return (
    <div className="px-3 py-2.5 rounded-xl bg-white/[0.04] border border-white/10 text-center transition-colors hover:bg-cyan-400/[0.08] hover:border-cyan-300/25">
      <div className={`font-mono ${small ? "text-xs" : "text-base"} font-bold leading-tight ${tone}`}>
        {value == null || value === "" ? "—" : value}
      </div>
      <div className="text-[9.5px] text-slate-400 uppercase font-semibold mt-1 tracking-wide">{label}</div>
    </div>
  );
}

function InfoRow({ label, value, mono = true }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-white/10 last:border-0">
      <span className="text-[11px] text-slate-400 font-medium">{label}</span>
      <span className={`text-xs text-slate-100 font-semibold text-right ${mono ? "font-mono" : ""}`}>
        {value == null || value === "" ? "—" : value}
      </span>
    </div>
  );
}

function Badge({ ok, okLabel, noLabel }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full border font-mono text-[10px] font-bold flex items-center gap-1 ${
        ok
          ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
          : "bg-slate-800 text-slate-400 border-slate-700"
      }`}
    >
      <span className="material-symbols-outlined text-xs">{ok ? "check_circle" : "cancel"}</span>
      {ok ? okLabel : noLabel}
    </span>
  );
}

function fmtDate(ts) {
  if (!ts) return null;
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toISOString().slice(0, 19).replace("T", " ") + " UTC";
  } catch {
    return String(ts);
  }
}

function formatAreaConfidenceInterval(value) {
  if (Array.isArray(value) && value.length >= 2) {
    const lower = Number(value[0]);
    const upper = Number(value[1]);
    if (Number.isFinite(lower) && Number.isFinite(upper)) {
      return `Area (${lower.toFixed(3)}–${upper.toFixed(3)})`;
    }
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? `Area (±${numericValue.toFixed(3)})` : "Area";
}

function fmtNum(value, decimals, suffix = "") {
  return value != null && Number.isFinite(value) ? `${value.toFixed(decimals)}${suffix}` : "—";
}

/* ------------------------------------------------------------------ */
/* Backward Hindcasting: Detailed parameter table & trajectory points */
/* ------------------------------------------------------------------ */

function HindcastDetailsTable({ drift }) {
  const rows = [
    ["Simulation Engine", drift.simulationEngine || "Copernicus & Open-Meteo Lagrangian Hindcast"],
    ["Hindcast Status", drift.status || "—"],
    [
      "Lookback Window",
      drift.lookbackPeriodHours != null
        ? `${drift.lookbackPeriodHours}h (${(drift.lookbackPeriodHours / 24).toFixed(1)} days back)`
        : "—",
    ],
    ["Estimated Drift Duration", drift.estimatedDurationHours != null ? `${drift.estimatedDurationHours} hours` : "—"],
    ["Temporal Uncertainty Window", drift.uncertaintyWindowHours != null ? `±${drift.uncertaintyWindowHours} hours` : "—"],
    ["Estimated Spill Release Time", drift.estimatedStartStr || "—"],
    ["Earliest Plausible Release", drift.earliestPlausibleStr || "—"],
    ["Latest Plausible Release", drift.latestPlausibleStr || "—"],
    [
      "Estimated Origin Coordinates",
      drift.originLatitude != null
        ? `${drift.originLatitude.toFixed(4)}°N, ${drift.originLongitude.toFixed(4)}°E`
        : "—",
    ],
    [
      "Total Drift Distance",
      drift.originDistanceKm != null ? `${Number(drift.originDistanceKm).toFixed(2)} km` : "—",
    ],
    ["Origin Selection Method", drift.originSelectionMethod || "Spatiotemporal Advection Backtracking"],
    ["Land Intersection Flag", drift.originOnLand == null ? "—" : drift.originOnLand ? "Yes — check shoreline" : "No (Open Water)"],
    ["In-Situ Ocean Buoy Used", drift.insituCurrentUsed ? "Yes (Copernicus In-Situ)" : "No (Point Model)"],
    ...(drift.insituCurrentUsed
      ? [
          ["In-Situ Platform ID", drift.insituPlatformId || "—"],
          ["In-Situ Buoy Distance", drift.insituDistanceKm != null ? `${Number(drift.insituDistanceKm).toFixed(1)} km` : "—"],
        ]
      : []),
    ...(drift.reason ? [["Simulation Notes", drift.reason]] : []),
  ];

  return (
    <div className="overflow-x-auto mt-3">
      <table className="w-full text-xs">
        <tbody>
          {rows.map(([label, value]) => (
            <tr key={label} className="border-b border-white/10 last:border-0 hover:bg-white/[0.02]">
              <td className="py-2 pr-4 text-slate-400 font-medium whitespace-nowrap w-2/5 align-top">{label}</td>
              <td className="py-2 text-slate-100 font-mono font-semibold break-words">{value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function TrajectoryPointsTable({ points }) {
  const [showAll, setShowAll] = useState(false);
  if (!points || points.length === 0) return null;
  const visible = showAll ? points : points.slice(0, 8);

  return (
    <div className="mt-4 pt-4 border-t border-white/10">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-sm text-cyan-400">timeline</span>
          Backward Trajectory Step Table ({points.length} Steps)
        </span>
        {points.length > 8 && (
          <button
            onClick={() => setShowAll((s) => !s)}
            className="text-[11px] font-mono font-semibold text-cyan-400 hover:text-cyan-200 transition-colors"
          >
            {showAll ? "Show fewer" : `Show all ${points.length}`}
          </button>
        )}
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase text-slate-400 border-b border-white/10">
              <th className="py-2 pr-3 font-semibold whitespace-nowrap">Step</th>
              <th className="py-2 pr-3 font-semibold whitespace-nowrap">Time (UTC)</th>
              <th className="py-2 pr-3 font-semibold whitespace-nowrap">Latitude</th>
              <th className="py-2 pr-3 font-semibold whitespace-nowrap">Longitude</th>
              <th className="py-2 pr-3 font-semibold whitespace-nowrap">Current Speed (m/s)</th>
              <th className="py-2 pr-3 font-semibold whitespace-nowrap">Current Dir (°)</th>
              <th className="py-2 pr-3 font-semibold whitespace-nowrap">Wind Speed (m/s)</th>
              <th className="py-2 pr-3 font-semibold whitespace-nowrap">Wind Dir (°)</th>
              <th className="py-2 pr-3 font-semibold whitespace-nowrap text-right">Distance to Det. (km)</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => (
              <tr key={i} className="border-b border-white/5 hover:bg-white/[0.02]">
                <td className="py-1.5 pr-3 text-cyan-400/80 font-mono font-bold">
                  {i === 0 ? "T-0 (Det)" : i === points.length - 1 ? `T-${i} (Origin)` : `T-${i}`}
                </td>
                <td className="py-1.5 pr-3 text-slate-300 font-mono whitespace-nowrap">{p.time || "—"}</td>
                <td className="py-1.5 pr-3 text-slate-100 font-mono">{p.lat != null ? p.lat.toFixed(4) : "—"}</td>
                <td className="py-1.5 pr-3 text-slate-100 font-mono">{p.lon != null ? p.lon.toFixed(4) : "—"}</td>
                <td className="py-1.5 pr-3 text-teal-300 font-mono font-semibold">{fmtNum(p.currentSpeedMs, 2)}</td>
                <td className="py-1.5 pr-3 text-slate-200 font-mono">{fmtNum(p.currentDirectionDeg, 0, "°")}</td>
                <td className="py-1.5 pr-3 text-amber-300 font-mono font-semibold">{fmtNum(p.windSpeedMs, 2)}</td>
                <td className="py-1.5 pr-3 text-slate-200 font-mono">{fmtNum(p.windDirectionDeg, 0, "°")}</td>
                <td className="py-1.5 pr-3 text-cyan-200 font-mono text-right font-bold">
                  {fmtNum(p.distanceFromDetectionKm, 2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[10.5px] text-slate-500 mt-2 font-mono">
        Advection steps integrate 100% surface ocean current velocity + 3% wind leeway drift vector over 1-hour increments.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main Analysis Report Component                                      */
/* ------------------------------------------------------------------ */

export default function AnalysisReport({ prediction, selectedCandidate, onSelectVessel }) {
  const report = prediction.report || {};
  const detection = report.detection || {};
  const safe = report.safeMetadata;
  const geometry = report.spillGeometry;
  const environmental = report.environmental || {};
  const drift = report.drift || {};
  const driftForecast = prediction.driftForecast || report.driftForecast || {};
  const isSafe = report.inputType === "Sentinel-1 SAFE";

  const hasThumb = prediction.files?.jobId && (prediction.files?.overlayThumbnail || prediction.files?.overlay);
  const coordinates = report.coordinates;
  const candidatesList = Array.isArray(prediction.candidates) ? prediction.candidates : [];
  const trajectoryPoints = prediction.map?.trajectoryPoints || [];
  const forwardTrajectoryPoints = prediction.map?.forwardTrajectoryPoints || [];

  return (
    <div className="flex flex-col gap-6">
      {/* Report Hero Summary Header */}
      <ReportHero prediction={prediction} detection={detection} drift={drift} geometry={geometry} />

      {/* ---- Source Scene ---- */}
      <SectionCard
        icon="satellite_alt"
        title="Source Scene & Metadata"
        subtitle={isSafe ? "Sentinel-1 SAR C-Band Synthetic Aperture Radar" : "Satellite Imagery Analysis"}
      >
        <div className="flex flex-col md:flex-row gap-5">
          {hasThumb && (
            <a
              href={api.fileUrl(prediction.files.jobId, prediction.files.overlay)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 w-full md:w-52 h-40 rounded-xl overflow-hidden border border-cyan-400/20 bg-slate-950 block group shadow-md"
              title="Open full-resolution detection overlay"
            >
              <img
                src={api.fileUrl(prediction.files.jobId, prediction.files.overlayThumbnail || prediction.files.overlay)}
                alt="Uploaded scene with detection overlay"
                loading="lazy"
                className="w-full h-full object-cover group-hover:scale-105 transition-transform"
              />
            </a>
          )}
          <div className="flex-1 min-w-0">
            <div className="text-sm font-bold text-white break-all">{report.originalName || "Untitled scene"}</div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 mt-2">
              <InfoRow label="Sensor" value={prediction.sensor} mono={false} />
              <InfoRow label="Product Type" value={safe?.productType} />
              <InfoRow label="Polarization" value={safe?.polarizationUsed} />
              <InfoRow label="Orbit" value={safe?.orbitNumber ? `#${safe.orbitNumber}` : null} />
              <InfoRow label="Orbit Direction" value={safe?.orbitDirection} mono={false} />
              <InfoRow label="Dimensions" value={safe?.dimensions} />
              <InfoRow label="Acquisition Start" value={fmtDate(safe?.acquisitionStart)} />
              <InfoRow label="Acquisition Stop" value={fmtDate(safe?.acquisitionStop)} />
              <InfoRow
                label="Pixel Spacing"
                value={
                  safe?.rangePixelSpacingM != null
                    ? `${safe.rangePixelSpacingM.toFixed(2)} × ${safe.azimuthPixelSpacingM?.toFixed(2)} m`
                    : null
                }
              />
              <InfoRow
                label="Processing Time"
                value={report.elapsedSeconds != null ? `${report.elapsedSeconds}s` : null}
              />
              <InfoRow label="Detection Time" value={fmtDate(report.detectionTime)} />
              <InfoRow label="Incident ID" value={prediction.incidentId} />
              <InfoRow
                label="Coordinates"
                value={
                  coordinates ? `${coordinates.latitude.toFixed(4)}°, ${coordinates.longitude.toFixed(4)}°` : null
                }
              />
              <InfoRow label="Severity" value={report.severity} mono={false} />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ------------------------------------------------------------------ */}
      {/* 2-GRID: Model Detection, Attribution Probability, Spill Configuration, */}
      {/* and Ocean Currents & Wind                                         */}
      {/* ------------------------------------------------------------------ */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* 1. Model Detection */}
        <SectionCard
          icon="model_training"
          iconTone="text-teal-400 bg-teal-950/50 border-teal-400/20"
          title="Model Detection"
          subtitle={prediction.modelName || "Deep CNN SAR Classifier"}
          pill={
            <span
              className={`px-2.5 py-1 rounded-full border font-mono text-xs font-bold ${
                prediction.detection === "detected"
                  ? "bg-rose-500/15 text-rose-300 border-rose-400/30"
                  : "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
              }`}
            >
              {detection.prediction || (prediction.detection === "detected" ? "OIL SPILL CONFIRMED" : "NO OIL SPILL")}
            </span>
          }
        >
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Stat
              value={detection.confidencePercent != null ? `${detection.confidencePercent}%` : null}
              label="Confidence"
              tone="text-teal-400"
            />
            <Stat
              value={detection.spillCoveragePercent != null ? `${detection.spillCoveragePercent}%` : null}
              label="Coverage"
              tone="text-cyan-200"
            />
            <Stat value={detection.oilPixelCount?.toLocaleString()} label="Oil Pixels" small />
            <Stat value={detection.totalPixels?.toLocaleString()} label="Total Pixels" small />
          </div>
          <div className="mt-3 pt-3 border-t border-white/10 text-xs text-slate-400 leading-relaxed">
            Neural segmentation classifies backscatter dampening anomalies caused by surface tension reduction of oil slicks.
          </div>
        </SectionCard>

        {/* 2. Attribution Probability Comparison */}
        <SectionCard
          icon="bar_chart"
          iconTone="text-sky-400 bg-sky-950/50 border-sky-400/20"
          title="Attribution Probability Comparison"
          subtitle="Relative attribution likelihood across top candidates"
          pill={
            candidatesList.length > 0 && (
              <span className="px-2 py-0.5 rounded-full bg-cyan-950/70 border border-cyan-400/30 font-mono text-[10px] text-cyan-200 font-bold">
                TOP {Math.min(6, candidatesList.length)}
              </span>
            )
          }
        >
          {candidatesList.length > 0 ? (
            <div>
              <BarChart
                data={candidatesList.slice(0, 6).map((c) => ({
                  label: c.name || `MMSI ${c.mmsi}`,
                  value: c.probability ?? 0,
                  color:
                    c.rank === 1
                      ? "#ef4444"
                      : c.rank === 2
                      ? "#f97316"
                      : c.rank === 3
                      ? "#eab308"
                      : "#38bdf8",
                }))}
              />
              <div className="flex items-center justify-between text-[10.5px] text-slate-400 font-mono mt-2 pt-2 border-t border-white/10">
                <span>Rank 1 (Red) = Primary Suspect</span>
                <span>Bayesian Posterior Score</span>
              </div>
            </div>
          ) : (
            <div className="py-6 text-center text-xs text-slate-500 font-mono">
              No candidates within attribution window for this run.
            </div>
          )}
        </SectionCard>

        {/* 3. Spill Configuration */}
        <SectionCard
          icon="straighten"
          iconTone="text-cyan-400 bg-cyan-950/50 border-cyan-400/20"
          title="Spill Configuration"
          subtitle="Morphological dimensions and geometric boundaries"
        >
          {geometry && geometry.areaKm2 != null ? (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Stat
                  value={`${geometry.areaKm2.toFixed(3)} km²`}
                  label={
                    geometry.areaConfidenceIntervalKm2 != null
                      ? formatAreaConfidenceInterval(geometry.areaConfidenceIntervalKm2)
                      : "Area"
                  }
                  tone="text-cyan-300"
                />
                <Stat
                  value={geometry.lengthKm != null ? `${geometry.lengthKm.toFixed(2)} km` : null}
                  label="Length"
                />
                <Stat
                  value={geometry.widthKm != null ? `${geometry.widthKm.toFixed(2)} km` : null}
                  label="Width"
                />
                <Stat
                  value={geometry.perimeterKm != null ? `${geometry.perimeterKm.toFixed(2)} km` : null}
                  label="Perimeter"
                />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 mt-3 pt-3 border-t border-white/10">
                <InfoRow label="Spill Patches" value={geometry.numSpillPatches} />
                <InfoRow label="Geolocation Source" value={geometry.geolocationSource} mono={false} />
                <InfoRow
                  label="Pixel Count Area"
                  value={geometry.pixelCountAreaKm2 != null ? `${geometry.pixelCountAreaKm2.toFixed(3)} km²` : null}
                />
                <InfoRow
                  label="Discrepancy"
                  value={geometry.areaDiscrepancyPct != null ? `${geometry.areaDiscrepancyPct.toFixed(1)}%` : null}
                />
                <InfoRow
                  label="Estimates Consistent"
                  value={
                    geometry.areaEstimatesConsistent == null
                      ? null
                      : geometry.areaEstimatesConsistent
                      ? "Yes"
                      : "Caution"
                  }
                  mono={false}
                />
                <InfoRow
                  label="Boundary Vertices"
                  value={report.spillBoundary?.reduce((total, patch) => total + patch.length, 0) || "—"}
                />
              </div>
            </>
          ) : (
            <div className="text-xs text-slate-400 bg-white/[0.04] border border-white/10 rounded-xl p-3">
              {prediction.areaIsCoveragePercent
                ? `Precise geometry estimated from scene coverage of ${prediction.slickAreaKm2}%.`
                : "Spill geometry was not computed for this scene."}
            </div>
          )}
        </SectionCard>

        {/* 4. Ocean Currents & Wind */}
        <SectionCard
          icon="water"
          iconTone="text-teal-400 bg-teal-950/50 border-teal-400/20"
          title="Ocean Currents & Wind"
          subtitle="Hydrodynamic atmospheric forcing at scene center"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-teal-400">waves</span>
                  Ocean Current
                </span>
                <Badge ok={environmental.hasValidCurrents} okLabel="Active" noLabel="Unavailable" />
              </div>
              {environmental.hasValidCurrents ? (
                <div className="grid grid-cols-2 gap-2">
                  <Stat value={`${environmental.currentVelocityMs?.toFixed(2)} m/s`} label="Velocity" tone="text-teal-300" small />
                  <Stat
                    value={environmental.currentDirectionDeg != null ? `${Math.round(environmental.currentDirectionDeg)}°` : null}
                    label="Bearing"
                    small
                  />
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {(environmental.warnings || []).find((w) => w.toLowerCase().includes("current")) ||
                    "No direct current records for this timestamp."}
                </p>
              )}
            </div>
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-3.5">
              <div className="flex items-center justify-between mb-2">
                <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                  <span className="material-symbols-outlined text-sm text-amber-400">cyclone</span>
                  Surface Wind
                </span>
                <Badge ok={environmental.hasValidWind} okLabel="Active" noLabel="Unavailable" />
              </div>
              {environmental.hasValidWind ? (
                <div className="grid grid-cols-2 gap-2">
                  <Stat value={`${environmental.windSpeedMs?.toFixed(1)} m/s`} label="Speed" tone="text-amber-300" small />
                  <Stat
                    value={environmental.windDirectionDeg != null ? `${Math.round(environmental.windDirectionDeg)}°` : null}
                    label="Direction"
                    small
                  />
                </div>
              ) : (
                <p className="text-[11px] text-slate-400 leading-relaxed">
                  {(environmental.warnings || []).find((w) => w.toLowerCase().includes("wind")) ||
                    "No wind record available for this coordinate."}
                </p>
              )}
            </div>
          </div>
          {environmental.source && (
            <div className="flex items-center justify-between text-[10px] text-slate-400 mt-3 pt-2 border-t border-white/10 font-mono">
              <span>Telemetry Source: {environmental.source}</span>
              <span>10m Surface Level</span>
            </div>
          )}
        </SectionCard>
      </div>

      {/* ------------------------------------------------------------------ */}
      {/* ENHANCED BACKWARD DRIFT HINDCAST (BACKTRACKING) SECTION             */}
      {/* ------------------------------------------------------------------ */}
      <SectionCard
        icon="explore"
        iconTone="text-amber-400 bg-amber-950/50 border-amber-400/20"
        title="Backward Drift Hindcast & Source Origin Reconstruction"
        subtitle={drift.simulationEngine || "Lagrangian Ocean Surface Advection & Atmospheric Leeway Backtracking"}
        pill={
          <span
            className={`px-2.5 py-1 rounded-full border font-mono text-[10px] font-bold ${
              drift.status === "ESTIMATED"
                ? "bg-emerald-500/15 text-emerald-300 border-emerald-400/30"
                : "bg-slate-800 text-slate-400 border-slate-700"
            }`}
          >
            {drift.status || "UNAVAILABLE"}
          </span>
        }
      >
        {drift.status === "ESTIMATED" ? (
          <div className="space-y-6">
            {/* Top Metrics Row */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat
                value={drift.estimatedDurationHours != null ? `${drift.estimatedDurationHours}h` : null}
                label="Drift Duration"
                tone="text-amber-300"
              />
              <Stat
                value={drift.originDistanceKm != null ? `${Number(drift.originDistanceKm).toFixed(1)} km` : null}
                label="Displacement"
                tone="text-cyan-300"
              />
              <Stat
                value={drift.lookbackPeriodHours != null ? `${drift.lookbackPeriodHours}h` : null}
                label="Lookback Window"
              />
              <Stat
                value={drift.uncertaintyWindowHours != null ? `±${drift.uncertaintyWindowHours}h` : null}
                label="Uncertainty Window"
              />
            </div>

            {/* Hydrodynamic Drift Forcing Vector Breakdown */}
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
              <div className="text-xs font-bold text-white flex items-center gap-2 mb-3">
                <span className="material-symbols-outlined text-sm text-cyan-400">tune</span>
                Hydrodynamic Advection Forcing Model
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-xs">
                <div className="p-3 rounded-lg bg-teal-950/40 border border-teal-500/20">
                  <div className="font-mono text-[10px] text-teal-400 uppercase font-semibold">
                    1. Surface Current Advection
                  </div>
                  <div className="text-slate-200 mt-1 font-mono text-xs">
                    {environmental.currentVelocityMs != null
                      ? `${environmental.currentVelocityMs.toFixed(2)} m/s @ ${Math.round(environmental.currentDirectionDeg || 0)}°`
                      : "Derived from Copernicus / Open-Meteo"}
                  </div>
                  <div className="text-[10px] text-teal-300/80 mt-1">100% Vector Force Transfer</div>
                </div>
                <div className="p-3 rounded-lg bg-amber-950/40 border border-amber-500/20">
                  <div className="font-mono text-[10px] text-amber-400 uppercase font-semibold">
                    2. Surface Wind Leeway
                  </div>
                  <div className="text-slate-200 mt-1 font-mono text-xs">
                    {environmental.windSpeedMs != null
                      ? `${(environmental.windSpeedMs * 0.03).toFixed(2)} m/s (3% Leeway)`
                      : "3% of 10m Wind Vector"}
                  </div>
                  <div className="text-[10px] text-amber-300/80 mt-1">Direct Atmospheric Drag</div>
                </div>
                <div className="p-3 rounded-lg bg-cyan-950/40 border border-cyan-500/20">
                  <div className="font-mono text-[10px] text-cyan-400 uppercase font-semibold">
                    3. Net Resultant Drift Path
                  </div>
                  <div className="text-slate-200 mt-1 font-mono text-xs">
                    {drift.originDistanceKm != null ? `${Number(drift.originDistanceKm).toFixed(1)} km total travel` : "Integrated Backtrack"}
                  </div>
                  <div className="text-[10px] text-cyan-300/80 mt-1">Origin Coordinates Resolved</div>
                </div>
              </div>
            </div>

            {/* VISUALIZATION 1: Vessel Closeness to Spill Origin at Estimated Release Time */}
            {candidatesList.length > 0 && (
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
                  <div>
                    <div className="text-xs font-bold text-white flex items-center gap-2">
                      <span className="material-symbols-outlined text-sm text-rose-400">near_me</span>
                      Vessel Closeness to Spill Origin at Release Window (T-Release)
                    </div>
                    <p className="text-[11px] text-slate-400 mt-0.5">
                      Distance from each candidate's interpolated position to estimated origin at{" "}
                      <span className="text-cyan-300 font-mono font-semibold">{drift.estimatedStartStr || "spill time"}</span>
                    </p>
                  </div>
                  <span className="px-2 py-0.5 rounded bg-rose-500/10 border border-rose-400/20 text-rose-300 font-mono text-[10px]">
                    Shorter Bar = Closer to Origin Point
                  </span>
                </div>
                <VesselProximityToOriginChart candidates={candidatesList} />
              </div>
            )}

            {/* VISUALIZATION 2: Trajectory & Environmental Forcing Graph along Backward Track */}
            {trajectoryPoints.length > 0 && trajectoryPoints.some((p) => p.currentSpeedMs != null || p.windSpeedMs != null) && (
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="flex items-center justify-between flex-wrap gap-2 mb-2">
                  <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
                    <span className="material-symbols-outlined text-sm text-cyan-400">show_chart</span>
                    Current & Wind Velocity Profile Along Backward Drift Track
                  </div>
                  <div className="text-[10px] font-mono text-slate-400">
                    From Detection Centroid (T-0) → Release Origin (T-{drift.estimatedDurationHours || trajectoryPoints.length}h)
                  </div>
                </div>
                <LineChart
                  yLabel="Speed (m/s)"
                  xLabel="Hindcast Step (Detection Centroid → Spill Origin Point)"
                  series={[
                    {
                      name: "Current Speed",
                      color: "#2dd4bf",
                      points: trajectoryPoints.map((p) => ({ y: p.currentSpeedMs })),
                    },
                    {
                      name: "Wind Speed",
                      color: "#f59e0b",
                      points: trajectoryPoints.map((p) => ({ y: p.windSpeedMs })),
                    },
                  ]}
                  xLabels={trajectoryPoints.map((p, idx) => (idx === 0 ? "T-0 (Detect)" : idx === trajectoryPoints.length - 1 ? "Origin" : `T-${idx}h`))}
                />
              </div>
            )}

            {/* VISUALIZATION 3: Vessel Speed vs Origin CPA Kinematics Chart */}
            {candidatesList.some((c) => c.speedKts != null) && (
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="text-xs font-bold text-slate-200 flex items-center gap-1.5 mb-2">
                  <span className="material-symbols-outlined text-sm text-cyan-400">speed</span>
                  Vessel Kinematics (Speed Over Ground vs Closest Approach Distance)
                </div>
                <VesselKinematicsChart candidates={candidatesList} />
              </div>
            )}

            {/* Full parameter table */}
            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
              <div className="text-xs font-bold text-white flex items-center gap-1.5 mb-2">
                <span className="material-symbols-outlined text-sm text-amber-400">data_table</span>
                Comprehensive Hindcast Simulation Parameters
              </div>
              <HindcastDetailsTable drift={drift} />
            </div>

            {/* Backward trajectory points table */}
            <TrajectoryPointsTable points={trajectoryPoints} />

            {drift.disclaimer && (
              <p className="text-[10.5px] text-slate-400 mt-3 leading-relaxed font-mono">
                {drift.disclaimer}
              </p>
            )}
          </div>
        ) : (
          <div className="text-xs text-slate-400 bg-white/[0.04] border border-white/10 rounded-xl p-4">
            {drift.reason || "Backward drift hindcast could not be computed for this scene."}
          </div>
        )}
      </SectionCard>

      {/* ---- Estimated Spill Origin Callout ---- */}
      {drift.status === "ESTIMATED" && (
        <SectionCard
          icon="target"
          iconTone="text-rose-400 bg-rose-950/50 border-rose-400/20"
          title="Estimated Spill Origin Pinpoint"
          subtitle="Calculated release centroid derived from backward Lagrangian tracking"
        >
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2">
            <InfoRow
              label="Origin Coordinates"
              value={
                drift.originLatitude != null
                  ? `${drift.originLatitude.toFixed(4)}°N, ${drift.originLongitude.toFixed(4)}°E`
                  : null
              }
            />
            <InfoRow label="Estimated Release Time" value={drift.estimatedStartStr} mono={false} />
            <InfoRow label="Earliest Plausible Release" value={drift.earliestPlausibleStr} mono={false} />
            <InfoRow label="Latest Plausible Release" value={drift.latestPlausibleStr} mono={false} />
            <InfoRow label="Selection Method" value={drift.originSelectionMethod} mono={false} />
            <InfoRow
              label="Land Intersection Flag"
              value={drift.originOnLand ? "Yes — check shoreline" : "No (Open Water Point)"}
              mono={false}
            />
          </div>
        </SectionCard>
      )}

      {/* ---- Forward Drift Forecast Outlook ---- */}
      {(driftForecast.status === "COMPLETED" || forwardTrajectoryPoints.length > 0) && (
        <SectionCard
          icon="navigation"
          iconTone="text-orange-400 bg-orange-950/50 border-orange-400/20"
          title="Forward Drift Forecast & Trajectory Outlook"
          subtitle={driftForecast.simulationEngine || driftForecast.simulation_engine || "OpenDrift Hydrodynamic Forward Forecast Model (24h Window)"}
          pill={
            <span className="px-2.5 py-1 rounded-full border font-mono text-[10px] font-bold bg-orange-500/15 text-orange-300 border-orange-400/30">
              +{driftForecast.forecastHours ?? driftForecast.forecast_hours ?? 24}H FORECAST
            </span>
          }
        >
          <div className="space-y-5">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat
                value={
                  (driftForecast.forecastHours ?? driftForecast.forecast_hours) != null
                    ? `${driftForecast.forecastHours ?? driftForecast.forecast_hours}h`
                    : "24h"
                }
                label="Forecast Horizon"
                tone="text-orange-300"
              />
              <Stat
                value={
                  (driftForecast.totalDistanceKm ?? driftForecast.total_distance_km) != null
                    ? `${Number(driftForecast.totalDistanceKm ?? driftForecast.total_distance_km).toFixed(1)} km`
                    : "—"
                }
                label="Projected Drift"
                tone="text-cyan-300"
              />
              <Stat
                value={
                  (driftForecast.driftBearingDeg ?? driftForecast.drift_bearing_deg) != null
                    ? `${driftForecast.driftBearingDeg ?? driftForecast.drift_bearing_deg}°`
                    : "—"
                }
                label="Mean Bearing"
              />
              <Stat
                value={
                  (driftForecast.averageDriftSpeedKnots ?? driftForecast.average_drift_speed_knots) != null
                    ? `${driftForecast.averageDriftSpeedKnots ?? driftForecast.average_drift_speed_knots} kts`
                    : "—"
                }
                label="Average Velocity"
              />
            </div>

            <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
              <div className="text-xs font-bold text-white flex items-center gap-2 mb-3">
                <span className="material-symbols-outlined text-sm text-orange-400">fmd_good</span>
                Predicted Slick Position Horizon
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                <InfoRow
                  label="Initial Centroid (T=0)"
                  value={
                    (driftForecast.originLatitude ?? driftForecast.origin_latitude) != null
                      ? `${Number(driftForecast.originLatitude ?? driftForecast.origin_latitude).toFixed(4)}°N, ${Number(driftForecast.originLongitude ?? driftForecast.origin_longitude).toFixed(4)}°E`
                      : null
                  }
                />
                <InfoRow
                  label="Detection Time"
                  value={driftForecast.forecastStartStr || driftForecast.forecast_start_str || prediction.acquiredAt}
                  mono={false}
                />
                <InfoRow
                  label="Projected Centroid (+24h)"
                  value={
                    (driftForecast.finalLatitude ?? driftForecast.final_latitude) != null
                      ? `${Number(driftForecast.finalLatitude ?? driftForecast.final_latitude).toFixed(4)}°N, ${Number(driftForecast.finalLongitude ?? driftForecast.final_longitude).toFixed(4)}°E`
                      : null
                  }
                />
                <InfoRow
                  label="Forecast Target Time"
                  value={driftForecast.forecastEndStr || driftForecast.forecast_end_str}
                  mono={false}
                />
              </div>
            </div>

            {Array.isArray(driftForecast.waypoints) && driftForecast.waypoints.length > 0 && (
              <div className="p-4 rounded-xl bg-white/[0.03] border border-white/10">
                <div className="text-xs font-bold text-slate-200 flex items-center gap-2 mb-2">
                  <span className="material-symbols-outlined text-sm text-cyan-400">schedule</span>
                  Forecast Waypoint Progression
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-[11px] font-mono text-left">
                    <thead>
                      <tr className="border-b border-white/10 text-slate-400">
                        <th className="py-1.5 px-2">Checkpoint</th>
                        <th className="py-1.5 px-2">Time (UTC)</th>
                        <th className="py-1.5 px-2">Coordinates</th>
                        <th className="py-1.5 px-2 text-right">Drift Distance</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-white/5 text-slate-300">
                      {driftForecast.waypoints.map((wp, i) => (
                        <tr key={`wp-${i}`} className="hover:bg-white/[0.02]">
                          <td className="py-1.5 px-2 font-bold text-orange-400">+{wp.checkpoint_hour ?? wp.checkpointHour}h</td>
                          <td className="py-1.5 px-2">{wp.iso_time ?? wp.isoTime ?? wp.time}</td>
                          <td className="py-1.5 px-2 text-cyan-200">{wp.latitude}°N, {wp.longitude}°E</td>
                          <td className="py-1.5 px-2 text-right">{wp.cumulative_distance_km ?? wp.cumulativeDistanceKm} km</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <p className="text-[10px] text-slate-400 italic">
              {driftForecast.disclaimer || "Forecast trajectories are hydrodynamic model predictions based on forecasted ocean currents and winds."}
            </p>
          </div>
        </SectionCard>
      )}

      {/* ---- Evidence Breakdown (selected candidate) ---- */}
      {selectedCandidate && (
        <SectionCard
          icon="radar"
          iconTone="text-teal-400 bg-teal-950/50 border-teal-400/20"
          title="Attribution Evidence Multi-Factor Breakdown"
          subtitle={`${selectedCandidate.name || `MMSI ${selectedCandidate.mmsi}`} — score components`}
        >
          <div className="flex flex-col sm:flex-row items-center gap-6">
            <RadarChart
              color="#22d3ee"
              data={[
                { label: "SPATIAL", value: selectedCandidate.spatialScore },
                { label: "TEMPORAL", value: selectedCandidate.temporalScore },
                { label: "QUALITY", value: selectedCandidate.qualityScore },
                { label: "MATCH", value: selectedCandidate.overallScore },
                { label: "PROB", value: selectedCandidate.probability },
              ]}
            />
            <div className="text-xs text-slate-300 leading-relaxed flex-1 space-y-2">
              <p>
                Each axis is an independently computed evidence score (0–100) feeding this vessel's
                overall attribution match:
              </p>
              <ul className="list-disc list-inside space-y-1 text-slate-400 font-mono text-[11px]">
                <li>
                  <strong className="text-cyan-300">SPATIAL:</strong> Proximity to origin point at release window.
                </li>
                <li>
                  <strong className="text-cyan-300">TEMPORAL:</strong> Coincidence between AIS fix and slick formation.
                </li>
                <li>
                  <strong className="text-cyan-300">QUALITY:</strong> AIS message density, fix continuity &amp; latency.
                </li>
                <li>
                  <strong className="text-cyan-300">MATCH / PROB:</strong> Bayesian posterior probability of source identity.
                </li>
              </ul>
            </div>
          </div>
        </SectionCard>
      )}

      {/* ---- Vessel Traffic (proximity investigation) ---- */}
      {prediction.map?.vessels?.length > 0 && (
        <VesselProximityPanel
          vessels={prediction.map.vessels}
          summary={prediction.investigationSummary}
          selectedMmsi={selectedCandidate?.mmsi}
          onSelect={onSelectVessel}
        />
      )}
    </div>
  );
}