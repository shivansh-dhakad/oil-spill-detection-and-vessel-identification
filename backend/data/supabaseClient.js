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
 * Actually talk to Supabase at startup (not just check that env vars are
 * present) so misconfiguration - wrong project URL, wrong key, RLS blocking
 * the service role, table missing/renamed, etc - shows up as a clear log
 * line immediately instead of silently failing on every later save (see
 * savePrediction()'s swallowed `console.warn`, which is easy to miss buried
 * in request logs).
 *
 * Returns { ok: boolean, reason?: string }.
 */
async function verifyConnection() {
  if (!supabase) {
    return {
      ok: false,
      reason:
        "SUPABASE_URL / SUPABASE_SERVICE_KEY (or SUPABASE_KEY) not set - running in in-memory mode. " +
        "Predictions will NOT survive a server restart.",
    };
  }
  try {
    // Cheapest possible real round-trip: count rows, don't fetch any.
    const { error, count } = await supabase
      .from("predictions")
      .select("id", { count: "exact", head: true });

    if (error) {
      // Common causes: wrong key (anon key instead of service_role - RLS
      // blocks the read/write), table doesn't exist yet (run
      // supabase_schema.sql), or wrong SUPABASE_URL/project.
      return { ok: false, reason: `Supabase reachable but query failed: ${error.message}` };
    }
    return { ok: true, reason: `Connected. predictions table currently has ${count ?? "?"} row(s).` };
  } catch (err) {
    return { ok: false, reason: `Could not reach Supabase at ${SUPABASE_URL}: ${err.message}` };
  }
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
    // NOTE: store.js's field is named `areaIsCoveragePercent` (not
    // `areaIsCoveragePct`) - this used to only ever match the `?? false`
    // fallback and silently wrote `false` for every row regardless of the
    // real value.
    area_is_coverage_pct: pred.areaIsCoveragePercent ?? pred.areaIsCoveragePct ?? pred.area_is_coverage_pct ?? false,
    model_name: pred.modelName || pred.model_name || null,
    severity: pred.severity || null,
    weather_wind_kts: pred.weatherWindKts ?? pred.weather?.windKts ?? pred.weather_wind_kts ?? null,
    weather_wind_dir: pred.weatherWindDir ?? pred.weather?.windDir ?? pred.weather_wind_dir ?? null,
    current_ms: pred.currentMs ?? pred.weather?.currentMs ?? pred.current_ms ?? null,
    current_dir: pred.currentDir ?? pred.weather?.currentDir ?? pred.current_dir ?? null,
    spill_origin_time: pred.spillOriginTime || pred.weather?.spillOriginTime || pred.spill_origin_time || null,
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
          // Same fallback-rebuild fix as store.js's map.vessels builder:
          // without this, rows saved before this fix (whose stored
          // map_data.vessels lacks the field) rebuild vessels from
          // `candidates` here but still drop positionAtSpillTime, so the
          // dotted "origin -> vessel at spill time" line has nothing to
          // draw to after a DB-loaded reload.
          positionAtSpillTime: candidate.positionAtSpillTime || null,
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
      console.error(
        `[Supabase] FAILED to persist prediction ${pred.id} - it exists only in-memory and will be ` +
        `lost on restart. Reason: ${error.message} (code: ${error.code || "n/a"})`
      );
      if (error.code === "42501" || /row-level security/i.test(error.message || "")) {
        console.error(
          "[Supabase] This looks like an RLS policy rejection - confirm SUPABASE_SERVICE_KEY is the " +
          "*service_role* key (not the anon/public key) from Project Settings > API."
        );
      }
      return null;
    }
    console.log(`[Supabase] ✅ Saved prediction ${pred.id} (job ${pred.jobId || pred.job_id || "n/a"}).`);
    return fromSupabaseRow(data);
  } catch (err) {
    console.error(`[Supabase] Error saving prediction ${pred.id}:`, err.message);
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
  verifyConnection,
  savePrediction,
  loadPredictions,
  getPredictionById,
};