import { api } from "../api.js";
import VesselProximityPanel from "./VesselProximityPanel.jsx";

/* ------------------------------------------------------------------ */
/* Small shared building blocks, matching the design language already  */
/* used across SystemCapabilities.jsx / PredictionResults.jsx.         */
/* ------------------------------------------------------------------ */

function SectionCard({ icon, iconTone = "text-primary bg-sky-50 border-sky-100", title, subtitle, pill, children }) {
  return (
    <section className="bg-white rounded-2xl border border-border-soft shadow-sm p-5">
      <div className="flex items-start justify-between gap-3 pb-4 border-b border-slate-100">
        <div className="flex items-center gap-2.5">
          <span className={`w-9 h-9 rounded-xl border flex items-center justify-center shrink-0 ${iconTone}`}>
            <span className="material-symbols-outlined text-lg">{icon}</span>
          </span>
          <div>
            <h3 className="text-sm font-bold text-slate-900 tracking-tight">{title}</h3>
            {subtitle && <p className="text-[11px] text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
        </div>
        {pill}
      </div>
      <div className="pt-4">{children}</div>
    </section>
  );
}

function Stat({ value, label, tone = "text-slate-900", small }) {
  return (
    <div className="px-3 py-2.5 rounded-xl bg-slate-50 border border-slate-100 text-center">
      <div className={`font-mono ${small ? "text-xs" : "text-base"} font-bold leading-tight ${tone}`}>
        {value == null || value === "" ? "—" : value}
      </div>
      <div className="text-[9.5px] text-slate-400 uppercase font-semibold mt-1 tracking-wide">{label}</div>
    </div>
  );
}

function InfoRow({ label, value, mono = true }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-50 last:border-0">
      <span className="text-[11px] text-slate-400 font-medium">{label}</span>
      <span className={`text-xs text-slate-800 font-semibold text-right ${mono ? "font-mono" : ""}`}>
        {value == null || value === "" ? "—" : value}
      </span>
    </div>
  );
}

function Badge({ ok, okLabel, noLabel }) {
  return (
    <span
      className={`px-2 py-0.5 rounded-full border font-mono text-[10px] font-bold flex items-center gap-1 ${
        ok ? "bg-emerald-50 text-emerald-700 border-emerald-200" : "bg-slate-100 text-slate-500 border-slate-200"
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

/* ------------------------------------------------------------------ */

/**
 * The full, human-readable analysis report: scene provenance, detection
 * result, spill geometry, environmental conditions (with an honest "why
 * not available" when currents/wind couldn't be retrieved), the backward
 * drift/backtracking run, the estimated origin, and - as its last section -
 * the vessel proximity investigation table. Replaces the old bare vessel
 * table that used to sit alone at the bottom of the results page.
 *
 * Reads from `prediction.report` (see backend/data/store.js), which passes
 * pipeline.py's output through close to as-is - every field is null (not a
 * fabricated default) when the pipeline itself didn't have it, so this
 * component always shows the true state instead of guessing.
 */
export default function AnalysisReport({ prediction, selectedCandidate, onSelectVessel }) {
  const report = prediction.report || {};
  const detection = report.detection || {};
  const safe = report.safeMetadata;
  const geometry = report.spillGeometry;
  const environmental = report.environmental || {};
  const drift = report.drift || {};
  const isSafe = report.inputType === "Sentinel-1 SAFE";

  const hasThumb = prediction.files?.jobId && (prediction.files?.overlayThumbnail || prediction.files?.overlay);
  const coordinates = report.coordinates;

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center gap-2.5">
        <span className="material-symbols-outlined text-primary text-2xl">summarize</span>
        <div>
          <h2 className="text-lg font-bold text-slate-900 tracking-tight">Full Analysis Report</h2>
          <p className="text-xs text-slate-500">
            Run #{prediction.id} · generated from the complete detection → attribution pipeline
          </p>
        </div>
      </div>

      {/* ---- Source Scene ---- */}
      <SectionCard
        icon="satellite_alt"
        title="Source Scene"
        subtitle={isSafe ? "Sentinel-1 SAFE archive" : "Plain satellite image upload"}
      >
        <div className="flex flex-col md:flex-row gap-5">
          {hasThumb && (
            <a
              href={api.fileUrl(prediction.files.jobId, prediction.files.overlay)}
              target="_blank"
              rel="noreferrer"
              className="shrink-0 w-full md:w-48 h-36 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 block group"
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
            <div className="text-sm font-bold text-slate-900 break-all">
              {report.originalName || "Untitled scene"}
            </div>
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
              <InfoRow label="Processing Time" value={report.elapsedSeconds != null ? `${report.elapsedSeconds}s` : null} />
               <InfoRow label="Detection Time" value={fmtDate(report.detectionTime)} />
               <InfoRow label="Incident ID" value={prediction.incidentId} />
              <InfoRow label="Coordinates" value={coordinates ? `${coordinates.latitude.toFixed(4)}, ${coordinates.longitude.toFixed(4)}` : null} />
              <InfoRow label="Severity" value={report.severity} mono={false} />
            </div>
          </div>
        </div>
      </SectionCard>

      {/* ---- Detection ---- */}
      <SectionCard
        icon="model_training"
        iconTone="text-teal-600 bg-teal-50 border-teal-100"
        title="Model Detection"
        subtitle={prediction.modelName}
        pill={
          <span
            className={`px-2.5 py-1 rounded-full border font-mono text-xs font-bold ${
              prediction.detection === "detected"
                ? "bg-rose-50 text-rose-700 border-rose-200"
                : "bg-emerald-50 text-emerald-700 border-emerald-200"
            }`}
          >
            {detection.prediction || (prediction.detection === "detected" ? "OIL SPILL" : "NO OIL SPILL")}
          </span>
        }
      >
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat value={detection.confidencePercent != null ? `${detection.confidencePercent}%` : null} label="Confidence" tone="text-teal-700" />
          <Stat value={detection.spillCoveragePercent != null ? `${detection.spillCoveragePercent}%` : null} label="Scene Coverage" />
          <Stat value={detection.oilPixelCount?.toLocaleString()} label="Oil Pixels" small />
          <Stat value={detection.totalPixels?.toLocaleString()} label="Total Pixels" small />
        </div>
      </SectionCard>

      {/* ---- Spill Configuration ---- */}
      <SectionCard icon="straighten" iconTone="text-primary bg-sky-50 border-sky-100" title="Spill Configuration">
        {geometry && geometry.areaKm2 != null ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat
                value={`${geometry.areaKm2.toFixed(3)} km²`}
                label={geometry.areaConfidenceIntervalKm2 != null ? formatAreaConfidenceInterval(geometry.areaConfidenceIntervalKm2) : "Area"}
                tone="text-primary"
              />
              <Stat value={geometry.lengthKm != null ? `${geometry.lengthKm.toFixed(3)} km` : null} label="Length" />
              <Stat value={geometry.widthKm != null ? `${geometry.widthKm.toFixed(3)} km` : null} label="Width" />
              <Stat value={geometry.perimeterKm != null ? `${geometry.perimeterKm.toFixed(3)} km` : null} label="Perimeter" />
            </div>
            <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
              Boundary vertices: {report.spillBoundary?.reduce((total, patch) => total + patch.length, 0) || 0}
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 mt-3 pt-3 border-t border-slate-100">
              <InfoRow label="Spill Patches" value={geometry.numSpillPatches} />
              <InfoRow label="Geolocation Source" value={geometry.geolocationSource} mono={false} />
              <InfoRow
                label="Cross-check (pixel count)"
                value={geometry.pixelCountAreaKm2 != null ? `${geometry.pixelCountAreaKm2.toFixed(3)} km²` : null}
              />
              <InfoRow
                label="Discrepancy"
                value={geometry.areaDiscrepancyPct != null ? `${geometry.areaDiscrepancyPct.toFixed(1)}%` : null}
              />
              <InfoRow
                label="Estimates Consistent"
                value={geometry.areaEstimatesConsistent == null ? null : geometry.areaEstimatesConsistent ? "Yes" : "No — treat with caution"}
                mono={false}
              />
            </div>
          </>
        ) : (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
            {prediction.areaIsCoveragePercent
              ? `Precise geometry unavailable for this scene (no usable geolocation grid) — showing scene coverage of ${prediction.slickAreaKm2}% instead.`
              : "Spill geometry was not computed for this scene."}
          </div>
        )}
      </SectionCard>

      {/* ---- Ocean & Wind Conditions ---- */}
      <SectionCard icon="water" iconTone="text-sky-600 bg-sky-50 border-sky-100" title="Ocean Currents & Wind">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div className="rounded-xl border border-slate-100 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-teal-600">waves</span>
                Ocean Current
              </span>
              <Badge ok={environmental.hasValidCurrents} okLabel="Available" noLabel="Unavailable" />
            </div>
            {environmental.hasValidCurrents ? (
              <div className="grid grid-cols-2 gap-2">
                <Stat value={`${environmental.currentVelocityMs?.toFixed(2)} m/s`} label="Velocity" small />
                <Stat value={environmental.currentDirectionDeg != null ? `${Math.round(environmental.currentDirectionDeg)}°` : null} label="Direction" small />
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {(environmental.warnings || []).find((w) => w.toLowerCase().includes("current")) ||
                  "No valid ocean current data for this location/time."}
              </p>
            )}
          </div>
          <div className="rounded-xl border border-slate-100 p-3.5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-800 flex items-center gap-1.5">
                <span className="material-symbols-outlined text-sm text-slate-500">cyclone</span>
                Wind
              </span>
              <Badge ok={environmental.hasValidWind} okLabel="Available" noLabel="Unavailable" />
            </div>
            {environmental.hasValidWind ? (
              <div className="grid grid-cols-2 gap-2">
                <Stat value={`${environmental.windSpeedMs?.toFixed(1)} m/s`} label="Speed" small />
                <Stat value={environmental.windDirectionDeg != null ? `${Math.round(environmental.windDirectionDeg)}°` : null} label="Direction" small />
              </div>
            ) : (
              <p className="text-[11px] text-slate-500 leading-relaxed">
                {(environmental.warnings || []).find((w) => w.toLowerCase().includes("wind")) ||
                  "No valid wind data for this location/time."}
              </p>
            )}
          </div>
        </div>
        {environmental.source && (
          <p className="text-[10px] text-slate-400 mt-3 font-mono">Source: {environmental.source}</p>
        )}
      </SectionCard>

      {/* ---- Backward Drift / Backtracking ---- */}
      <SectionCard
        icon="explore"
        iconTone="text-amber-600 bg-amber-50 border-amber-100"
        title="Backward Drift Hindcast (Backtracking)"
        subtitle={drift.simulationEngine || undefined}
        pill={
          <span
            className={`px-2.5 py-1 rounded-full border font-mono text-[10px] font-bold ${
              drift.status === "ESTIMATED"
                ? "bg-emerald-50 text-emerald-700 border-emerald-200"
                : "bg-slate-100 text-slate-500 border-slate-200"
            }`}
          >
            {drift.status || "UNAVAILABLE"}
          </span>
        }
      >
        {drift.status === "ESTIMATED" ? (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <Stat value={drift.estimatedDurationHours != null ? `${drift.estimatedDurationHours}h` : null} label="Drift Duration" />
              <Stat value={drift.lookbackPeriodHours != null ? `${drift.lookbackPeriodHours}h` : null} label="Lookback Window" />
              <Stat value={drift.uncertaintyWindowHours != null ? `±${drift.uncertaintyWindowHours}h` : null} label="Uncertainty" />
              <Stat value={drift.originDistanceKm != null ? `${Number(drift.originDistanceKm).toFixed(1)} km` : null} label="Drift Distance" />
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-3 pt-3 border-t border-slate-100">
              {drift.insituCurrentUsed ? (
                <span className="px-2 py-0.5 rounded-full border font-mono text-[10px] font-bold bg-teal-50 text-teal-700 border-teal-200">
                  Copernicus In-Situ CSV Currents
                  {drift.insituDistanceKm != null ? ` (~${Math.round(drift.insituDistanceKm)}km)` : ""}
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full border font-mono text-[10px] font-bold bg-sky-50 text-primary border-sky-200">
                  Open-Meteo point data
                </span>
              )}
            </div>
            {drift.disclaimer && <p className="text-[10.5px] text-slate-400 mt-3 leading-relaxed">{drift.disclaimer}</p>}
          </>
        ) : (
          <div className="text-xs text-slate-500 bg-slate-50 border border-slate-100 rounded-xl p-3">
            {drift.reason || "Backward drift hindcast could not be computed for this scene."}
          </div>
        )}
      </SectionCard>

      {/* ---- Estimated Spill Origin ---- */}
      {drift.status === "ESTIMATED" && (
        <SectionCard icon="target" iconTone="text-rose-600 bg-rose-50 border-rose-100" title="Estimated Spill Origin">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6">
            <InfoRow
              label="Origin Coordinates"
              value={drift.originLatitude != null ? `${drift.originLatitude.toFixed(4)}°N, ${drift.originLongitude.toFixed(4)}°E` : null}
            />
            <InfoRow label="Estimated Release Time" value={drift.estimatedStartStr} mono={false} />
            <InfoRow label="Earliest Plausible" value={drift.earliestPlausibleStr} mono={false} />
            <InfoRow label="Latest Plausible" value={drift.latestPlausibleStr} mono={false} />
            <InfoRow label="Selection Method" value={drift.originSelectionMethod} mono={false} />
            <InfoRow label="On Land Flag" value={drift.originOnLand ? "Yes — check geolocation" : "No"} mono={false} />
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