import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { api } from "../api.js";
import "../dashboard.css";
import "../history.css";

const rise = {
  hidden: { opacity: 0, y: 24 },
  show: (i = 0) => ({ opacity: 1, y: 0, transition: { duration: 0.7, delay: i * 0.07, ease: [0.16, 1, 0.3, 1] } }),
};

const STATUS_OPTIONS = [
  { id: "all", label: "All" },
  { id: "detected", label: "Spill detected" },
  { id: "clean", label: "Clean" },
];

function formatWhen(value) {
  if (!value) return { day: "—", time: "—" };
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return { day: String(value).slice(0, 10), time: String(value).slice(11, 16) || "—" };
  return {
    day: d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }),
    time: `${d.toISOString().slice(11, 16)} UTC`,
  };
}

function StatCard({ icon, label, value, unit, foot, tone = "", i = 0 }) {
  return (
    <motion.div className={`lt-hstat ${tone}`} variants={rise} custom={i} initial="hidden" whileInView="show" viewport={{ once: true, amount: 0.2 }}>
      <div className="lt-hstat-label">
        <span>{label}</span>
        <span className="material-symbols-outlined">{icon}</span>
      </div>
      <div className="lt-hstat-num">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      <div className="lt-hstat-foot">{foot}</div>
    </motion.div>
  );
}

export default function PredictionHistory() {
  const [predictions, setPredictions] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [minConfidence, setMinConfidence] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([
      api.listPredictions({ search: debouncedSearch, status, minConfidence: minConfidence.replace(">", "") }),
      api.getStats(),
    ])
      .then(([predRes, statsRes]) => {
        if (cancelled) return;
        setPredictions(predRes.predictions);
        setStats(statsRes);
        setError(null);
      })
      .catch((e) => !cancelled && setError(e.message))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [debouncedSearch, status, minConfidence]);

  const filtersActive = debouncedSearch || status !== "all" || minConfidence;

  return (
    <main className="lt-page lt-history">
      {/* ============================ HEAD ============================ */}
      <header className="lt-hist-head">
        <div className="lt-hist-copy">
          <motion.span className="lt-eyebrow" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.8 }}>
            History · Maritime audit log
          </motion.span>
          <h1 className="lt-hist-title lt-display">
            Every scene,
            <br />
            <em>on the record.</em>
          </h1>
          <motion.p className="lt-hist-sub" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3, duration: 0.8, ease: [0.16, 1, 0.3, 1] }}>
            Past Sentinel-1 acquisitions, slick detections, and the vessels that were ranked against them.
          </motion.p>
        </div>

        {stats && (
          <section className="lt-hstats" aria-label="Summary">
            <StatCard i={0} icon="satellite_alt" label="Acquisitions" value={stats.totalAcquisitions} foot="Sentinel-1A & 1B scenes analysed" />
            <StatCard
              i={1}
              tone="is-ink"
              icon="warning"
              label="Confirmed slicks"
              value={stats.confirmedSlicks}
              unit={`${stats.incidenceRate}%`}
              foot={`${stats.totalSlickAreaKm2} km² of oil mapped`}
            />
            <StatCard
              i={2}
              tone="is-sea"
              icon="directions_boat"
              label="Attributions"
              value={stats.attributionsMatched}
              unit={`${stats.attributionRate}%`}
              foot="Slicks with a vessel above 50%"
            />
            <StatCard
              i={3}
              icon="square_foot"
              label="Area monitored"
              value={Number(stats.totalMonitoredAreaKm2).toLocaleString()}
              unit="km²"
              foot="Global EEZ coverage"
            />
          </section>
        )}
      </header>

      <div className="lt-hist-wrap">
        {/* ============================ FILTERS ============================ */}
        <div className="lt-filters" role="search">
          <label className="lt-search">
            <span className="material-symbols-outlined">search</span>
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search by run ID, vessel name, MMSI or region"
              aria-label="Search predictions"
            />
          </label>

          <div className="lt-seg" role="group" aria-label="Detection status">
            {STATUS_OPTIONS.map((o) => (
              <button key={o.id} type="button" className={status === o.id ? "is-on" : ""} aria-pressed={status === o.id} onClick={() => setStatus(o.id)}>
                {o.label}
              </button>
            ))}
          </div>

          <select className="lt-select" value={minConfidence} onChange={(e) => setMinConfidence(e.target.value)} aria-label="Minimum confidence">
            <option value="">Any confidence</option>
            <option value=">90">Above 90%</option>
            <option value=">75">Above 75%</option>
            <option value=">50">Above 50%</option>
          </select>
        </div>

        {/* ============================ LEDGER ============================ */}
        <section className="lt-ledger">
          <div className="lt-ledger-head">
            <h2 className="lt-display">Verified SAR ingestion records</h2>
            <span className="lt-count">{predictions.length} RECORDS</span>
          </div>

          <div className="lt-scroll">
            <table className="lt-table">
              <thead>
                <tr>
                  <th>Run</th>
                  <th>Acquired</th>
                  <th>Region</th>
                  <th>Result</th>
                  <th>Slick extent</th>
                  <th>Confidence</th>
                  <th>Top suspect</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {predictions.map((p) => {
                  const detected = p.detection === "detected";
                  const top = Array.isArray(p.candidates) ? p.candidates[0] : null;
                  const when = formatWhen(p.acquiredAt);
                  const isCoverage = p.areaIsCoveragePct ?? p.areaIsCoveragePercent;
                  const dotClass = detected ? (p.severity === "critical" ? "is-hot" : "is-warn") : "";
                  return (
                    <tr key={p.id}>
                      <td>
                        <div className="lt-id">
                          <span className={`lt-dot ${dotClass}`} />
                          <b>{p.id}</b>
                        </div>
                        <div className="lt-id-sub">{p.sensor || "Sentinel-1"}</div>
                      </td>
                      <td>
                        <div className="lt-cell-main">{when.day}</div>
                        <div className="lt-cell-sub">{when.time}</div>
                      </td>
                      <td>
                        <div className="lt-cell-main">{p.region?.name || "Unknown region"}</div>
                        <div className="lt-cell-sub is-sea">
                          {p.region?.lat != null ? `${p.region.lat}°N` : "—"}, {p.region?.lon != null ? `${p.region.lon}°E` : "—"}
                        </div>
                      </td>
                      <td>
                        <span className={`lt-result ${detected ? "is-hot" : "is-clean"}`}>
                          <i />
                          {detected ? "Detected" : "Clean"}
                        </span>
                      </td>
                      {/* A clean scene has no slick, so never show a stale area for it. */}
                      <td className="lt-area">{detected && p.slickAreaKm2 != null ? `${p.slickAreaKm2} ${isCoverage ? "%" : "km²"}` : "—"}</td>
                      <td>
                        <div className="lt-conf">
                          <b>{p.confidence}%</b>
                          <div className="lt-conf-bar">
                            <span style={{ width: `${Math.max(0, Math.min(100, p.confidence || 0))}%` }} />
                          </div>
                        </div>
                      </td>
                      <td>
                        {top ? (
                          <>
                            <div className="lt-suspect">
                              <span>{top.name}</span>
                              {top.flag && top.flag !== "UNKNOWN" && <span className="lt-flag">{top.flag}</span>}
                            </div>
                            <div className="lt-cell-sub">
                              {top.probability}% · MMSI {top.mmsi}
                              {top.vesselType ? ` · ${top.vesselType}` : ""}
                            </div>
                          </>
                        ) : (
                          <span className="lt-none">No vessel ranked</span>
                        )}
                      </td>
                      <td>
                        <Link to={`/results/${p.id}`} className="lt-btn lt-btn-ink lt-btn-sm">
                          View analysis
                        </Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {loading && <div className="lt-state">Loading records…</div>}
            {!loading && error && <div className="lt-state is-error">{error}</div>}
            {!loading && !error && predictions.length === 0 && (
              <div className="lt-state">
                <h3 className="lt-display">{filtersActive ? "No records match" : "Nothing on record yet"}</h3>
                <p>{filtersActive ? "Loosen the search or filters to see more scenes." : "Upload a Sentinel-1 scene and it will appear here once the analysis finishes."}</p>
              </div>
            )}
          </div>
        </section>
      </div>
    </main>
  );
}