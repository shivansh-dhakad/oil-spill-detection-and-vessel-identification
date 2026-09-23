import { useMemo, useState } from "react";

function rankColor(rank) {
  if (rank === 1) return "#7f1d1d";
  if (rank === 2) return "#f97316";
  if (rank === 3) return "#eab308";
  return "#2563eb";
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

function Rank({ rank }) {
  return (
    <span className="lr-rank" style={{ background: rankColor(rank), color: rank === 3 ? "#0c2340" : "#fff" }}>
      {rank}
    </span>
  );
}

/**
 * Vessel traffic investigation panel (survey-chart light theme):
 *  - summary telemetry tiles
 *  - top-10 quick-scan strip
 *  - full ranked candidate table
 */
export default function VesselProximityPanel({ vessels = [], summary = null, selectedMmsi = null, onSelect }) {
  const [showAll, setShowAll] = useState(false);

  const ranked = useMemo(
    () => [...vessels].filter((v) => v.proximityRank != null).sort((a, b) => a.proximityRank - b.proximityRank),
    [vessels]
  );

  const top10 = ranked.slice(0, 10);
  const visibleRows = showAll ? ranked : top10;

  if (ranked.length === 0) return null;

  return (
    <div className="lr-card">
      <div className="lr-card-head">
        <div className="lr-card-title">
          <span className="lr-ico">
            <span className="material-symbols-outlined">radar</span>
          </span>
          <div>
            <h3>Vessel Traffic Investigation</h3>
            <p>
              {ranked.length} vessel{ranked.length === 1 ? "" : "s"} evaluated and ranked by attribution likelihood &amp; proximity
            </p>
          </div>
        </div>
        {ranked.length > 10 && (
          <button type="button" className="lt-btn lt-btn-ghost lt-btn-sm" style={{ padding: "10px 16px", fontSize: 12 }} onClick={() => setShowAll((s) => !s)}>
            {showAll ? "Show top 10" : `Show all ${ranked.length}`}
          </button>
        )}
      </div>

      {summary && (
        <div className="lr-stats" style={{ marginBottom: 22 }}>
          <div className="lr-stat">
            <b>{summary.vesselsDetected}</b>
            <span>Vessels detected</span>
          </div>
          <div className="lr-stat">
            <b className="is-hot" style={{ fontSize: "1.05rem", fontFamily: "Hanken Grotesk, sans-serif", fontWeight: 700 }}>
              {summary.closestVessel ? summary.closestVessel.name : "—"}
            </b>
            <span>Closest{summary.closestVessel ? ` · ${summary.closestVessel.distanceKm} km` : ""}</span>
          </div>
          <div className="lr-stat">
            <b className="is-sea">{summary.averageDistanceKm != null ? `${summary.averageDistanceKm}` : "—"}</b>
            <span>Avg. distance (km)</span>
          </div>
          <div className="lr-stat">
            <b className="is-gold">{summary.vesselsOfInterest}</b>
            <span>Vessels of interest</span>
          </div>
        </div>
      )}

      <div className="lr-chart-head" style={{ marginBottom: 10 }}>
        <h4>
          <span className="material-symbols-outlined">bolt</span>
          Top {Math.min(10, ranked.length)} ranked vessels · quick scan
        </h4>
      </div>
      <div className="lr-scan">
        {top10.map((v) => {
          const isSelected = selectedMmsi && v.mmsi === selectedMmsi;
          return (
            <button key={v.mmsi || v.name} type="button" className={isSelected ? "is-on" : ""} onClick={() => onSelect && onSelect(v)}>
              <div className="s-top">
                <Rank rank={v.proximityRank} />
                <b>{v.distanceKm} km</b>
              </div>
              <div className="s-name" title={v.name}>
                {v.name}
              </div>
              <div className="s-mmsi">MMSI: {v.mmsi || "—"}</div>
            </button>
          );
        })}
      </div>

      <div className="lr-scroll" style={{ marginTop: 22 }}>
        <table className="lr-table is-click" style={{ minWidth: 900 }}>
          <thead>
            <tr>
              <th>Rank</th>
              <th>Vessel name</th>
              <th>MMSI</th>
              <th>IMO</th>
              <th>Type</th>
              <th>Flag</th>
              <th>Lat</th>
              <th>Lon</th>
              <th>Timestamp (UTC)</th>
              <th style={{ textAlign: "right" }}>Distance (km)</th>
            </tr>
          </thead>
          <tbody>
            {visibleRows.map((v) => {
              const isSelected = selectedMmsi && v.mmsi === selectedMmsi;
              return (
                <tr key={v.mmsi || v.name} className={isSelected ? "is-on" : ""} onClick={() => onSelect && onSelect(v)}>
                  <td>
                    <Rank rank={v.proximityRank} />
                  </td>
                  <td className="strong" style={{ whiteSpace: "nowrap" }}>{v.name}</td>
                  <td className="m">{v.mmsi || "—"}</td>
                  <td className="m">{v.imo || "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>{v.vesselType || "Unknown"}</td>
                  <td>{v.flag || "—"}</td>
                  <td className="m">{fmtCoord(v.lat)}</td>
                  <td className="m">{fmtCoord(v.lon)}</td>
                  <td className="m">{fmtTimestamp(v.timestamp)}</td>
                  <td className="m strong" style={{ textAlign: "right" }}>
                    {v.distanceKm != null ? Number(v.distanceKm).toFixed(2) : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}