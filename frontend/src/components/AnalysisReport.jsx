import { useState } from "react";
import { motion } from "framer-motion";
import { api } from "../api.js";
import VesselProximityPanel from "./VesselProximityPanel.jsx";
import {
  BarChart,
  LineChart,
  RadarChart,
  VesselProximityToOriginChart,
  VesselKinematicsChart,
} from "./Charts.jsx";

/* ------------------------------------------------------------------ */
/* Building blocks - "survey chart" light theme (results.css)          */
/* ------------------------------------------------------------------ */

const rise = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.7, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] } }),
};

function Reveal({ children, i = 0, className = "" }) {
  return (
    <motion.div className={className} variants={rise} custom={i} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.12 }}>
      {children}
    </motion.div>
  );
}

/** One website-style page section: sticky heading on the left, content on the right (or stacked when `wide`). */
function Block({ id, num, eyebrow, title, em, lede, wide = false, children }) {
  const head = (
    <>
      <Reveal>
        <span className="lt-eyebrow">
          {num} · {eyebrow}
        </span>
      </Reveal>
      <Reveal i={1}>
        <h2 className="lt-h2 lt-display">
          {title}
          <br />
          <em>{em}</em>
        </h2>
      </Reveal>
      {lede && (
        <Reveal i={2}>
          <p className="lt-lede">{lede}</p>
        </Reveal>
      )}
    </>
  );

  return (
    <section id={id} className="lr-section">
      {wide ? (
        <>
          <div className="lr-head-block">{head}</div>
          <div className="lr-stack">{children}</div>
        </>
      ) : (
        <div className="lr-split">
          <div className="lr-sticky">{head}</div>
          <div className="lr-stack">{children}</div>
        </div>
      )}
    </section>
  );
}

function Card({ icon = "insights", title, subtitle, pill, tone = "", children }) {
  return (
    <Reveal>
      <div className={`lr-card ${tone}`}>
        <div className="lr-card-head">
          <div className="lr-card-title">
            <span className="lr-ico">
              <span className="material-symbols-outlined">{icon}</span>
            </span>
            <div>
              <h3>{title}</h3>
              {subtitle && <p>{subtitle}</p>}
            </div>
          </div>
          {pill}
        </div>
        {children}
      </div>
    </Reveal>
  );
}

function Stat({ value, label, tone = "", small }) {
  return (
    <div className={`lr-stat ${small ? "is-small" : ""}`}>
      <b className={tone}>{value == null || value === "" ? "—" : value}</b>
      <span>{label}</span>
    </div>
  );
}

function InfoRow({ label, value, mono = true }) {
  return (
    <div className={`lr-kv ${mono ? "is-mono" : ""}`}>
      <span>{label}</span>
      <span>{value == null || value === "" ? "—" : value}</span>
    </div>
  );
}

function Pill({ tone = "", children }) {
  return <span className={`lr-pill ${tone}`}>{children}</span>;
}

function Badge({ ok, okLabel, noLabel }) {
  return (
    <span className={`lr-pill ${ok ? "is-clean" : "is-mute"}`}>
      <span className="material-symbols-outlined">{ok ? "check_circle" : "cancel"}</span>
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
/* Hindcast tables                                                     */
/* ------------------------------------------------------------------ */

function HindcastDetailsTable({ drift }) {
  const rows = [
    ["Simulation Engine", drift.simulationEngine || "Copernicus & Open-Meteo Lagrangian Hindcast"],
    ["Hindcast Status", drift.status || "—"],
    ["Lookback Window", drift.lookbackPeriodHours != null ? `${drift.lookbackPeriodHours}h (${(drift.lookbackPeriodHours / 24).toFixed(1)} days back)` : "—"],
    ["Estimated Drift Duration", drift.estimatedDurationHours != null ? `${drift.estimatedDurationHours} hours` : "—"],
    ["Temporal Uncertainty Window", drift.uncertaintyWindowHours != null ? `±${drift.uncertaintyWindowHours} hours` : "—"],
    ["Estimated Spill Release Time", drift.estimatedStartStr || "—"],
    ["Earliest Plausible Release", drift.earliestPlausibleStr || "—"],
    ["Latest Plausible Release", drift.latestPlausibleStr || "—"],
    ["Estimated Origin Coordinates", drift.originLatitude != null ? `${drift.originLatitude.toFixed(4)}°N, ${drift.originLongitude.toFixed(4)}°E` : "—"],
    ["Total Drift Distance", drift.originDistanceKm != null ? `${Number(drift.originDistanceKm).toFixed(2)} km` : "—"],
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
    <div className="lr-kvgrid">
      {rows.map(([label, value]) => (
        <InfoRow key={label} label={label} value={value} />
      ))}
    </div>
  );
}

function TrajectoryPointsTable({ points }) {
  const [showAll, setShowAll] = useState(false);
  if (!points || points.length === 0) return null;
  const visible = showAll ? points : points.slice(0, 8);

  return (
    <div className="lr-chart">
      <div className="lr-chart-head">
        <h4>
          <span className="material-symbols-outlined">timeline</span>
          Backward trajectory step table ({points.length} steps)
        </h4>
        {points.length > 8 && (
          <button type="button" className="lr-linkbtn" onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show fewer" : `Show all ${points.length}`}
          </button>
        )}
      </div>
      <div className="lr-scroll">
        <table className="lr-table" style={{ minWidth: 820 }}>
          <thead>
            <tr>
              <th>Step</th>
              <th>Time (UTC)</th>
              <th>Latitude</th>
              <th>Longitude</th>
              <th>Current (m/s)</th>
              <th>Current dir</th>
              <th>Wind (m/s)</th>
              <th>Wind dir</th>
              <th style={{ textAlign: "right" }}>Dist. to det. (km)</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((p, i) => (
              <tr key={i}>
                <td className="m strong">{i === 0 ? "T-0 (Det)" : i === points.length - 1 ? `T-${i} (Origin)` : `T-${i}`}</td>
                <td className="m">{p.time || "—"}</td>
                <td className="m">{p.lat != null ? p.lat.toFixed(4) : "—"}</td>
                <td className="m">{p.lon != null ? p.lon.toFixed(4) : "—"}</td>
                <td className="m" style={{ color: "#0f7f8c", fontWeight: 700 }}>{fmtNum(p.currentSpeedMs, 2)}</td>
                <td className="m">{fmtNum(p.currentDirectionDeg, 0, "°")}</td>
                <td className="m" style={{ color: "#a87a14", fontWeight: 700 }}>{fmtNum(p.windSpeedMs, 2)}</td>
                <td className="m">{fmtNum(p.windDirectionDeg, 0, "°")}</td>
                <td className="m strong" style={{ textAlign: "right" }}>{fmtNum(p.distanceFromDetectionKm, 2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="lr-fine">Advection steps integrate 100% surface ocean current velocity + 3% wind leeway drift vector over 1-hour increments.</p>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Main analysis report - returns page sections (ids: source,          */
/* detection, conditions, hindcast, forecast, attribution, traffic)    */
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
  const showForecast = driftForecast.status === "COMPLETED" || forwardTrajectoryPoints.length > 0;
  const detected = prediction.detection === "detected";

  // Section numbering: "01" is the investigation block on the page itself.
  let n = 1;
  const num = () => String(++n).padStart(2, "0");

  return (
    <>
      {/* ------------------------------ Source scene ------------------------------ */}
      <Block
        id="source"
        num={num()}
        eyebrow="Source scene"
        title="The scene,"
        em="as received."
        lede={isSafe ? "A Sentinel-1 C-band synthetic aperture radar product, read straight from its SAFE archive." : "Satellite imagery analysed as uploaded."}
      >
        <Card icon="satellite_alt" title="Scene & metadata" subtitle={isSafe ? "Sentinel-1 SAR C-band" : "Satellite imagery analysis"}>
          <div className="lr-scene">
            {hasThumb && (
              <a
                className="lr-thumb"
                href={api.fileUrl(prediction.files.jobId, prediction.files.overlay)}
                target="_blank"
                rel="noreferrer"
                title="Open full-resolution detection overlay"
              >
                <img
                  src={api.fileUrl(prediction.files.jobId, prediction.files.overlayThumbnail || prediction.files.overlay)}
                  alt="Uploaded scene with detection overlay"
                  loading="lazy"
                />
              </a>
            )}
            <div className="lr-scene-info">
              <div className="lr-scene-name">{report.originalName || "Untitled scene"}</div>
              <div className="lr-kvgrid is-flush">
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
                  value={safe?.rangePixelSpacingM != null ? `${safe.rangePixelSpacingM.toFixed(2)} × ${safe.azimuthPixelSpacingM?.toFixed(2)} m` : null}
                />
                <InfoRow label="Processing Time" value={report.elapsedSeconds != null ? `${report.elapsedSeconds}s` : null} />
                <InfoRow label="Detection Time" value={fmtDate(report.detectionTime)} />
                <InfoRow label="Incident ID" value={prediction.incidentId} />
                <InfoRow label="Coordinates" value={coordinates ? `${coordinates.latitude.toFixed(4)}°, ${coordinates.longitude.toFixed(4)}°` : null} />
                <InfoRow label="Severity" value={report.severity} mono={false} />
              </div>
            </div>
          </div>
        </Card>
      </Block>

      {/* -------------------------------- Detection ------------------------------- */}
      <Block
        id="detection"
        num={num()}
        eyebrow="Detection"
        title="What the model"
        em="saw."
        lede="Pixel-level segmentation of the radar backscatter, then the spill's real-world footprint."
      >
        <Card
          icon="model_training"
          title="Model detection"
          subtitle={prediction.modelName || "Deep CNN SAR classifier"}
          pill={<Pill tone={detected ? "is-hot" : "is-clean"}>{detection.prediction || (detected ? "OIL SPILL CONFIRMED" : "NO OIL SPILL")}</Pill>}
        >
          <div className="lr-stats">
            <Stat value={detection.confidencePercent != null ? `${detection.confidencePercent}%` : null} label="Confidence" tone="is-sea" />
            <Stat value={detection.spillCoveragePercent != null ? `${detection.spillCoveragePercent}%` : null} label="Coverage" />
            <Stat value={detection.oilPixelCount?.toLocaleString()} label="Oil pixels" small />
            <Stat value={detection.totalPixels?.toLocaleString()} label="Total pixels" small />
          </div>
          <p className="lr-fine">Neural segmentation classifies backscatter dampening anomalies caused by surface-tension reduction from oil slicks.</p>
        </Card>

        <Card icon="straighten" title="Spill configuration" subtitle="Morphological dimensions and geometric boundaries">
          {geometry && geometry.areaKm2 != null ? (
            <>
              <div className="lr-stats">
                <Stat
                  value={`${geometry.areaKm2.toFixed(3)} km²`}
                  label={geometry.areaConfidenceIntervalKm2 != null ? formatAreaConfidenceInterval(geometry.areaConfidenceIntervalKm2) : "Area"}
                  tone="is-hot"
                  small
                />
                <Stat value={geometry.lengthKm != null ? `${geometry.lengthKm.toFixed(2)} km` : null} label="Length" small />
                <Stat value={geometry.widthKm != null ? `${geometry.widthKm.toFixed(2)} km` : null} label="Width" small />
                <Stat value={geometry.perimeterKm != null ? `${geometry.perimeterKm.toFixed(2)} km` : null} label="Perimeter" small />
              </div>
              <div className="lr-kvgrid" style={{ marginTop: 18 }}>
                <InfoRow label="Spill Patches" value={geometry.numSpillPatches} />
                <InfoRow label="Geolocation Source" value={geometry.geolocationSource} mono={false} />
                <InfoRow label="Pixel Count Area" value={geometry.pixelCountAreaKm2 != null ? `${geometry.pixelCountAreaKm2.toFixed(3)} km²` : null} />
                <InfoRow label="Discrepancy" value={geometry.areaDiscrepancyPct != null ? `${geometry.areaDiscrepancyPct.toFixed(1)}%` : null} />
                <InfoRow
                  label="Estimates Consistent"
                  value={geometry.areaEstimatesConsistent == null ? null : geometry.areaEstimatesConsistent ? "Yes" : "Caution"}
                  mono={false}
                />
                <InfoRow label="Boundary Vertices" value={report.spillBoundary?.reduce((total, patch) => total + patch.length, 0) || "—"} />
              </div>
            </>
          ) : (
            <p className="lr-body-text">
              {prediction.areaIsCoveragePercent
                ? `Precise geometry estimated from scene coverage of ${prediction.slickAreaKm2}%.`
                : "Spill geometry was not computed for this scene."}
            </p>
          )}
        </Card>
      </Block>

      {/* ------------------------------- Conditions ------------------------------- */}
      <Block
        id="conditions"
        num={num()}
        eyebrow="Conditions"
        title="Wind and water,"
        em="at the scene."
        lede="The hydrodynamic and atmospheric forcing that moved the oil, taken at the scene centre."
      >
        <Card icon="water" title="Ocean currents & wind" subtitle="Hydrodynamic atmospheric forcing at scene center">
          <div className="lr-tiles" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))" }}>
            <div className="lr-sub-card">
              <div className="lr-sub-head">
                <span className="lr-inline">
                  <span className="material-symbols-outlined">waves</span>Ocean current
                </span>
                <Badge ok={environmental.hasValidCurrents} okLabel="Active" noLabel="Unavailable" />
              </div>
              {environmental.hasValidCurrents ? (
                <div className="lr-stats">
                  <Stat value={`${environmental.currentVelocityMs?.toFixed(2)} m/s`} label="Velocity" tone="is-sea" small />
                  <Stat value={environmental.currentDirectionDeg != null ? `${Math.round(environmental.currentDirectionDeg)}°` : null} label="Bearing" small />
                </div>
              ) : (
                <p className="lr-muted-text">
                  {(environmental.warnings || []).find((w) => w.toLowerCase().includes("current")) || "No direct current records for this timestamp."}
                </p>
              )}
            </div>
            <div className="lr-sub-card">
              <div className="lr-sub-head">
                <span className="lr-inline">
                  <span className="material-symbols-outlined" style={{ color: "#a87a14" }}>cyclone</span>Surface wind
                </span>
                <Badge ok={environmental.hasValidWind} okLabel="Active" noLabel="Unavailable" />
              </div>
              {environmental.hasValidWind ? (
                <div className="lr-stats">
                  <Stat value={`${environmental.windSpeedMs?.toFixed(1)} m/s`} label="Speed" tone="is-gold" small />
                  <Stat value={environmental.windDirectionDeg != null ? `${Math.round(environmental.windDirectionDeg)}°` : null} label="Direction" small />
                </div>
              ) : (
                <p className="lr-muted-text">
                  {(environmental.warnings || []).find((w) => w.toLowerCase().includes("wind")) || "No wind record available for this coordinate."}
                </p>
              )}
            </div>
          </div>
          {environmental.source && (
            <div className="lr-legend-line">
              <span>Telemetry source: {environmental.source}</span>
              <span>10m surface level</span>
            </div>
          )}
        </Card>
      </Block>

      {/* -------------------------------- Hindcast -------------------------------- */}
      <Block
        id="hindcast"
        wide
        num={num()}
        eyebrow="Backward hindcast"
        title="Where the oil"
        em="came from."
        lede={drift.simulationEngine || "Lagrangian ocean surface advection and atmospheric leeway, run backwards from the detection point."}
      >
        <Card
          icon="explore"
          title="Backward drift hindcast & source origin"
          subtitle="Origin reconstruction from surface currents and wind"
          pill={<Pill tone={drift.status === "ESTIMATED" ? "is-clean" : "is-mute"}>{drift.status || "UNAVAILABLE"}</Pill>}
        >
          {drift.status === "ESTIMATED" ? (
            <div className="lr-stack" style={{ gap: 18 }}>
              <div className="lr-stats">
                <Stat value={drift.estimatedDurationHours != null ? `${drift.estimatedDurationHours}h` : null} label="Drift duration" tone="is-gold" />
                <Stat value={drift.originDistanceKm != null ? `${Number(drift.originDistanceKm).toFixed(1)} km` : null} label="Displacement" tone="is-sea" small />
                <Stat value={drift.lookbackPeriodHours != null ? `${drift.lookbackPeriodHours}h` : null} label="Lookback window" />
                <Stat value={drift.uncertaintyWindowHours != null ? `±${drift.uncertaintyWindowHours}h` : null} label="Uncertainty window" />
              </div>

              <div className="lr-chart">
                <div className="lr-chart-head">
                  <h4>
                    <span className="material-symbols-outlined">tune</span>
                    Hydrodynamic advection forcing model
                  </h4>
                </div>
                <div className="lr-tiles">
                  <div className="lr-tile is-sea">
                    <div className="t-k">1. Surface current advection</div>
                    <div className="t-v">
                      {environmental.currentVelocityMs != null
                        ? `${environmental.currentVelocityMs.toFixed(2)} m/s @ ${Math.round(environmental.currentDirectionDeg || 0)}°`
                        : "Derived from Copernicus / Open-Meteo"}
                    </div>
                    <div className="t-n">100% vector force transfer</div>
                  </div>
                  <div className="lr-tile is-gold">
                    <div className="t-k">2. Surface wind leeway</div>
                    <div className="t-v">
                      {environmental.windSpeedMs != null ? `${(environmental.windSpeedMs * 0.03).toFixed(2)} m/s (3% leeway)` : "3% of 10m wind vector"}
                    </div>
                    <div className="t-n">Direct atmospheric drag</div>
                  </div>
                  <div className="lr-tile is-hot">
                    <div className="t-k">3. Net resultant drift path</div>
                    <div className="t-v">{drift.originDistanceKm != null ? `${Number(drift.originDistanceKm).toFixed(1)} km total travel` : "Integrated backtrack"}</div>
                    <div className="t-n">Origin coordinates resolved</div>
                  </div>
                </div>
              </div>

              {candidatesList.length > 0 && (
                <div className="lr-chart">
                  <div className="lr-chart-head">
                    <div>
                      <h4>
                        <span className="material-symbols-outlined" style={{ color: "#e2532b" }}>near_me</span>
                        Vessel closeness to spill origin at release window
                      </h4>
                      <p>
                        Distance from each candidate's interpolated position to the estimated origin at{" "}
                        <b style={{ color: "#0c2340" }}>{drift.estimatedStartStr || "spill time"}</b>
                      </p>
                    </div>
                    <Pill tone="is-hot">Shorter bar = closer</Pill>
                  </div>
                  <VesselProximityToOriginChart candidates={candidatesList} />
                </div>
              )}

              {trajectoryPoints.length > 0 && trajectoryPoints.some((p) => p.currentSpeedMs != null || p.windSpeedMs != null) && (
                <div className="lr-chart">
                  <div className="lr-chart-head">
                    <h4>
                      <span className="material-symbols-outlined">show_chart</span>
                      Current & wind velocity along the backward track
                    </h4>
                    <p style={{ margin: 0, fontFamily: "JetBrains Mono, monospace" }}>
                      Detection (T-0) → Release origin (T-{drift.estimatedDurationHours || trajectoryPoints.length}h)
                    </p>
                  </div>
                  <LineChart
                    yLabel="Speed (m/s)"
                    xLabel="Hindcast step (detection centroid → spill origin)"
                    series={[
                      { name: "Current", color: "#0f7f8c", points: trajectoryPoints.map((p) => ({ y: p.currentSpeedMs })) },
                      { name: "Wind", color: "#c8962e", points: trajectoryPoints.map((p) => ({ y: p.windSpeedMs })) },
                    ]}
                    xLabels={trajectoryPoints.map((p, idx) => (idx === 0 ? "T-0 (Detect)" : idx === trajectoryPoints.length - 1 ? "Origin" : `T-${idx}h`))}
                  />
                </div>
              )}

              {candidatesList.some((c) => c.speedKts != null) && (
                <div className="lr-chart">
                  <div className="lr-chart-head">
                    <h4>
                      <span className="material-symbols-outlined">speed</span>
                      Vessel kinematics · speed over ground vs distance to origin
                    </h4>
                  </div>
                  <VesselKinematicsChart candidates={candidatesList} />
                </div>
              )}

              <div className="lr-chart">
                <div className="lr-chart-head">
                  <h4>
                    <span className="material-symbols-outlined">data_table</span>
                    Comprehensive hindcast simulation parameters
                  </h4>
                </div>
                <HindcastDetailsTable drift={drift} />
              </div>

              <TrajectoryPointsTable points={trajectoryPoints} />

              {drift.disclaimer && <p className="lr-fine" style={{ margin: 0 }}>{drift.disclaimer}</p>}
            </div>
          ) : (
            <div className="lr-note is-warn" style={{ marginTop: 0 }}>
              {drift.reason || "Backward drift hindcast could not be computed for this scene."}
            </div>
          )}
        </Card>

        {drift.status === "ESTIMATED" && (
          <Card icon="target" title="Estimated spill origin pinpoint" subtitle="Release centroid derived from backward Lagrangian tracking">
            <div className="lr-kvgrid is-flush">
              <InfoRow
                label="Origin Coordinates"
                value={drift.originLatitude != null ? `${drift.originLatitude.toFixed(4)}°N, ${drift.originLongitude.toFixed(4)}°E` : null}
              />
              <InfoRow label="Estimated Release Time" value={drift.estimatedStartStr} mono={false} />
              <InfoRow label="Earliest Plausible Release" value={drift.earliestPlausibleStr} mono={false} />
              <InfoRow label="Latest Plausible Release" value={drift.latestPlausibleStr} mono={false} />
              <InfoRow label="Selection Method" value={drift.originSelectionMethod} mono={false} />
              <InfoRow label="Land Intersection Flag" value={drift.originOnLand ? "Yes — check shoreline" : "No (open water point)"} mono={false} />
            </div>
          </Card>
        )}
      </Block>

      {/* -------------------------------- Forecast -------------------------------- */}
      {showForecast && (
        <Block
          id="forecast"
          num={num()}
          eyebrow="Forward forecast"
          title="Where it is"
          em="heading."
          lede={driftForecast.simulationEngine || driftForecast.simulation_engine || "Forward drift projection from the detected location using forecast currents and wind."}
        >
          <Card
            icon="navigation"
            title="Forward drift forecast & trajectory outlook"
            subtitle="Predicted slick position over the forecast horizon"
            pill={<Pill tone="is-warn">+{driftForecast.forecastHours ?? driftForecast.forecast_hours ?? 24}H FORECAST</Pill>}
          >
            <div className="lr-stack" style={{ gap: 18 }}>
              <div className="lr-stats">
                <Stat
                  value={(driftForecast.forecastHours ?? driftForecast.forecast_hours) != null ? `${driftForecast.forecastHours ?? driftForecast.forecast_hours}h` : "24h"}
                  label="Forecast horizon"
                  tone="is-gold"
                />
                <Stat
                  value={(driftForecast.totalDistanceKm ?? driftForecast.total_distance_km) != null ? `${Number(driftForecast.totalDistanceKm ?? driftForecast.total_distance_km).toFixed(1)} km` : "—"}
                  label="Projected drift"
                  tone="is-sea"
                  small
                />
                <Stat
                  value={(driftForecast.driftBearingDeg ?? driftForecast.drift_bearing_deg) != null ? `${driftForecast.driftBearingDeg ?? driftForecast.drift_bearing_deg}°` : "—"}
                  label="Mean bearing"
                  small
                />
                <Stat
                  value={
                    (driftForecast.averageDriftSpeedKnots ?? driftForecast.average_drift_speed_knots) != null
                      ? `${driftForecast.averageDriftSpeedKnots ?? driftForecast.average_drift_speed_knots} kts`
                      : "—"
                  }
                  label="Average velocity"
                  small
                />
              </div>

              <div className="lr-chart">
                <div className="lr-chart-head">
                  <h4>
                    <span className="material-symbols-outlined">fmd_good</span>
                    Predicted slick position horizon
                  </h4>
                </div>
                <div className="lr-kvgrid is-flush">
                  <InfoRow
                    label="Initial Centroid (T=0)"
                    value={
                      (driftForecast.originLatitude ?? driftForecast.origin_latitude) != null
                        ? `${Number(driftForecast.originLatitude ?? driftForecast.origin_latitude).toFixed(4)}°N, ${Number(driftForecast.originLongitude ?? driftForecast.origin_longitude).toFixed(4)}°E`
                        : null
                    }
                  />
                  <InfoRow label="Detection Time" value={driftForecast.forecastStartStr || driftForecast.forecast_start_str || prediction.acquiredAt} mono={false} />
                  <InfoRow
                    label="Projected Centroid"
                    value={
                      (driftForecast.finalLatitude ?? driftForecast.final_latitude) != null
                        ? `${Number(driftForecast.finalLatitude ?? driftForecast.final_latitude).toFixed(4)}°N, ${Number(driftForecast.finalLongitude ?? driftForecast.final_longitude).toFixed(4)}°E`
                        : null
                    }
                  />
                  <InfoRow label="Forecast Target Time" value={driftForecast.forecastEndStr || driftForecast.forecast_end_str} mono={false} />
                </div>
              </div>

              {Array.isArray(driftForecast.waypoints) && driftForecast.waypoints.length > 0 && (
                <div className="lr-chart">
                  <div className="lr-chart-head">
                    <h4>
                      <span className="material-symbols-outlined">schedule</span>
                      Forecast waypoint progression
                    </h4>
                  </div>
                  <div className="lr-scroll">
                    <table className="lr-table" style={{ minWidth: 520 }}>
                      <thead>
                        <tr>
                          <th>Checkpoint</th>
                          <th>Time (UTC)</th>
                          <th>Coordinates</th>
                          <th style={{ textAlign: "right" }}>Drift distance</th>
                        </tr>
                      </thead>
                      <tbody>
                        {driftForecast.waypoints.map((wp, i) => (
                          <tr key={`wp-${i}`}>
                            <td className="m strong" style={{ color: "#c8621a" }}>+{wp.checkpoint_hour ?? wp.checkpointHour}h</td>
                            <td className="m">{wp.iso_time ?? wp.isoTime ?? wp.time}</td>
                            <td className="m">{wp.latitude}°N, {wp.longitude}°E</td>
                            <td className="m" style={{ textAlign: "right" }}>{wp.cumulative_distance_km ?? wp.cumulativeDistanceKm} km</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <p className="lr-fine" style={{ margin: 0 }}>
                {driftForecast.disclaimer || "Forecast trajectories are hydrodynamic model predictions based on forecasted ocean currents and winds."}
              </p>
            </div>
          </Card>
        </Block>
      )}

      {/* ------------------------------- Attribution ------------------------------ */}
      {(candidatesList.length > 0 || selectedCandidate) && (
        <Block
          id="attribution"
          num={num()}
          eyebrow="Attribution"
          title="Ranked by"
          em="the evidence."
          lede="Every score is computed independently and blended, then discounted by AIS track quality. Relative likelihoods, not proof of causation."
        >
          {candidatesList.length > 0 && (
            <Card
              icon="bar_chart"
              title="Attribution probability comparison"
              subtitle="Relative attribution likelihood across top candidates"
              pill={<span className="lr-count">TOP {Math.min(6, candidatesList.length)}</span>}
            >
              <BarChart
                data={candidatesList.slice(0, 6).map((c) => ({
                  label: c.name || `MMSI ${c.mmsi}`,
                  value: c.probability ?? 0,
                  color: c.rank === 1 ? "#7f1d1d" : c.rank === 2 ? "#f97316" : c.rank === 3 ? "#eab308" : "#2563eb",
                }))}
              />
              <div className="lr-legend-line">
                <span>Rank 1 (dark red) = primary suspect</span>
                <span>Relative attribution score</span>
              </div>
            </Card>
          )}

          {selectedCandidate && (
            <Card icon="radar" title="Multi-factor evidence breakdown" subtitle={`${selectedCandidate.name || `MMSI ${selectedCandidate.mmsi}`} — score components`}>
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 28 }}>
                <RadarChart
                  data={[
                    { label: "SPATIAL", value: selectedCandidate.spatialScore },
                    { label: "TEMPORAL", value: selectedCandidate.temporalScore },
                    { label: "QUALITY", value: selectedCandidate.qualityScore },
                    { label: "MATCH", value: selectedCandidate.overallScore },
                    { label: "PROB", value: selectedCandidate.probability },
                  ]}
                />
                <div style={{ flex: 1, minWidth: 240 }}>
                  <p className="lr-body-text">Each axis is an independently computed evidence score (0–100) feeding this vessel's overall attribution match.</p>
                  <div className="lr-kvgrid is-flush" style={{ marginTop: 10, gridTemplateColumns: "1fr" }}>
                    <InfoRow label="SPATIAL" value="Proximity to origin at release window" mono={false} />
                    <InfoRow label="TEMPORAL" value="AIS fix vs slick formation time" mono={false} />
                    <InfoRow label="QUALITY" value="Message density, continuity & latency" mono={false} />
                    <InfoRow label="MATCH / PROB" value="Overall score and relative likelihood" mono={false} />
                  </div>
                </div>
              </div>
            </Card>
          )}
        </Block>
      )}

      {/* --------------------------------- Traffic -------------------------------- */}
      {prediction.map?.vessels?.length > 0 && (
        <Block
          id="traffic"
          wide
          num={num()}
          eyebrow="Vessel traffic"
          title="Everyone who"
          em="was in the area."
          lede="Every evaluated vessel, ranked by attribution likelihood. Select one to draw its track on the map above."
        >
          <Reveal>
            <VesselProximityPanel
              vessels={prediction.map.vessels}
              summary={prediction.investigationSummary}
              selectedMmsi={selectedCandidate?.mmsi}
              onSelect={onSelectVessel}
            />
          </Reveal>
        </Block>
      )}
    </>
  );
}