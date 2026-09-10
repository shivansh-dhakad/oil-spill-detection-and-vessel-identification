/**
 * supabaseClient.js
 * =================
 * Supabase client module for VarunaDrishti.
 * Connects to Supabase to persist and query oil spill pipeline prediction results.
 * Uses the SERVICE ROLE key so backend queries bypass RLS.
 *
 * Required env vars (backend/.env):
 *   SUPABASE_URL=https://your-project.supabase.co
 *   SUPABASE_SERVICE_KEY=your_service_role_key
 */

const { createClient } = require("@supabase/supabase-js");

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

let supabase = null;

if (SUPABASE_URL && SUPABASE_SERVICE_KEY) {
  try {
    supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, {
      auth: { persistSession: false },
    });
    console.log("[Supabase] Connected to project:", SUPABASE_URL);
  } catch (err) {
    console.warn("[Supabase] Failed to initialize client:", err.message);
  }
} else {
  console.log("[Supabase] SUPABASE_URL / SUPABASE_SERVICE_KEY not provided. Running in in-memory mode.");
}

/**
 * Check if Supabase client is available and active.
 */
function isSupabaseConfigured() {
  return supabase !== null;
}

/**
 * Convert an in-memory prediction record to the Supabase predictions table format.
 */
function toSupabaseRow(pred) {
  return {
    id: pred.id,
    job_id: pred.jobId || pred.job_id || null,
    sensor: pred.sensor || null,
    source_type: pred.sourceType || pred.source_type || null,
    original_name: pred.originalName || pred.original_name || null,
    acquired_at: pred.acquiredAt || pred.acquired_at || new Date().toISOString(),
    region_name: pred.region?.name || pred.region_name || null,
    region_lat: pred.region?.lat ?? pred.region_lat ?? null,
    region_lon: pred.region?.lon ?? pred.region_lon ?? null,
    status: pred.status || "completed",
    detection: pred.detection || "detected",
    confidence: pred.confidence ?? null,
    slick_area_km2: pred.slickAreaKm2 ?? pred.slick_area_km2 ?? null,
    area_is_coverage_pct: pred.areaIsCoveragePct ?? pred.area_is_coverage_pct ?? false,
    model_name: pred.modelName || pred.model_name || null,
    severity: pred.severity || null,
    weather_wind_kts: pred.weather?.windKts ?? pred.weather_wind_kts ?? null,
    weather_wind_dir: pred.weather?.windDir ?? pred.weather_wind_dir ?? null,
    current_ms: pred.weather?.currentMs ?? pred.current_ms ?? null,
    current_dir: pred.weather?.currentDir ?? pred.current_dir ?? null,
    spill_origin_time: pred.weather?.spillOriginTime || pred.spill_origin_time || null,
    attribution_status: pred.attributionStatus || pred.attribution_status || null,
    attribution_statement: pred.attributionStatement || pred.attribution_statement || null,
    disclaimer: pred.disclaimer || null,
    candidates_evaluated: pred.candidatesEvaluated ?? pred.candidates_evaluated ?? 0,
    elapsed_seconds: pred.elapsedSeconds ?? pred.elapsed_seconds ?? null,
    candidates: pred.candidates || [],
    investigation_summary: pred.investigationSummary || pred.investigation_summary || {},
    map_data: pred.map || pred.mapData || pred.map_data || {},
    report: pred.report || {},
    files: pred.files || {},
  };
}

/**
 * Convert a Supabase row back to frontend camelCase prediction format.
 */
function fromSupabaseRow(row) {
  const candidates = row.candidates || [];
  const storedMap = row.map_data && typeof row.map_data === "object" ? row.map_data : {};
  const report = row.report && typeof row.report === "object" ? row.report : {};
  const driftReport = report.drift && typeof report.drift === "object" ? report.drift : {};
  const spillCenter = storedMap.spillCenter || (
    row.region_lat != null && row.region_lon != null
      ? { lat: row.region_lat, lon: row.region_lon }
      : null
  );
  const vessels = Array.isArray(storedMap.vessels) && storedMap.vessels.length
    ? storedMap.vessels
    : candidates
        .filter((candidate) => candidate.position?.latitude != null && candidate.position?.longitude != null)
        .map((candidate) => ({
          name: candidate.name,
          mmsi: candidate.mmsi,
          imo: candidate.imo || null,
          vesselType: candidate.vesselType || null,
          flag: candidate.flag || null,
          probability: candidate.probability ?? null,
          lat: candidate.position.latitude,
          lon: candidate.position.longitude,
          headingDeg: candidate.headingDeg ?? null,
          speedKts: candidate.speedKts ?? null,
          distanceKm: candidate.distanceKm ?? null,
          proximityRank: candidate.proximityRank ?? candidate.rank ?? null,
          proximityColor: candidate.proximityColor || null,
          timestamp: candidate.positionTimestamp || null,
        }));
  const driftOrigin = storedMap.driftOrigin || (
    driftReport.originLatitude != null && driftReport.originLongitude != null
      ? { lat: driftReport.originLatitude, lon: driftReport.originLongitude }
      : null
  );

  return {
    id: row.id,
    jobId: row.job_id,
    sensor: row.sensor,
    sourceType: row.source_type,
    originalName: row.original_name,
    acquiredAt: row.acquired_at,
    region: {
      name: row.region_name,
      lat: row.region_lat,
      lon: row.region_lon,
    },
    status: row.status,
    detection: row.detection,
    confidence: row.confidence,
    slickAreaKm2: row.slick_area_km2,
    areaIsCoveragePct: row.area_is_coverage_pct,
    modelName: row.model_name,
    severity: row.severity,
    weather: {
      windKts: row.weather_wind_kts,
      windDir: row.weather_wind_dir,
      currentMs: row.current_ms,
      currentDir: row.current_dir,
      spillOriginTime: row.spill_origin_time,
    },
    attributionStatus: row.attribution_status,
    attributionStatement: row.attribution_statement,
    disclaimer: row.disclaimer,
    candidatesEvaluated: row.candidates_evaluated,
    elapsedSeconds: row.elapsed_seconds,
    candidates,
    investigationSummary: row.investigation_summary || {},
    map: {
      ...storedMap,
      spillCenter,
      vessels,
      driftOrigin,
    },
    report: row.report || {},
    files: row.files || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Save or update a completed prediction in Supabase.
 */
async function savePrediction(pred) {
  if (!supabase) return null;

  try {
    const row = toSupabaseRow(pred);
    const { data, error } = await supabase
      .from("predictions")
      .upsert(row, { onConflict: "id" })
      .select()
      .single();

    if (error) {
      console.warn("[Supabase] Failed to save prediction:", error.message);
      return null;
    }
    return fromSupabaseRow(data);
  } catch (err) {
    console.warn("[Supabase] Error saving prediction:", err.message);
    return null;
  }
}

/**
 * Load all predictions from Supabase on server startup.
 */
async function loadPredictions(limit = 100) {
  if (!supabase) return [];

  try {
    const { data, error } = await supabase
      .from("predictions")
      .select("*")
      .order("acquired_at", { ascending: false })
      .limit(limit);

    if (error) {
      console.warn("[Supabase] Failed to load predictions:", error.message);
      return [];
    }
    return (data || []).map(fromSupabaseRow);
  } catch (err) {
    console.warn("[Supabase] Error loading predictions:", err.message);
    return [];
  }
}

/**
 * Fetch a single prediction by ID.
 */
async function getPredictionById(id) {
  if (!supabase) return null;

  try {
    const { data, error } = await supabase
      .from("predictions")
      .select("*")
      .eq("id", id)
      .maybeSingle();

    if (error || !data) return null;
    return fromSupabaseRow(data);
  } catch (err) {
    console.warn("[Supabase] Error getting prediction:", err.message);
    return null;
  }
}

module.exports = {
  supabase,
  isSupabaseConfigured,
  savePrediction,
  loadPredictions,
  getPredictionById,
};
