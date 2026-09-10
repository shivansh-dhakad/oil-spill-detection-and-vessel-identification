import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

export default function PredictionHistory() {
  const [predictions, setPredictions] = useState([]);
  const [stats, setStats] = useState(null);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [minConfidence, setMinConfidence] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    setLoading(true);
    Promise.all([
      api.listPredictions({ search, status, minConfidence: minConfidence.replace(">", "") }),
      api.getStats(),
    ])
      .then(([predRes, statsRes]) => {
        setPredictions(predRes.predictions);
        setStats(statsRes);
        setError(null);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [search, status, minConfidence]);

  return (
    <main className="pt-16 min-h-screen flex flex-col justify-between">
      <div className="p-6 lg:p-8 max-w-[1680px] w-full mx-auto space-y-6">
        {/* Page Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between pb-2 gap-4">
          <div>
            <h1 className="text-2xl lg:text-3xl font-bold font-display text-slate-900 tracking-tight flex items-center gap-2.5">
              Prediction History &amp; Maritime Audit Log
              <span className="w-2.5 h-2.5 rounded-full bg-teal-500 ring-4 ring-teal-100"></span>
            </h1>
            <p className="text-sm text-slate-500 max-w-3xl mt-1">
              Historical satellite SAR acquisitions, slick detection records, and vessel attribution reports
            </p>
          </div>
        </div>

        {/* Summary Metrics */}
        {stats && (
          <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs hover:border-sky-300 hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">
                  TOTAL ACQUISITIONS
                </span>
                <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">satellite_alt</span>
                </div>
              </div>
              <div className="mt-4 text-3xl font-bold font-display text-slate-900 tracking-tight">
                {stats.totalAcquisitions}
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                Sentinel-1A &amp; 1B Dual-Pass
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs hover:border-rose-300 hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">
                  CONFIRMED SLICKS
                </span>
                <div className="w-8 h-8 rounded-lg bg-rose-50 text-rose-600 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">warning</span>
                </div>
              </div>
              <div className="mt-4 flex items-baseline justify-between">
                <div className="text-3xl font-bold font-display text-rose-600 tracking-tight">
                  {stats.confirmedSlicks}
                </div>
                <span className="px-2 py-0.5 rounded bg-rose-50 border border-rose-200 text-rose-700 text-xs font-mono font-bold">
                  {stats.incidenceRate}% INCIDENCE
                </span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                Total slick area {stats.totalSlickAreaKm2} km²
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs hover:border-teal-300 hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">
                  ATTRIBUTIONS MATCHED
                </span>
                <div className="w-8 h-8 rounded-lg bg-teal-50 text-teal-600 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">directions_boat</span>
                </div>
              </div>
              <div className="mt-4 flex items-baseline justify-between">
                <div className="text-3xl font-bold font-display text-slate-900 tracking-tight">
                  {stats.attributionsMatched}{" "}
                  <span className="text-lg font-normal text-slate-400 font-body">({stats.attributionRate}%)</span>
                </div>
                <span className="material-symbols-outlined text-teal-600 text-[22px]">verified_user</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">
                AIS Kinematic Correlation
              </div>
            </div>

            <div className="bg-white rounded-xl border border-slate-200 p-6 shadow-xs hover:border-sky-300 hover:shadow-md transition-all">
              <div className="flex items-center justify-between">
                <span className="text-xs font-mono uppercase tracking-wider text-slate-500 font-semibold">
                  TOTAL MONITORED AREA
                </span>
                <div className="w-8 h-8 rounded-lg bg-sky-50 text-sky-600 flex items-center justify-center">
                  <span className="material-symbols-outlined text-[20px]">square_foot</span>
                </div>
              </div>
              <div className="mt-4 text-3xl font-bold font-display text-slate-900 tracking-tight">
                {stats.totalMonitoredAreaKm2.toLocaleString()}{" "}
                <span className="text-lg font-normal text-slate-400 font-body">km²</span>
              </div>
              <div className="mt-3 pt-3 border-t border-slate-100 text-xs text-slate-500">Global EEZ coverage</div>
            </div>
          </section>
        )}

        {/* Filter bar */}
        <section className="bg-white rounded-xl border border-slate-200 p-5 shadow-xs space-y-4">
          <div className="flex flex-col xl:flex-row items-stretch xl:items-center justify-between gap-4">
            <div className="relative flex-1">
              <span className="absolute inset-y-0 left-3.5 flex items-center text-slate-400 pointer-events-none">
                <span className="material-symbols-outlined text-[19px]">search</span>
              </span>
              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="w-full h-10 pl-10 pr-4 text-xs font-mono bg-slate-50 border border-slate-200 rounded-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-primary focus:bg-white focus:ring-2 focus:ring-sky-100 transition-all"
                placeholder="Search by Prediction ID, vessel name, MMSI, or region…"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase mb-1">Detection Status</label>
                <select
                  value={status}
                  onChange={(e) => setStatus(e.target.value)}
                  className="h-9 bg-slate-50 border border-slate-200 rounded-lg px-3 text-xs font-medium text-slate-700 focus:outline-none focus:border-primary focus:bg-white transition-colors"
                >
                  <option value="all">All</option>
                  <option value="detected">Spill Detected</option>
                  <option value="clean">Clean / No Slick</option>
                </select>
              </div>
              <div className="flex flex-col">
                <label className="text-[10px] text-slate-400 font-mono font-bold uppercase mb-1">Min Confidence</label>
                <select
                  value={minConfidence}
                  onChange={(e) => setMinConfidence(e.target.value)}
                  className="h-9 bg-slate-50 border border-slate-200 rounded-lg px-3 text-xs font-medium text-slate-700 focus:outline-none focus:border-primary focus:bg-white transition-colors"
                >
                  <option value="">All</option>
                  <option value=">90">&gt;90%</option>
                  <option value=">75">&gt;75%</option>
                  <option value=">50">&gt;50%</option>
                </select>
              </div>
            </div>
          </div>
        </section>

        {/* Table */}
        <section className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-xs">
          <div className="px-6 py-3.5 border-b border-slate-200 flex items-center justify-between bg-slate-50/70 flex-wrap gap-2">
            <div className="flex items-center space-x-3">
              <span className="material-symbols-outlined text-primary">data_table</span>
              <h2 className="text-sm font-bold font-display text-slate-900">Verified SAR Ingestion Records</h2>
              <span className="px-2 py-0.5 rounded-full bg-white border border-slate-200 text-slate-500 font-mono text-[10px] font-bold">
                {predictions.length} RECORDS
              </span>
            </div>
          </div>
          <div className="overflow-x-auto custom-scrollbar">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-slate-200 bg-slate-50/50 text-[11px] font-mono text-slate-500 uppercase tracking-wider">
                  <th className="py-3.5 px-5">Run ID / Sensor</th>
                  <th className="py-3.5 px-4">Acquisition (UTC)</th>
                  <th className="py-3.5 px-4">Target Marine Region</th>
                  <th className="py-3.5 px-4">Detection Result</th>
                  <th className="py-3.5 px-4">Slick Extent</th>
                  <th className="py-3.5 px-4">Model Conf.</th>
                  <th className="py-3.5 px-4">Suspect Attributed</th>
                  <th className="py-3.5 px-5 text-right">Audit Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-mono text-xs">
                      Loading records…
                    </td>
                  </tr>
                )}
                {!loading && error && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-rose-600 font-mono text-xs">
                      {error}
                    </td>
                  </tr>
                )}
                {!loading &&
                  !error &&
                  predictions.map((p) => {
                    const detected = p.detection === "detected";
                    const candidates = Array.isArray(p.candidates) ? p.candidates : [];
                    const top = candidates[0];
                    let dateStr = "—";
                    let timeStr = "—";
                    try {
                      const date = new Date(p.acquiredAt);
                      if (!isNaN(date.getTime())) {
                        dateStr = date.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
                        timeStr = `${date.toISOString().slice(11, 16)} UTC`;
                      } else if (p.acquiredAt) {
                        dateStr = String(p.acquiredAt).slice(0, 10);
                        timeStr = String(p.acquiredAt).slice(11, 16) || "—";
                      }
                    } catch {
                      dateStr = String(p.acquiredAt || "—");
                    }
                    return (
                      <tr key={p.id} className="hover:bg-slate-50/90 transition-colors group">
                        <td className="py-4 px-5">
                          <div className="flex items-center space-x-2">
                            <span
                              className={`w-2 h-2 rounded-full ${
                                detected ? (p.severity === "critical" ? "bg-rose-500 animate-pulse" : "bg-amber-500") : "bg-emerald-500"
                              }`}
                            ></span>
                            <span className="text-primary font-mono font-bold">{p.id}</span>
                          </div>
                          <div className="text-[10px] font-mono text-slate-400 pl-4">{p.sensor || "Sentinel-1"}</div>
                        </td>
                        <td className="py-4 px-4 text-slate-700">
                          <div className="font-medium text-slate-900">{dateStr}</div>
                          <div className="text-[11px] font-mono text-slate-400">{timeStr}</div>
                        </td>
                        <td className="py-4 px-4">
                          <div className="text-slate-900 font-semibold">{p.region?.name || "Unknown Region"}</div>
                          <div className="text-[10px] font-mono text-teal-700">
                            {p.region?.lat != null ? `${p.region.lat}°N` : "—"}, {p.region?.lon != null ? `${p.region.lon}°E` : "—"}
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          <span
                            className={`inline-flex items-center space-x-1.5 px-2.5 py-1 rounded-full border font-mono text-[11px] font-bold ${
                              detected ? "bg-rose-50 border-rose-200 text-rose-700" : "bg-emerald-50 border-emerald-200 text-emerald-700"
                            }`}
                          >
                            <span className={`w-1.5 h-1.5 rounded-full ${detected ? "bg-rose-600" : "bg-emerald-600"}`}></span>
                            <span>{detected ? "Detected" : "Clean"}</span>
                          </span>
                        </td>
                        <td className="py-4 px-4 font-mono text-slate-900 font-bold">{p.slickAreaKm2} km²</td>
                        <td className="py-4 px-4">
                          <div className="flex items-center space-x-2">
                            <span className="font-mono text-sky-800 font-bold text-xs">{p.confidence}%</span>
                            <div className="w-14 bg-slate-100 h-1.5 rounded-full overflow-hidden">
                              <div className="bg-primary h-full rounded-full" style={{ width: `${p.confidence}%` }} />
                            </div>
                          </div>
                        </td>
                        <td className="py-4 px-4">
                          {top ? (
                            <>
                              <div className="text-slate-900 font-semibold flex items-center gap-1.5 flex-wrap">
                                <span>{top.name}</span>
                                {top.flag && top.flag !== "UNKNOWN" && (
                                  <span className="px-1 py-0.2 rounded bg-sky-50 border border-sky-100 text-primary font-mono text-[9px] font-bold">
                                    {top.flag}
                                  </span>
                                )}
                              </div>
                              <div className="text-[10px] font-mono text-amber-700 font-medium mt-0.5">
                                {top.probability}% PROB // MMSI {top.mmsi} {top.vesselType ? `• ${top.vesselType}` : ""}
                              </div>
                            </>
                          ) : (
                            <span className="text-slate-400 text-[11px] font-mono">— none —</span>
                          )}
                        </td>
                        <td className="py-4 px-5 text-right">
                          <Link
                            to={`/results/${p.id}`}
                            className="px-3 py-1.5 rounded-lg bg-primary hover:bg-sky-700 text-white font-semibold text-xs transition-all shadow-xs active:scale-95 inline-block"
                          >
                            View Analysis
                          </Link>
                        </td>
                      </tr>
                    );
                  })}
                {!loading && !error && predictions.length === 0 && (
                  <tr>
                    <td colSpan={8} className="py-8 text-center text-slate-400 font-mono text-xs">
                      No records match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
