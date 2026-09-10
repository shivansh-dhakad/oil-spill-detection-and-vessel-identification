/**
 * In-memory data store for VarunaDrishti with Supabase cloud persistence.
 *
 * Predictions are persisted to Supabase (when SUPABASE_URL + SUPABASE_SERVICE_KEY
 * are set) and pre-loaded from there on startup so data survives server restarts.
 */

const supabaseClient = require("./supabaseClient");

const REGIONS = [
  { name: "Bay of Bengal", lat: 12.34, lon: 78.9 },
  { name: "Strait of Malacca", lat: 2.15, lon: 102.3 },
  { name: "Gulf of Aden", lat: 12.78, lon: 45.02 },
  { name: "Arabian Sea", lat: 15.5, lon: 68.2 },
  { name: "South China Sea", lat: 10.2, lon: 113.9 },
  { name: "Persian Gulf", lat: 26.7, lon: 52.1 },
  { name: "Kerch Strait, Black Sea", lat: 45.28, lon: 36.65 },
  { name: "Black Sea", lat: 43.5, lon: 34.5 },
  { name: "Mediterranean Sea", lat: 35.5, lon: 18.0 },
  { name: "North Sea", lat: 56.0, lon: 3.0 },
  { name: "Gulf of Mexico", lat: 25.0, lon: -90.0 },
  { name: "Baltic Sea", lat: 58.5, lon: 19.5 },
];
// Beyond this many degrees from every known region, none of them is a
// meaningful label - "closest of an unrelated list" (e.g. tagging a Black
// Sea spill "Persian Gulf" because it happened to be the nearest hardcoded
// entry) is worse than admitting the region isn't in the demo list.
const REGION_MATCH_MAX_DEGREES = 10;

// ---------------------------------------------------------------------- //
// Haversine proximity ranking (distance-only ranking layered on top of the
// Bayesian attribution scores below - see ais_attribution.py::haversine_km
// for the source-of-truth implementation used by the ML pipeline itself).
// ---------------------------------------------------------------------- //
const EARTH_RADIUS_KM = 6371.0;

function haversineKm(lat1, lon1, lat2, lon2) {
  if ([lat1, lon1, lat2, lon2].some((v) => v == null || Number.isNaN(v))) return null;
  const toRad = (d) => (d * Math.PI) / 180;
  const dphi = toRad(lat2 - lat1);
  const dlambda = toRad(lon2 - lon1);
  const a =
    Math.sin(dphi / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dlambda / 2) ** 2;
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return EARTH_RADIUS_KM * c;
}

/** Rank colors per the investigation map legend: #1 dark red, #2 orange, #3 yellow, rest blue. */
function proximityColorForRank(rank) {
  if (rank === 1) return "#7f1d1d"; // dark red
  if (rank === 2) return "#f97316"; // orange
  if (rank === 3) return "#eab308"; // yellow
  return "#2563eb"; // blue
}

/**
 * Mutates `candidates` in place, adding Haversine-distance fields
 * (`distanceKm`) plus a `proximityRank`/`proximityColor` used to number and
 * color-code vessels wherever they're shown on the results page.
 *
 * The numbering intentionally now matches the same order as the Bayesian
 * attribution ranking already on each candidate (`c.rank`, set by
 * mapMlCandidate from the ML service's own attribution-likelihood order) -
 * previously this assigned a second, independent rank based purely on
 * sorting by distance, which meant the sidebar's "#1" and the proximity
 * table's "#1" could be two different vessels. Distance itself (and the
 * closest-vessel/average-distance summary stats below) are still real
 * Haversine facts, just no longer used to *order* the list.
 */
function attachProximityRanking(candidates, spillCenter) {
  candidates.forEach((c) => {
    let distanceKm = c.distanceKm;
    if (distanceKm == null && spillCenter && c.position) {
      distanceKm = haversineKm(spillCenter.lat, spillCenter.lon, c.position.latitude, c.position.longitude);
    }
    c.distanceKm = distanceKm != null ? +distanceKm.toFixed(2) : null;
    c.proximityRank = c.rank;
    c.proximityColor = proximityColorForRank(c.rank ?? 99);
  });

  const withKnownDistance = candidates.filter((c) => c.distanceKm != null);
  const closest = withKnownDistance.reduce(
    (best, c) => (best == null || c.distanceKm < best.distanceKm ? c : best),
    null
  );
  const avgDistanceKm = withKnownDistance.length
    ? +(withKnownDistance.reduce((sum, c) => sum + c.distanceKm, 0) / withKnownDistance.length).toFixed(2)
    : null;
  const vesselsOfInterest = candidates.filter(
    (c) =>
      (c.aisQualityFlags && c.aisQualityFlags.length > 0) ||
      c.confidenceTier === "PROBABLE_SOURCE_VESSEL" ||
      c.confidenceTier === "CANDIDATE_VESSEL"
  ).length;

  return {
    vesselsDetected: candidates.length,
    closestVessel: closest ? { name: closest.name, mmsi: closest.mmsi, distanceKm: closest.distanceKm } : null,
    averageDistanceKm: avgDistanceKm,
    vesselsOfInterest,
  };
}

// Predictions are populated only from real completed pipeline runs, via
// createPredictionFromMlResult() below - no seed/demo data.
let predictions = [];

let nextSeq = 1;
const readAlertIds = new Set();
const cancelledJobIds = new Set();

function listPredictions({ status, minConfidence, region, search } = {}) {
  let rows = [...predictions];
  if (status && status !== "all") rows = rows.filter((p) => p.detection === status);
  if (minConfidence) rows = rows.filter((p) => p.confidence >= Number(minConfidence));
  if (region) rows = rows.filter((p) => p.region.name.toLowerCase().includes(region.toLowerCase()));
  if (search) {
    const q = search.toLowerCase();
    rows = rows.filter(
      (p) =>
        p.id.toLowerCase().includes(q) ||
        p.region.name.toLowerCase().includes(q) ||
        p.candidates.some((c) => c.name.toLowerCase().includes(q) || c.mmsi.includes(q))
    );
  }
  return rows.sort((a, b) => new Date(b.acquiredAt) - new Date(a.acquiredAt));
}

function getPrediction(id) {
  return predictions.find((p) => p.id === id) || null;
}

function getStats() {
  const total = predictions.length;
  const confirmed = predictions.filter((p) => p.detection === "detected").length;
  const attributed = predictions.filter((p) => p.candidates.some((c) => c.probability >= 50)).length;
  const totalAreaKm2 = predictions.reduce((sum, p) => sum + (p.slickAreaKm2 || 0), 0);
  return {
    totalAcquisitions: total,
    confirmedSlicks: confirmed,
    incidenceRate: total ? +((confirmed / total) * 100).toFixed(1) : 0,
    attributionsMatched: attributed,
    attributionRate: confirmed ? +((attributed / confirmed) * 100).toFixed(1) : 0,
    totalMonitoredAreaKm2: 384200,
    totalSlickAreaKm2: +totalAreaKm2.toFixed(1),
  };
}

function listAlerts({ limit = 8 } = {}) {
  const max = Math.max(1, Math.min(Number(limit) || 8, 50));
  const alerts = predictions
    .filter((prediction) => prediction.detection === "detected")
    .sort((a, b) => new Date(b.acquiredAt) - new Date(a.acquiredAt))
    .map((prediction) => {
      const alertId = `ALERT-${prediction.id}`;
      return {
        alertId,
        incidentId: prediction.id,
        predictionId: prediction.id,
        title: `Oil spill detected in ${prediction.region.name}`,
        area: prediction.slickAreaKm2,
        confidence: prediction.confidence ?? null,
        isRead: readAlertIds.has(alertId) ? 1 : 0,
        createdAt: prediction.acquiredAt,
      };
    });

  return {
    alerts: alerts.filter((alert) => !alert.isRead).slice(0, max),
    unreadCount: alerts.filter((alert) => !alert.isRead).length,
  };
}

function markAlertRead(alertId) {
  const exists = predictions.some(
    (prediction) => prediction.detection === "detected" && `ALERT-${prediction.id}` === alertId
  );
  if (!exists) return false;
  readAlertIds.add(alertId);
  return true;
}

function cancelPredictionJob(jobId) {
  cancelledJobIds.add(jobId);
  const predictionId = jobToPrediction.get(jobId);
  if (predictionId) {
    predictions = predictions.filter((prediction) => prediction.id !== predictionId);
    jobToPrediction.delete(jobId);
  }
}

function isJobCancelled(jobId) {
  return cancelledJobIds.has(jobId);
}

// --------------------------------------------------------------------- //
// Real pipeline integration
// --------------------------------------------------------------------- //

function nearestRegionName(lat, lon) {
  if (lat == null || lon == null) return "Unclassified Waters";
  let best = REGIONS[0];
  let bestDist = Infinity;
  for (const r of REGIONS) {
    const d = Math.hypot(r.lat - lat, r.lon - lon);
    if (d < bestDist) {
      bestDist = d;
      best = r;
    }
  }
  // Don't force-label a spill with whichever hardcoded region happens to be
  // "least far away" when none of them are actually close (see REGIONS
  // above) - that produced misleading labels like tagging a Kerch Strait /
  // Black Sea incident "Persian Gulf" purely because it was the nearest of
  // an unrelated list.
  if (bestDist > REGION_MATCH_MAX_DEGREES) {
    const hemiLat = lat >= 0 ? "N" : "S";
    const hemiLon = lon >= 0 ? "E" : "W";
    return `Unclassified Waters (${Math.abs(lat).toFixed(1)}°${hemiLat}, ${Math.abs(lon).toFixed(1)}°${hemiLon})`;
  }
  return best.name;
}

function probabilityLabel(probability) {
  if (probability == null) return "Unscored";
  return probability >= 75 ? "High Prob" : probability >= 45 ? "Moderate" : probability >= 20 ? "Low" : "Negligible";
}

function trajectoryMatchLabel(probability) {
  if (probability == null) return "Insufficient Data";
  return probability >= 75 ? "High Match" : probability >= 45 ? "Med Drift" : "Low Match";
}

/** Maps one ML-service candidate (see ais_attribution.py's run_attribution) onto
 * the shape the frontend's PredictionResults/History pages already render. */
function mapMlCandidate(c, rank) {
  const evidence = c.evidence || {};
  const rawOverall =
    c.overall_score != null ? Math.round(c.overall_score * 100) : null;
  const relLikelihood =
    c.relative_attribution_likelihood_percent != null
      ? Math.round(c.relative_attribution_likelihood_percent)
      : null;

  // Use relative likelihood if computed and positive, otherwise raw overall match score
  const probability = (relLikelihood != null && relLikelihood > 0) ? relLikelihood : (rawOverall ?? 0);

  const proximityKm = evidence.spatial_distance_km ?? null;
  const timeDeltaMin =
    evidence.temporal_diff_minutes != null
      ? Math.round(evidence.temporal_diff_minutes)
      : evidence.temporal_gap_hours != null
      ? Math.round(evidence.temporal_gap_hours * 60)
      : null;

  return {
    rank,
    name: c.name || "Unknown Vessel",
    mmsi: c.mmsi || "N/A",
    vesselType: c.vessel_type || "Unknown",
    flag: c.flag || "UNKNOWN",
    probability: probability ?? 0,
    overallScore: rawOverall,
    relativeLikelihood: relLikelihood,
    confidenceTier: c.confidence_tier || null,
    label: probabilityLabel(probability),
    proximityNm: proximityKm != null ? +(proximityKm * 0.539957).toFixed(2) : null,
    timeDeltaMin,
    trajectoryMatch: trajectoryMatchLabel(probability),
    speedKts: evidence.vessel_sog_knots != null ? +evidence.vessel_sog_knots.toFixed(1) : null,
    headingDeg: evidence.vessel_cog_deg != null ? Math.round(evidence.vessel_cog_deg) : null,
    loaBeamM: c.loaBeamM || null,
    draftM: c.draftM || null,
    imo: c.imo || null,
    callsign: c.callsign || null,
    source: c.source || null,
    dataMode: c.data_mode || "PRESENCE_ONLY",
    explanation: c.explanation || null,
    // Haversine great-circle distance from the spill origin, in km - the
    // primary sort key for the proximity/attribution investigation table
    // (independent of the Bayesian probability score above). attachProximityRanking()
    // fills this in from spillCenter+position when the ML service didn't
    // already compute it (e.g. PRESENCE_ONLY candidates).
    distanceKm: proximityKm != null ? +proximityKm.toFixed(2) : null,
    // Timestamp of the position used above - the last real AIS fix time when
    // a track is available, otherwise the end of the presence window.
    positionTimestamp:
      (c.track_points && c.track_points.length ? c.track_points[c.track_points.length - 1].time : null) ||
      evidence.transmission_date_to ||
      null,
    position: c.position || null, // { latitude, longitude } | null - for the map
    // Vessel's best-available position AT the estimated spill release time
    // (interpolated between real fixes where possible) - drawn as a dotted
    // line from the spill origin to this point on the map. null when no
    // hindcast origin/time was available to evaluate against.
    positionAtSpillTime: c.position_at_spill_time
      ? { lat: c.position_at_spill_time.latitude, lon: c.position_at_spill_time.longitude, extrapolated: !!c.position_at_spill_time.extrapolated }
      : null,
    // Full AIS fix history for this vessel, in chronological order - drawn as
    // the vessel's actual path on the map when its card is selected.
    // Empty for PRESENCE_ONLY candidates (no real track, just a last-seen cell).
    trackPoints: (c.track_points || []).map((p) => ({
      lat: p.lat,
      lon: p.lon,
      time: p.time,
      sog: p.sog,
      cog: p.cog,
    })),
    temporalScore:
      evidence.temporal_window_score != null
        ? Math.round(evidence.temporal_window_score * 100)
        : evidence.temporal_score != null
        ? Math.round(evidence.temporal_score * 100)
        : null,
    qualityScore:
      evidence.data_quality_score != null
        ? Math.round(evidence.data_quality_score * 100)
        : null,
    spatialScore:
      evidence.spatial_score != null
        ? Math.round(evidence.spatial_score * 100)
        : null,
    observationsCount: evidence.observations_count ?? 0,
    transmissionFrom: evidence.transmission_date_from || null,
    transmissionTo: evidence.transmission_date_to || null,
    aisQualityFlags: evidence.ais_quality_flags || [],
  };
}

/**
 * Converts a completed ML-service pipeline result (pipeline.py's `result`
 * dict, as returned by GET /api/spill/jobs/:jobId) into the Prediction shape
 * the rest of this app already knows how to render, and stores it.
 */
function createPredictionFromMlResult(mlResult, { jobId, originalName, sourceType, sensor } = {}) {
  const id = `PRED-2025-${String(nextSeq++).padStart(3, "0")}`;
  const detectionInfo = mlResult.detection || {};
  const isOil = !!detectionInfo.is_oil_spill;
  const geo = mlResult.geolocation || null;
  const envConditions = mlResult.environmental_conditions || {};
  const env = envConditions.detection_conditions || {};
  const drift = mlResult.drift_hindcast || {};
  const safeMetadata = mlResult.safe_metadata || null;
  const spillGeometry = mlResult.spill_geometry || null;
  const attribution = mlResult.vessel_attribution || null;
  const rawMlCandidates = (attribution && attribution.candidates) || [];
  // Keep more than the Bayesian "top 5" panel needs so the Haversine proximity
  // table/top-10 panel below has a real pool of nearby vessels to rank and
  // display, not just the handful of highest-likelihood suspects.
  const mlCandidates = rawMlCandidates.slice(0, 20);
  const candidatesEvaluated = (attribution && attribution.candidates_evaluated) || rawMlCandidates.length;

  const lat = geo ? geo.latitude : null;
  const lon = geo ? geo.longitude : null;
  const confidence = detectionInfo.confidence_percent ?? 0;
  const spillCenter = geo ? { lat: geo.latitude, lon: geo.longitude } : null;

  const candidates = mlCandidates.map((c, i) => mapMlCandidate(c, i + 1));
  const investigationSummary = attachProximityRanking(candidates, spillCenter);

  const spillAreaKm2 =
    mlResult.spill_geometry && mlResult.spill_geometry.area_km2 != null
      ? +mlResult.spill_geometry.area_km2.toFixed(2)
      : isOil
      ? +(detectionInfo.spill_coverage_percentage || 0).toFixed(2) // fallback: coverage %, not km2 - flagged via areaIsCoveragePercent
      : 0;

  const record = {
    id,
    jobId,
    sensor: sensor || (mlResult.safe_metadata && mlResult.safe_metadata.satellite) || "Sentinel-1",
    sourceType: sourceType || (mlResult.input_type === "Sentinel-1 SAFE" ? "safe_zip" : "sar_image"),
    originalName: originalName || null,
    acquiredAt: (geo && geo.detection_timestamp_utc) || new Date().toISOString(),
    region: { name: nearestRegionName(lat, lon), lat: lat ?? 0, lon: lon ?? 0 },
    status: "completed",
    detection: isOil ? "detected" : "clean",
    slickAreaKm2: spillAreaKm2,
    areaIsCoveragePercent: !(mlResult.spill_geometry && mlResult.spill_geometry.area_km2 != null) && isOil,
    modelName:
      (mlResult.report && mlResult.report.model_name) ||
      (mlResult.safe_metadata && mlResult.safe_metadata.model_name) ||
      (mlResult.model_info && mlResult.model_info.name) ||
      "SegFormer-B2 (oil-spill segmentation)",
    weatherWindKts: env.wind_speed_ms != null ? +(env.wind_speed_ms * 1.94384).toFixed(1) : null,
    weatherWindDir: env.wind_direction_deg != null ? `${Math.round(env.wind_direction_deg)}°` : null,
    currentMs: env.current_velocity_ms != null ? +env.current_velocity_ms.toFixed(2) : null,
    currentDir: env.current_direction_deg != null ? `${Math.round(env.current_direction_deg)}°` : null,
    // Backward-hindcast estimate of when the spill was released, e.g.
    // "2025-06-15 08:20 UTC" - null when the hindcast couldn't be run.
    spillOriginTime: drift.status === "ESTIMATED" ? drift.estimated_start_str || null : null,
    severity: !isOil ? "clean" : confidence > 90 ? "critical" : "advisory",
    candidates,
    candidatesEvaluated,
    investigationSummary,
    attributionStatement: attribution ? attribution.attribution_statement : null,
    attributionStatus: attribution ? attribution.status : "SKIPPED",
    disclaimer: attribution ? attribution.disclaimer : null,
    files: {
      jobId,
      mask: mlResult.files ? mlResult.files.mask : null,
      overlay: mlResult.files ? mlResult.files.overlay : null,
      // Small downscaled JPEG for the results-page preview - falls back to
      // the full-resolution overlay for older ml_service results that don't
      // have one yet.
      overlayThumbnail: mlResult.files
        ? mlResult.files.overlay_thumbnail || mlResult.files.overlay
        : null,
      trajectoryCsv: mlResult.files ? mlResult.files.trajectory_csv : null,
      trajectoryMap: mlResult.files ? mlResult.files.trajectory_map : null,
    },
    map: {
      spillCenter: geo ? { lat: geo.latitude, lon: geo.longitude } : null,
      // Real georeferenced slick boundary (one ring per detected patch), only
      // present for SAFE-archive inputs that carry full scene geolocation
      // grid points. A plain SAR image upload only has a single centroid, so
      // the frontend falls back to a circle approximation when this is empty.
      spillPolygon:
        mlResult.spill_geometry && Array.isArray(mlResult.spill_geometry.polygon_patches)
          ? mlResult.spill_geometry.polygon_patches
          : [],
      driftOrigin:
        drift.status === "ESTIMATED" && drift.origin_latitude != null
          ? { lat: drift.origin_latitude, lon: drift.origin_longitude }
          : null,
      finalParticle:
        drift.final_particle_latitude != null
          ? { lat: drift.final_particle_latitude, lon: drift.final_particle_longitude }
          : null,
      trajectoryPoints: (mlResult.drift_trajectory_points || []).map((p) => ({
        lat: p.latitude,
        lon: p.longitude,
        time: p.time_utc,
      })),
      vessels: candidates
        .filter((c) => c.position)
        .map((c) => ({
          name: c.name,
          mmsi: c.mmsi,
          imo: c.imo,
          vesselType: c.vesselType,
          flag: c.flag,
          probability: c.probability,
          lat: c.position.latitude,
          lon: c.position.longitude,
          headingDeg: c.headingDeg ?? null,
          speedKts: c.speedKts ?? null,
          distanceKm: c.distanceKm,
          proximityRank: c.proximityRank,
          proximityColor: c.proximityColor,
          timestamp: c.positionTimestamp,
        })),
    },
    elapsedSeconds: mlResult.elapsed_seconds ?? null,
    // Full pipeline detail beyond what the map/vessel-attribution panels
    // need - powers the beautified full-analysis report (all fields pass
    // through mostly as-is from pipeline.py's result dict; None/absent stays
    // null rather than getting defaulted, so the report can show "not
    // available" honestly instead of a fabricated zero).
    report: {
      inputType: mlResult.input_type || null,
      originalName: originalName || null,
      elapsedSeconds: mlResult.elapsed_seconds ?? null,
      detection: {
        prediction: detectionInfo.prediction || null,
        confidencePercent: detectionInfo.confidence_percent ?? null,
        spillCoveragePercent: detectionInfo.spill_coverage_percentage ?? null,
        oilPixelCount: detectionInfo.oil_pixel_count ?? null,
        totalPixels: detectionInfo.total_pixels ?? null,
      },
      safeMetadata: safeMetadata
        ? {
            satellite: safeMetadata.satellite || null,
            productType: safeMetadata.product_type || null,
            polarizationUsed: safeMetadata.polarization_used || null,
            orbitNumber: safeMetadata.orbit_number || null,
            orbitDirection: safeMetadata.orbit_direction || null,
            acquisitionStart: safeMetadata.acquisition_start || null,
            acquisitionStop: safeMetadata.acquisition_stop || null,
            dimensions: safeMetadata.dimensions || null,
            rangePixelSpacingM: safeMetadata.range_pixel_spacing_m ?? null,
            azimuthPixelSpacingM: safeMetadata.azimuth_pixel_spacing_m ?? null,
          }
        : null,
      spillGeometry: spillGeometry
        ? {
            areaKm2: spillGeometry.area_km2 ?? null,
            areaConfidenceIntervalKm2: spillGeometry.area_confidence_interval_km2 ?? null,
            lengthKm: spillGeometry.length_km ?? null,
            widthKm: spillGeometry.width_km ?? null,
            perimeterKm: spillGeometry.perimeter_km ?? null,
            numSpillPatches: spillGeometry.num_spill_patches ?? null,
            geolocationSource: spillGeometry.geolocation_source || null,
            pixelGroundSizeM: spillGeometry.pixel_ground_size_m ?? null,
            nativePixelSpacingM: spillGeometry.native_pixel_spacing_m ?? null,
            pixelCountAreaKm2: spillGeometry.pixel_count_area_km2 ?? null,
            areaDiscrepancyPct: spillGeometry.area_discrepancy_pct ?? null,
            areaEstimatesConsistent: spillGeometry.area_estimates_consistent ?? null,
          }
        : null,
      environmental: {
        hasValidCurrents: !!envConditions.has_valid_currents,
        hasValidWind: !!envConditions.has_valid_wind,
        warnings: envConditions.warnings || [],
        currentVelocityMs: env.current_velocity_ms ?? null,
        currentDirectionDeg: env.current_direction_deg ?? null,
        currentTimestampStr: env.current_timestamp_str || null,
        windSpeedMs: env.wind_speed_ms ?? null,
        windSpeedKmh: env.wind_speed_kmh ?? null,
        windDirectionDeg: env.wind_direction_deg ?? null,
        conditionsTimestampStr: env.timestamp_str || null,
        source: env.source || null,
      },
      drift: {
        status: drift.status || null,
        reason: drift.reason || null,
        estimatedStartStr: drift.estimated_start_str || null,
        earliestPlausibleStr: drift.earliest_plausible_str || null,
        latestPlausibleStr: drift.latest_plausible_str || null,
        estimatedDurationHours: drift.estimated_duration_hours ?? null,
        uncertaintyWindowHours: drift.uncertainty_window_hours ?? null,
        lookbackPeriodHours: drift.lookback_period_hours ?? null,
        originLatitude: drift.origin_latitude ?? null,
        originLongitude: drift.origin_longitude ?? null,
        originDistanceKm: drift.origin_distance_km ?? null,
        originOnLand: drift.origin_on_land ?? null,
        originSelectionMethod: drift.origin_selection_method || null,
        simulationEngine: drift.simulation_engine || null,
        disclaimer: drift.disclaimer || null,
        insituCurrentUsed: drift.insitu_current_used ?? false,
        insituPlatformId: drift.insitu_platform_id || null,
        insituDistanceKm: drift.insitu_distance_km ?? null,
      },
      geolocationNote: (geo && geo.note) || null,
    },
  };

  predictions.unshift(record);

  // Persist to Supabase in background
  if (supabaseClient.isSupabaseConfigured()) {
    supabaseClient.savePrediction(record).catch((err) => {
      console.warn("[Store] Background Supabase save error:", err.message);
    });
  }

  return record;
}

// job_id -> prediction id, so repeated status polls after completion don't
// create duplicate prediction records.
const jobToPrediction = new Map();

function getPredictionIdForJob(jobId) {
  return jobToPrediction.get(jobId) || null;
}

function linkJobToPrediction(jobId, predictionId) {
  jobToPrediction.set(jobId, predictionId);
}

/**
 * Hydrate predictions from Supabase on backend startup.
 */
async function initFromSupabase() {
  if (!supabaseClient.isSupabaseConfigured()) return;
  try {
    const remote = await supabaseClient.loadPredictions(100);
    if (remote && remote.length > 0) {
      console.log(`[Store] Hydrated ${remote.length} prediction(s) from Supabase.`);
      const existingIds = new Set(predictions.map((p) => p.id));
      for (const p of remote) {
        if (!existingIds.has(p.id)) {
          predictions.push(p);
          if (p.jobId) jobToPrediction.set(p.jobId, p.id);
        }
      }
      predictions.sort((a, b) => new Date(b.acquiredAt) - new Date(a.acquiredAt));
    }
  } catch (err) {
    console.warn("[Store] Failed to initialize from Supabase:", err.message);
  }
}

module.exports = {
  listPredictions,
  listAlerts,
  markAlertRead,
  cancelPredictionJob,
  isJobCancelled,
  getPrediction,
  getStats,
  createPredictionFromMlResult,
  getPredictionIdForJob,
  linkJobToPrediction,
  initFromSupabase,
};