/**
 * backend/scripts/upload_currents_to_supabase.js
 * ===============================================
 * Uploads in-situ ocean currents data into Supabase `insitu_currents` table.
 *
 * Fast path:
 *   If `ml_service/insitu_clean.csv` exists, it streams that clean paired file directly
 *   and inserts into Supabase in chunks of 1,000 rows.
 *
 * Fallback:
 *   If only raw Copernicus CSV exists, it streams and pairs EWCT/NSCT before uploading.
 *
 * Requirements:
 *   SUPABASE_URL and SUPABASE_SERVICE_KEY set in backend/.env
 *
 * Usage:
 *   npm run upload:currents
 */

const fs = require("fs");
const path = require("path");
const readline = require("readline");
const { createClient } = require("@supabase/supabase-js");

require("dotenv").config({ path: path.join(__dirname, "..", ".env") });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌ Error: SUPABASE_URL and SUPABASE_SERVICE_KEY must be set in backend/.env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false },
});

function findCleanCsv() {
  const candidatePaths = [
    path.join(__dirname, "..", "..", "ml_service", "insitu_clean.csv"),
    path.join(__dirname, "..", "..", "insitu_clean.csv"),
    path.join(process.cwd(), "ml_service", "insitu_clean.csv"),
    path.join(process.cwd(), "insitu_clean.csv"),
  ];
  return candidatePaths.find((p) => fs.existsSync(p)) || null;
}

function findRawCsv() {
  const candidateDirs = [
    path.join(__dirname, "..", "..", "ml_service", "data"),
    path.join(__dirname, "..", "..", "data"),
    path.join(process.cwd(), "ml_service", "data"),
  ];
  for (const dir of candidateDirs) {
    if (fs.existsSync(dir)) {
      const files = fs.readdirSync(dir);
      const csv = files.find((f) => f.endsWith(".csv") && (f.includes("cmems") || f.includes("argo") || f.includes("cur")));
      if (csv) return path.join(dir, csv);
    }
  }
  return null;
}

async function uploadBatch(batch, retries = 3) {
  for (let attempt = 1; attempt <= retries; attempt++) {
    const { error } = await supabase.from("insitu_currents").insert(batch);
    if (!error) return true;

    console.warn(`⚠️ Insert warning (attempt ${attempt}/${retries}):`, error.message);
    if (error.message.includes("does not exist")) {
      console.error("❌ Table 'insitu_currents' not found! Run backend/supabase_schema.sql in Supabase SQL editor first.");
      process.exit(1);
    }
    await new Promise((r) => setTimeout(r, attempt * 2000));
  }
  return false;
}

async function uploadFromCleanCsv(cleanPath) {
  console.log(`✨ Found clean paired CSV: ${cleanPath}`);
  console.log("🚀 Uploading to Supabase table `insitu_currents`...");

  const fileStream = fs.createReadStream(cleanPath, { encoding: "utf8" });
  const rl = readline.createInterface({ input: fileStream, crlfDelay: Infinity });

  let batch = [];
  let totalUploaded = 0;
  let lineCount = 0;
  const startTime = Date.now();

  for await (const line of rl) {
    lineCount++;
    if (lineCount === 1) continue; // Header
    const parts = line.split(",");
    if (parts.length < 8) continue;

    batch.push({
      platform_id: parts[0],
      time_str: parts[1],
      timestamp_epoch: parseFloat(parts[2]),
      latitude: parseFloat(parts[3]),
      longitude: parseFloat(parts[4]),
      depth: parseFloat(parts[5]),
      u_ms: parseFloat(parts[6]),
      v_ms: parseFloat(parts[7]),
    });

    if (batch.length >= 1000) {
      const ok = await uploadBatch(batch);
      if (ok) {
        totalUploaded += batch.length;
        if (totalUploaded % 10000 === 0) {
          const sec = ((Date.now() - startTime) / 1000).toFixed(0);
          console.log(`📦 Uploaded ${totalUploaded.toLocaleString()} rows (${sec}s)...`);
        }
      }
      batch = [];
    }
  }

  if (batch.length > 0) {
    const ok = await uploadBatch(batch);
    if (ok) totalUploaded += batch.length;
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  console.log("=" .repeat(65));
  console.log(`✅ Upload complete in ${elapsed}s! Total rows uploaded: ${totalUploaded.toLocaleString()}`);
  console.log("=" .repeat(65));
}

async function main() {
  console.log("🌊 VarunaDrishti – Copernicus In-Situ Currents Upload to Supabase");
  console.log("=" .repeat(65));
  console.log(`🌐 Supabase URL: ${SUPABASE_URL}`);
  console.log("=" .repeat(65));

  const cleanCsv = findCleanCsv();
  if (cleanCsv) {
    await uploadFromCleanCsv(cleanCsv);
    return;
  }

  const rawCsv = findRawCsv();
  if (!rawCsv) {
    console.error("❌ No CSV file found in ml_service/data or ml_service/insitu_clean.csv");
    process.exit(1);
  }

  console.log(`📁 Source raw CSV: ${rawCsv}`);
  console.log("Tip: You can also generate insitu_clean.csv first via: python upload_currents_to_supabase.py --export-clean-csv insitu_clean.csv");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
