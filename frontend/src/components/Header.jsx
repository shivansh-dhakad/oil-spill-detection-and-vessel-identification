import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../api.js";

const NAV_LINKS = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/history", label: "History", icon: "history" },
  { to: "/batch", label: "Batch", icon: "queue_play_next" },
  { to: "/incidents", label: "Incidents", icon: "crisis_alert" },
];

export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [alertsOpen, setAlertsOpen] = useState(false);

  useEffect(() => {
    let mounted = true;
    const refreshAlerts = () => {
      api.listAlerts({ limit: 8 }).then((data) => {
        if (!mounted) return;
        setAlerts(data.alerts || []);
        setUnreadCount(data.unreadCount || 0);
      }).catch(() => {});
    };
    refreshAlerts();
    const timer = setInterval(refreshAlerts, 5000);
    return () => {
      mounted = false;
      clearInterval(timer);
    };
  }, []);

  async function openAlert(alert) {
    try {
      if (!alert.isRead) {
        await api.markAlertRead(alert.alertId);
        setAlerts((current) => current.map((item) => item.alertId === alert.alertId ? { ...item, isRead: 1, readAt: new Date().toISOString() } : item));
        setUnreadCount((count) => Math.max(0, count - 1));
      }
    } finally {
      setAlertsOpen(false);
      if (alert.predictionId) navigate(`/results/${alert.predictionId}`);
      else navigate(`/incidents`);
    }
  }

  return (
    <header className="fixed top-0 left-0 w-full z-50 flex items-center justify-between px-6 md:px-8 h-16 glass-panel border-b border-white/5 shadow-[0_1px_0_0_rgba(34,211,238,0.08)]">
      <Link to="/" className="flex items-center gap-3 group">
        <div className="relative w-10 h-10 rounded-xl bg-cyan-500/10 border border-cyan-400/30 flex items-center justify-center text-primary shadow-glow overflow-hidden">
          <span className="absolute inset-0 rounded-xl animate-ringPulse" />
          <span className="material-symbols-outlined text-2xl text-primary transition-transform duration-500 group-hover:rotate-[18deg]">satellite_alt</span>
        </div>
        <div className="flex flex-col">
          <span className="text-base font-bold font-display tracking-tight flex items-center gap-2 gradient-text">
            VarunaDrishti
            <span className="hidden sm:inline-block px-2 py-0.5 rounded-full text-[11px] font-mono font-medium bg-cyan-500/10 text-cyan-300 border border-cyan-400/20">
              v1.0
            </span>
          </span>
          <span className="text-xs font-mono text-slate-subtle tracking-wide uppercase">
            Operational Maritime Surveillance
          </span>
        </div>
      </Link>

      <nav className="hidden lg:flex items-center gap-1 relative">
        {NAV_LINKS.map((link) => {
          const active = location.pathname === link.to;
          return (
            <Link
              key={link.to}
              to={link.to}
              className={`relative px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 transition-colors ${
                active ? "text-cyan-300" : "text-slate-subtle hover:text-slate-heading"
              }`}
            >
              {active && (
                <motion.span
                  layoutId="nav-active-pill"
                  className="absolute inset-0 rounded-lg bg-cyan-500/10 border border-cyan-400/20 shadow-glow"
                  transition={{ type: "spring", stiffness: 380, damping: 32 }}
                />
              )}
              <span className="material-symbols-outlined text-lg relative">{link.icon}</span>
              <span className="relative">{link.label}</span>
            </Link>
          );
        })}
      </nav>

      <div className="flex items-center gap-3">
        <div className="relative">
          <button
            onClick={() => setAlertsOpen((open) => !open)}
            className="relative w-10 h-10 rounded-xl border border-white/10 bg-white/5 text-slate-subtle hover:text-primary hover:border-cyan-400/30 transition-colors flex items-center justify-center"
            title="Notifications"
          >
            <span className="material-symbols-outlined text-xl">notifications</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-mono font-bold flex items-center justify-center shadow-glow-rose animate-glowPulse">
                {unreadCount > 99 ? "99+" : unreadCount}
              </span>
            )}
          </button>
          <AnimatePresence>
            {alertsOpen && (
              <motion.div
                initial={{ opacity: 0, y: -8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -8, scale: 0.98 }}
                transition={{ duration: 0.18 }}
                className="absolute right-0 top-12 z-[60] w-80 glass-panel rounded-xl shadow-glow-lg overflow-hidden"
              >
                <div className="px-4 py-3 border-b border-white/5 flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-heading">Oil Spill Alerts</span>
                  <span className="text-[10px] font-mono text-slate-subtle">{unreadCount} UNREAD</span>
                </div>
                <div className="max-h-80 overflow-y-auto custom-scrollbar">
                  {!alerts.length && <div className="p-6 text-center text-xs font-mono text-slate-subtle">No alerts</div>}
                  {alerts.map((alert) => (
                    <button
                      key={alert.alertId}
                      onClick={() => openAlert(alert)}
                      className={`w-full text-left px-4 py-3 border-b border-white/5 hover:bg-cyan-500/5 transition-colors ${alert.isRead ? "" : "bg-rose-500/5"}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`material-symbols-outlined text-base ${alert.isRead ? "text-slate-subtle" : "text-rose-400"}`}>crisis_alert</span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-bold text-slate-heading">{alert.title}</div>
                          <div className="text-[10px] font-mono text-rose-300 mt-0.5">Incident: {alert.incidentId}</div>
                          <div className="text-[10px] text-slate-subtle mt-1">Area: {alert.area != null ? `${alert.area.toFixed(2)} km²` : "-"} · Confidence: {alert.confidence != null ? `${alert.confidence}%` : "-"}</div>
                        </div>
                        {!alert.isRead && <span className="mt-1 w-2 h-2 rounded-full bg-rose-400 shrink-0" />}
                      </div>
                    </button>
                  ))}
                </div>
                <Link to="/incidents" onClick={() => setAlertsOpen(false)} className="block px-4 py-2.5 text-center text-[10px] font-mono font-bold text-primary hover:bg-white/5">VIEW INCIDENTS</Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className="hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-300 border border-emerald-400/20">
          <span className="relative inline-flex w-2 h-2">
            <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400 animate-ping opacity-75" />
            <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-400" />
          </span>
          <span className="font-mono text-xs font-semibold tracking-wide">LIVE SAR PIPELINE</span>
        </div>
      </div>
    </header>
  );
}
