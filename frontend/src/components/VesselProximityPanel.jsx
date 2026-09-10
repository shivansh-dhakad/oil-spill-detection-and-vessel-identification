import { useMemo, useState } from "react";

function rankBadgeStyle(rank) {
  if (rank === 1) return "bg-[#7f1d1d] text-white";
  if (rank === 2) return "bg-orange-500 text-white";
  if (rank === 3) return "bg-yellow-500 text-slate-900";
  return "bg-blue-600 text-white";
}

function fmtCoord(v) {
  return v != null ? v.toFixed(4) : "—";
}

function fmtTimestamp(ts) {
  if (!ts) return "—";
  try {
    const d = new Date(ts);
    if (isNaN(d.getTime())) return String(ts);
    return d.toISOString().slice(0, 19).replace("T", " ") + "Z";
  } catch {
    return String(ts);
  }
}

/**
 * Vessel traffic investigation panel: an investigation summary strip
 * (vessel count, closest vessel by real distance, average distance,
 * vessels of interest), a "Top 10" quick-scan panel, and the full ranked
 * vessel table (Rank / Name / MMSI / IMO / Type / Flag / Lat / Lon /
 * Timestamp / Distance) with the #1-#3 / rest color highlighting used on the
 * map. Ranking here matches the Bayesian attribution-likelihood order shown
 * in the sidebar panel elsewhere on the page (same `rank`/`proximityRank`
 * - see attachProximityRanking() in backend/data/store.js) so vessel #1 is
 * the same vessel in both places; distance itself is still shown as a
 * column and used for the summary stats, just not for ordering the rows.
 */
export default function VesselProximityPanel({ vessels = [], summary = null, selectedMmsi = null, onSelect }) {
  const [showAll, setShowAll] = useState(false);

  // Sort order now matches the sidebar's attribution ranking (proximityRank
  // mirrors that same order - see attachProximityRanking() in
  // backend/data/store.js), not a separate distance-only sort, so vessel
  // #1 here is the same vessel as #1 in the sidebar.
  const ranked = useMemo(
    () =>
      [...vessels]
        .filter((v) => v.proximityRank != null)
        .sort((a, b) => a.proximityRank - b.proximityRank),
    [vessels]
  );

  const top10 = ranked.slice(0, 10);
  const visibleRows = showAll ? ranked : top10;

  if (ranked.length === 0) return null;

  return (
    <section className="w-full bg-white rounded-2xl border border-border-soft shadow-sm p-5">
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-slate-100">
        <div>
          <div className="flex items-center gap-2">
            <span className="material-symbols-outlined text-rose-600 text-xl">radar</span>
            <h3 className="text-base font-bold text-slate-900 tracking-tight">
              Vessel Traffic Investigation
            </h3>
          </div>
          <p className="text-xs text-slate-500 mt-0.5">
            {ranked.length} vessel{ranked.length === 1 ? "" : "s"} ranked by attribution likelihood - same order
            as the panel above
          </p>
        </div>
        {ranked.length > 10 && (
          <button
            onClick={() => setShowAll((s) => !s)}
            className="px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 border border-slate-200 text-xs font-semibold text-slate-700 transition-colors"
          >
            {showAll ? "Show Top 10" : `Show All ${ranked.length}`}
          </button>
        )}
      </div>

      {/* Investigation summary strip */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-4 border-b border-slate-100">
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="font-mono text-[10px] text-slate-400 uppercase font-semibold">Vessels Detected</div>
            <div className="font-mono text-lg font-bold text-slate-900 mt-0.5">{summary.vesselsDetected}</div>
          </div>
          <div className="p-3 rounded-xl bg-rose-50/60 border border-rose-100">
            <div className="font-mono text-[10px] text-rose-500 uppercase font-semibold">Closest Vessel</div>
            <div className="text-xs font-bold text-slate-900 mt-1 truncate">
              {summary.closestVessel ? summary.closestVessel.name : "—"}
            </div>
            <div className="font-mono text-[11px] text-rose-700 font-semibold">
              {summary.closestVessel ? `${summary.closestVessel.distanceKm} km` : ""}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-slate-50 border border-slate-100">
            <div className="font-mono text-[10px] text-slate-400 uppercase font-semibold">Avg. Distance</div>
            <div className="font-mono text-lg font-bold text-slate-900 mt-0.5">
              {summary.averageDistanceKm != null ? `${summary.averageDistanceKm} km` : "—"}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-amber-50/60 border border-amber-100">
            <div className="font-mono text-[10px] text-amber-600 uppercase font-semibold">Vessels of Interest</div>
            <div className="font-mono text-lg font-bold text-amber-700 mt-0.5">{summary.vesselsOfInterest}</div>
          </div>
        </div>
      )}

      {/* Top 10 quick-scan strip */}
      <div className="py-4 border-b border-slate-100">
        <div className="text-xs font-bold text-slate-700 mb-2.5 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-sm text-primary">bolt</span>
          Top {Math.min(10, ranked.length)} Ranked Vessels
        </div>
        <div className="flex gap-2.5 overflow-x-auto pb-1">
          {top10.map((v) => (
            <button
              key={v.mmsi || v.name}
              onClick={() => onSelect && onSelect(v)}
              className={`shrink-0 w-40 text-left p-2.5 rounded-xl border transition-all ${
                selectedMmsi && v.mmsi === selectedMmsi
                  ? "border-primary bg-sky-50/60 shadow-sm"
                  : "border-slate-200 bg-white hover:border-slate-300"
              }`}
            >
              <div className="flex items-center justify-between">
                <span
                  className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold font-mono ${rankBadgeStyle(
                    v.proximityRank
                  )}`}
                >
                  {v.proximityRank}
                </span>
                <span className="font-mono text-[10px] text-slate-500 font-semibold">{v.distanceKm} km</span>
              </div>
              <div className="text-xs font-semibold text-slate-900 mt-1.5 truncate" title={v.name}>
                {v.name}
              </div>
              <div className="font-mono text-[10px] text-slate-400 truncate">MMSI {v.mmsi || "—"}</div>
            </button>
          ))}
        </div>
      </div>

      {/* Full ranked table */}
      <div className="pt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase text-slate-400 border-b border-slate-100">
              <th className="py-2 pr-3 font-semibold">Rank</th>
              <th className="py-2 pr-3 font-semibold">Vessel Name</th>
              <th className="py-2 pr-3 font-semibold">MMSI</th>
              <th className="py-2 pr-3 font-semibold">IMO</th>
              <th className="py-2 pr-3 font-semibold">Type</th>
              <th className="py-2 pr-3 font-semibold">Flag</th>
              <th className="py-2 pr-3 font-semibold">Lat</th>
              <th className="py-2 pr-3 font-semibold">Lon</th>
              <th className="py-2 pr-3 font-semibold">Timestamp (UTC)</th>
              <th className="py-2 pr-3 font-semibold text-right">Distance (km)</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((v) => (
              <tr
                key={v.mmsi || v.name}
                onClick={() => onSelect && onSelect(v)}
                className={`border-b border-slate-50 cursor-pointer transition-colors ${
                  selectedMmsi && v.mmsi === selectedMmsi ? "bg-sky-50/60" : "hover:bg-slate-50"
                }`}
              >
                <td className="py-2 pr-3">
                  <span
                    className={`inline-flex w-5 h-5 rounded-full items-center justify-center text-[10px] font-bold font-mono ${rankBadgeStyle(
                      v.proximityRank
                    )}`}
                  >
                    {v.proximityRank}
                  </span>
                </td>
                <td className="py-2 pr-3 font-semibold text-slate-900 whitespace-nowrap">{v.name}</td>
                <td className="py-2 pr-3 font-mono text-slate-600 whitespace-nowrap">{v.mmsi || "—"}</td>
                <td className="py-2 pr-3 font-mono text-slate-600 whitespace-nowrap">{v.imo || "—"}</td>
                <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{v.vesselType || "Unknown"}</td>
                <td className="py-2 pr-3 text-slate-600 whitespace-nowrap">{v.flag || "—"}</td>
                <td className="py-2 pr-3 font-mono text-slate-500 whitespace-nowrap">{fmtCoord(v.lat)}</td>
                <td className="py-2 pr-3 font-mono text-slate-500 whitespace-nowrap">{fmtCoord(v.lon)}</td>
                <td className="py-2 pr-3 font-mono text-slate-500 whitespace-nowrap">{fmtTimestamp(v.timestamp)}</td>
                <td className="py-2 pr-3 font-mono text-right font-bold text-slate-900 whitespace-nowrap">
                  {v.distanceKm.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}