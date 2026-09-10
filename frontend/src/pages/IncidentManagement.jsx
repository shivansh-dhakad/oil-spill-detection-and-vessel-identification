import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../api.js";

const STATUSES = ["Active", "Under Investigation", "Resolved"];

function formatDate(value) {
  if (!value) return "-";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function severityClass(severity) {
  if (severity === "critical") return "bg-rose-50 text-rose-700 border-rose-200";
  if (severity === "advisory") return "bg-amber-50 text-amber-700 border-amber-200";
  return "bg-slate-50 text-slate-600 border-slate-200";
}

export default function IncidentManagement() {
  const [incidents, setIncidents] = useState([]);
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [severity, setSeverity] = useState("all");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  async function loadIncidents() {
    setLoading(true);
    try {
      const result = await api.listIncidents({ search, status, severity });
      setIncidents(result.incidents);
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timer = setTimeout(loadIncidents, 180);
    return () => clearTimeout(timer);
  }, [search, status, severity]);

  async function changeStatus(incidentId, nextStatus) {
    try {
      const updated = await api.updateIncidentStatus(incidentId, nextStatus);
      setIncidents((current) => current.map((incident) => incident.incidentId === incidentId ? updated : incident));
    } catch (err) {
      setError(err.message);
    }
  }

  return (
    <main className="pt-16 min-h-screen bg-dots-pattern">
      <div className="max-w-[1680px] mx-auto p-6 lg:p-8 space-y-6">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <p className="text-xs font-mono uppercase tracking-[0.18em] text-rose-600 font-bold">Response operations</p>
            <h1 className="text-3xl font-bold font-display text-slate-heading tracking-tight">Incident Management</h1>
            <p className="mt-1 text-sm text-slate-subtle">Track detected oil spills from first alert through resolution.</p>
          </div>
          <Link to="/history" className="text-xs font-mono font-bold text-primary hover:text-primary-hover">VIEW PREDICTION HISTORY</Link>
        </div>

        <section className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {["Active", "Under Investigation", "Resolved"].map((label) => (
            <button key={label} onClick={() => setStatus(label)} className={`text-left bg-card-white border rounded-xl p-4 shadow-sm transition-colors ${status === label ? "border-primary ring-2 ring-cyan-100" : "border-border-soft hover:border-primary"}`}>
              <div className="text-[10px] font-mono uppercase tracking-wider text-slate-subtle">{label}</div>
              <div className="mt-2 text-2xl font-bold font-display text-slate-heading">{incidents.filter((incident) => incident.status === label).length}</div>
            </button>
          ))}
        </section>

        <section className="bg-card-white border border-border-soft rounded-2xl shadow-sm p-5">
          <div className="flex flex-col lg:flex-row gap-3">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search incident ID or SAFE product..." className="h-10 flex-1 bg-slate-50 border border-slate-200 rounded-lg px-3 text-xs font-mono focus:outline-none focus:border-primary focus:bg-white" />
            <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-10 bg-slate-50 border border-slate-200 rounded-lg px-3 text-xs font-medium focus:outline-none focus:border-primary">
              <option value="all">All lifecycle states</option>
              {STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
            <select value={severity} onChange={(event) => setSeverity(event.target.value)} className="h-10 bg-slate-50 border border-slate-200 rounded-lg px-3 text-xs font-medium focus:outline-none focus:border-primary">
              <option value="all">All severity levels</option>
              <option value="critical">Critical</option>
              <option value="advisory">Advisory</option>
            </select>
          </div>
        </section>

        <section className="bg-card-white border border-border-soft rounded-2xl shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-border-soft flex items-center justify-between"><h2 className="text-sm font-bold font-display text-slate-heading">Oil Spill Incidents</h2><span className="text-[10px] font-mono text-slate-subtle">{incidents.length} INCIDENTS</span></div>
          <div className="overflow-x-auto">
            <table className="w-full text-left">
              <thead className="bg-slate-50/70 text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                <tr><th className="px-5 py-3">Incident ID</th><th className="px-4 py-3">SAFE Product</th><th className="px-4 py-3">Detection Time</th><th className="px-4 py-3">Severity</th><th className="px-4 py-3">Confidence</th><th className="px-4 py-3">Area</th><th className="px-4 py-3">Lifecycle</th></tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {loading && <tr><td colSpan={7} className="p-8 text-center text-slate-400 font-mono">Loading incidents...</td></tr>}
                {!loading && error && <tr><td colSpan={7} className="p-8 text-center text-rose-600 font-mono">{error}</td></tr>}
                {!loading && !error && incidents.map((incident) => (
                  <tr key={incident.incidentId} className="hover:bg-slate-50/70">
                    <td className="px-5 py-4"><div className="font-mono font-bold text-rose-700">{incident.incidentId}</div>{incident.predictionId && <Link to={`/results/${incident.predictionId}`} className="text-[10px] text-primary font-mono">OPEN ANALYSIS</Link>}</td>
                    <td className="px-4 py-4 max-w-xs truncate font-mono text-slate-700" title={incident.safeProductName}>{incident.safeProductName}</td>
                    <td className="px-4 py-4 text-slate-600">{formatDate(incident.detectionTime)}</td>
                    <td className="px-4 py-4"><span className={`px-2 py-1 rounded-full border text-[10px] font-bold uppercase ${severityClass(incident.severity)}`}>{incident.severity}</span></td>
                    <td className="px-4 py-4 font-mono font-bold text-slate-700">{incident.confidence != null ? `${incident.confidence}%` : "-"}</td>
                    <td className="px-4 py-4 font-mono text-slate-700">{incident.area != null ? `${incident.area.toFixed(2)} km²` : "-"}</td>
                    <td className="px-4 py-4"><select value={incident.status} onChange={(event) => changeStatus(incident.incidentId, event.target.value)} className="h-8 bg-white border border-slate-200 rounded-lg px-2 text-[11px] font-semibold text-slate-700 focus:outline-none focus:border-primary">{STATUSES.map((value) => <option key={value} value={value}>{value}</option>)}</select></td>
                  </tr>
                ))}
                {!loading && !error && incidents.length === 0 && <tr><td colSpan={7} className="p-10 text-center text-slate-400 font-mono">No incidents match the current filters.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}
