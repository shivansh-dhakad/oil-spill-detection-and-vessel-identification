import { useMemo, useState } from "react";

function rankBadgeStyle(rank) {
  if (rank === 1) return "bg-[#ef4444] text-white shadow-[0_0_10px_rgba(239,68,68,0.5)]";
  if (rank === 2) return "bg-orange-500 text-white shadow-[0_0_10px_rgba(249,115,22,0.4)]";
  if (rank === 3) return "bg-yellow-500 text-slate-950 font-bold shadow-[0_0_10px_rgba(234,179,8,0.4)]";
  return "bg-sky-600 text-white";
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
 * Vessel traffic investigation panel with a sleek, high-contrast dark aesthetic:
 * - Summary telemetry cards
 * - Top 10 quick-scan vessel cards
 * - Full ranked candidate investigation table
 */
export default function VesselProximityPanel({ vessels = [], summary = null, selectedMmsi = null, onSelect }) {
  const [showAll, setShowAll] = useState(false);

  // Sort order matches the Bayesian attribution ranking
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
    <section className="w-full bg-slate-900/90 rounded-2xl border border-cyan-400/20 shadow-[0_14px_40px_-24px_rgba(0,0,0,0.9)] p-5 text-white transition-all duration-300 hover:border-cyan-300/35">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3 pb-4 border-b border-white/10">
        <div>
          <div className="flex items-center gap-2">
            <span className="w-8 h-8 rounded-lg bg-rose-500/10 border border-rose-500/20 flex items-center justify-center">
              <span className="material-symbols-outlined text-rose-400 text-lg">radar</span>
            </span>
            <h3 className="text-base font-bold text-white tracking-tight">
              Vessel Traffic Investigation
            </h3>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {ranked.length} vessel{ranked.length === 1 ? "" : "s"} evaluated and ranked by attribution likelihood &amp; proximity
          </p>
        </div>
        {ranked.length > 10 && (
          <button
            onClick={() => setShowAll((s) => !s)}
            className="px-3.5 py-1.5 rounded-lg bg-white/[0.06] hover:bg-white/[0.12] border border-white/15 text-xs font-semibold text-cyan-200 transition-colors"
          >
            {showAll ? "Show Top 10" : `Show All ${ranked.length}`}
          </button>
        )}
      </div>

      {/* Investigation summary strip */}
      {summary && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 py-4 border-b border-white/10">
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
            <div className="font-mono text-[10px] text-slate-400 uppercase font-semibold">Vessels Detected</div>
            <div className="font-mono text-xl font-bold text-white mt-0.5">{summary.vesselsDetected}</div>
          </div>
          <div className="p-3 rounded-xl bg-rose-950/40 border border-rose-500/30">
            <div className="font-mono text-[10px] text-rose-400 uppercase font-semibold">Closest Vessel</div>
            <div className="text-xs font-bold text-rose-100 mt-1 truncate" title={summary.closestVessel?.name}>
              {summary.closestVessel ? summary.closestVessel.name : "—"}
            </div>
            <div className="font-mono text-xs text-rose-300 font-bold mt-0.5">
              {summary.closestVessel ? `${summary.closestVessel.distanceKm} km` : ""}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-white/[0.04] border border-white/10">
            <div className="font-mono text-[10px] text-slate-400 uppercase font-semibold">Avg. Distance</div>
            <div className="font-mono text-xl font-bold text-cyan-200 mt-0.5">
              {summary.averageDistanceKm != null ? `${summary.averageDistanceKm} km` : "—"}
            </div>
          </div>
          <div className="p-3 rounded-xl bg-amber-950/40 border border-amber-500/30">
            <div className="font-mono text-[10px] text-amber-400 uppercase font-semibold">Vessels of Interest</div>
            <div className="font-mono text-xl font-bold text-amber-300 mt-0.5">{summary.vesselsOfInterest}</div>
          </div>
        </div>
      )}

      {/* Top 10 quick-scan strip */}
      <div className="py-4 border-b border-white/10">
        <div className="text-xs font-bold text-slate-300 mb-2.5 flex items-center gap-1.5">
          <span className="material-symbols-outlined text-sm text-cyan-400">bolt</span>
          Top {Math.min(10, ranked.length)} Ranked Vessels Quick Scan
        </div>
        <div className="flex gap-2.5 overflow-x-auto pb-1.5 scrollbar-thin">
          {top10.map((v) => {
            const isSelected = selectedMmsi && v.mmsi === selectedMmsi;
            return (
              <button
                key={v.mmsi || v.name}
                onClick={() => onSelect && onSelect(v)}
                className={`shrink-0 w-44 text-left p-3 rounded-xl border transition-all ${
                  isSelected
                    ? "border-cyan-400 bg-cyan-950/70 shadow-[0_0_18px_rgba(34,211,238,0.25)] ring-1 ring-cyan-400"
                    : "border-white/10 bg-slate-950/60 hover:bg-slate-950/90 hover:border-cyan-400/40"
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
                  <span className="font-mono text-[10.5px] text-cyan-200 font-bold">{v.distanceKm} km</span>
                </div>
                <div className="text-xs font-bold text-white mt-2 truncate" title={v.name}>
                  {v.name}
                </div>
                <div className="font-mono text-[10px] text-slate-400 truncate mt-0.5">
                  MMSI: {v.mmsi || "—"}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Full ranked table */}
      <div className="pt-4 overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-left font-mono text-[10px] uppercase text-slate-400 border-b border-white/10">
              <th className="py-2.5 pr-3 font-semibold">Rank</th>
              <th className="py-2.5 pr-3 font-semibold">Vessel Name</th>
              <th className="py-2.5 pr-3 font-semibold">MMSI</th>
              <th className="py-2.5 pr-3 font-semibold">IMO</th>
              <th className="py-2.5 pr-3 font-semibold">Type</th>
              <th className="py-2.5 pr-3 font-semibold">Flag</th>
              <th className="py-2.5 pr-3 font-semibold">Lat</th>
              <th className="py-2.5 pr-3 font-semibold">Lon</th>
              <th className="py-2.5 pr-3 font-semibold">Timestamp (UTC)</th>
              <th className="py-2.5 pr-3 font-semibold text-right">Distance (km)</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((v) => {
              const isSelected = selectedMmsi && v.mmsi === selectedMmsi;
              return (
                <tr
                  key={v.mmsi || v.name}
                  onClick={() => onSelect && onSelect(v)}
                  className={`border-b border-white/5 cursor-pointer transition-colors ${
                    isSelected
                      ? "bg-cyan-950/60 text-white"
                      : "hover:bg-white/[0.04] text-slate-300"
                  }`}
                >
                  <td className="py-2.5 pr-3">
                    <span
                      className={`inline-flex w-5 h-5 rounded-full items-center justify-center text-[10px] font-bold font-mono ${rankBadgeStyle(
                        v.proximityRank
                      )}`}
                    >
                      {v.proximityRank}
                    </span>
                  </td>
                  <td className="py-2.5 pr-3 font-semibold text-white whitespace-nowrap">{v.name}</td>
                  <td className="py-2.5 pr-3 font-mono text-cyan-200/80 whitespace-nowrap">{v.mmsi || "—"}</td>
                  <td className="py-2.5 pr-3 font-mono text-slate-400 whitespace-nowrap">{v.imo || "—"}</td>
                  <td className="py-2.5 pr-3 text-slate-300 whitespace-nowrap">{v.vesselType || "Unknown"}</td>
                  <td className="py-2.5 pr-3 text-slate-400 whitespace-nowrap">{v.flag || "—"}</td>
                  <td className="py-2.5 pr-3 font-mono text-slate-400 whitespace-nowrap">{fmtCoord(v.lat)}</td>
                  <td className="py-2.5 pr-3 font-mono text-slate-400 whitespace-nowrap">{fmtCoord(v.lon)}</td>
                  <td className="py-2.5 pr-3 font-mono text-slate-400 whitespace-nowrap">{fmtTimestamp(v.timestamp)}</td>
                  <td className="py-2.5 pr-3 font-mono text-right font-bold text-cyan-200 whitespace-nowrap">
                    {v.distanceKm.toFixed(2)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}