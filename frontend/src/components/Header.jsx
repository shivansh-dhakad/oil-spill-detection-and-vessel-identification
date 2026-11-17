import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { motion, AnimatePresence } from "framer-motion";
import { api } from "../api.js";

const NAV_LINKS = [
  { to: "/", label: "Dashboard", icon: "dashboard" },
  { to: "/history", label: "History", icon: "history" },
];

// Routes that use the light (paper) theme. Keep in sync with LIGHT_ROUTES in App.jsx.
const LIGHT_ROUTES = ["/", "/history", "/batch"];
const isLightPath = (p) => LIGHT_ROUTES.includes(p) || p.startsWith("/results/");

// Light (paper) styling is used on the routes above; every other
// page keeps the original dark glass header.
const LIGHT = {
  bar: "bg-[rgba(243,239,230,0.86)] backdrop-blur-xl border-b border-[rgba(12,35,64,0.1)]",
  logo: "bg-[#0c2340] border border-[#0c2340] text-[#f3efe6]",
  logoIcon: "text-[#f3efe6]",
  brand: "text-[#0c2340]",
  badge: "bg-[rgba(12,35,64,0.06)] text-[#3c4e64] border-[rgba(12,35,64,0.12)]",
  sub: "text-[#6b7d92]",
  navOn: "text-[#0c2340]",
  navOff: "text-[#6b7d92] hover:text-[#0c2340]",
  navPill: "bg-[rgba(12,35,64,0.07)] border border-[rgba(12,35,64,0.12)]",
  bell: "border-[rgba(12,35,64,0.14)] bg-[rgba(12,35,64,0.04)] text-[#3c4e64] hover:text-[#0f7f8c] hover:border-[rgba(15,127,140,0.45)]",
  live: "bg-[rgba(15,127,140,0.1)] text-[#0f6f7a] border-[rgba(15,127,140,0.25)]",
  liveDot: "bg-[#0f7f8c]",
  menu: "bg-[#fbf9f3] border border-[rgba(12,35,64,0.12)] shadow-[0_24px_50px_-24px_rgba(12,35,64,0.45)]",
  divider: "border-[rgba(12,35,64,0.08)]",
  title: "text-[#0c2340]",
  muted: "text-[#6b7d92]",
  accent: "text-[#0f7f8c] hover:text-[#0c2340]",
  itemHover: "hover:bg-[rgba(15,127,140,0.06)]",
  unreadBg: "bg-[rgba(226,83,43,0.06)]",
  alertIcon: "text-[#e2532b]",
  incident: "text-[#c23e18]",
  footerHover: "hover:bg-[rgba(12,35,64,0.04)]",
};

const DARK = {
  bar: "glass-panel border-b border-white/5 shadow-[0_1px_0_0_rgba(34,211,238,0.08)]",
  logo: "bg-cyan-500/10 border border-cyan-400/30 text-primary shadow-glow",
  logoIcon: "text-primary",
  brand: "gradient-text",
  badge: "bg-cyan-500/10 text-cyan-300 border-cyan-400/20",
  sub: "text-slate-subtle",
  navOn: "text-cyan-300",
  navOff: "text-slate-subtle hover:text-slate-heading",
  navPill: "bg-cyan-500/10 border border-cyan-400/20 shadow-glow",
  bell: "border-white/10 bg-white/5 text-slate-subtle hover:text-primary hover:border-cyan-400/30",
  live: "bg-emerald-500/10 text-emerald-300 border-emerald-400/20",
  liveDot: "bg-emerald-400",
  menu: "glass-panel shadow-glow-lg",
  divider: "border-white/5",
  title: "text-slate-heading",
  muted: "text-slate-subtle",
  accent: "text-primary hover:text-cyan-200",
  itemHover: "hover:bg-cyan-500/5",
  unreadBg: "bg-rose-500/5",
  alertIcon: "text-rose-400",
  incident: "text-rose-300",
  footerHover: "hover:bg-white/5",
};

export default function Header() {
  const location = useLocation();
  const navigate = useNavigate();
  const [alerts, setAlerts] = useState([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [alertsOpen, setAlertsOpen] = useState(false);

  const light = isLightPath(location.pathname);
  const t = light ? LIGHT : DARK;

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
        setAlerts((current) => current.filter((item) => item.alertId !== alert.alertId));
        setUnreadCount((count) => Math.max(0, count - 1));
      }
    } finally {
      setAlertsOpen(false);
      if (alert.predictionId) navigate(`/results/${alert.predictionId}`);
      else navigate(`/incidents`);
    }
  }

  async function clearAlerts() {
    try {
      await api.markAllAlertsRead();
      setAlerts([]);
      setUnreadCount(0);
    } catch {
      // Keep the current alerts visible when the server cannot update them.
    }
  }

  return (
    // No transition-colors here: it made the bar fade through grey when the theme flipped.
    <header className={`fixed top-0 left-0 w-full z-50 flex items-center justify-between px-6 md:px-8 h-16 ${t.bar}`}>
      <Link to="/" className="flex items-center gap-3 group">
        <div className={`relative w-10 h-10 rounded-xl flex items-center justify-center overflow-hidden ${t.logo}`}>
          <span className="absolute inset-0 rounded-xl animate-ringPulse" />
          <span className={`material-symbols-outlined text-2xl transition-transform duration-500 group-hover:rotate-[18deg] ${t.logoIcon}`}>satellite_alt</span>
        </div>
        <div className="flex flex-col">
          <span className={`text-base font-bold font-display tracking-tight flex items-center gap-2 ${t.brand}`}>
            VarunaDrishti
            <span className={`hidden sm:inline-block px-2 py-0.5 rounded-full text-[11px] font-mono font-medium border ${t.badge}`}>
              v1.0
            </span>
          </span>
          <span className={`text-xs font-mono tracking-wide uppercase ${t.sub}`}>
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
              className={`relative px-3 py-2 rounded-lg font-semibold text-sm flex items-center gap-2 transition-colors ${active ? t.navOn : t.navOff}`}
            >
              {active && (
                <motion.span
                  layoutId="nav-active-pill"
                  className={`absolute inset-0 rounded-lg ${t.navPill}`}
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
            className={`relative w-10 h-10 rounded-xl border transition-colors flex items-center justify-center ${t.bell}`}
            title="Notifications"
          >
            <span className="material-symbols-outlined text-xl">notifications</span>
            {unreadCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-5 h-5 px-1 rounded-full bg-rose-500 text-white text-[10px] font-mono font-bold flex items-center justify-center animate-glowPulse">
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
                className={`absolute right-0 top-12 z-[60] w-80 rounded-xl overflow-hidden ${t.menu}`}
              >
                <div className={`px-4 py-3 border-b flex items-center justify-between ${t.divider}`}>
                  <span className={`text-xs font-bold ${t.title}`}>Oil Spill Alerts</span>
                  <div className="flex items-center gap-3">
                    <span className={`text-[10px] font-mono ${t.muted}`}>{unreadCount} UNREAD</span>
                    {!!alerts.length && (
                      <button
                        type="button"
                        onClick={clearAlerts}
                        className={`text-[10px] font-mono font-bold transition-colors ${t.accent}`}
                      >
                        CLEAR ALL
                      </button>
                    )}
                  </div>
                </div>
                <div className="max-h-80 overflow-y-auto custom-scrollbar">
                  {!alerts.length && <div className={`p-6 text-center text-xs font-mono ${t.muted}`}>No alerts</div>}
                  {alerts.map((alert) => (
                    <button
                      key={alert.alertId}
                      onClick={() => openAlert(alert)}
                      className={`w-full text-left px-4 py-3 border-b transition-colors ${t.divider} ${t.itemHover} ${alert.isRead ? "" : t.unreadBg}`}
                    >
                      <div className="flex items-start gap-2">
                        <span className={`material-symbols-outlined text-base ${alert.isRead ? t.muted : t.alertIcon}`}>crisis_alert</span>
                        <div className="min-w-0 flex-1">
                          <div className={`text-xs font-bold ${t.title}`}>{alert.title}</div>
                          <div className={`text-[10px] font-mono mt-0.5 ${t.incident}`}>Incident: {alert.incidentId}</div>
                          <div className={`text-[10px] mt-1 ${t.muted}`}>Area: {alert.area != null ? `${alert.area.toFixed(2)} km²` : "-"} · Confidence: {alert.confidence != null ? `${alert.confidence}%` : "-"}</div>
                        </div>
                        {!alert.isRead && <span className="mt-1 w-2 h-2 rounded-full bg-rose-400 shrink-0" />}
                      </div>
                    </button>
                  ))}
                </div>
                <Link to="/incidents" onClick={() => setAlertsOpen(false)} className={`block px-4 py-2.5 text-center text-[10px] font-mono font-bold ${t.accent} ${t.footerHover}`}>VIEW INCIDENTS</Link>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        <div className={`hidden md:flex items-center gap-2 px-2.5 py-1 rounded-full border ${t.live}`}>
          <span className="relative inline-flex w-2 h-2">
            <span className={`absolute inline-flex h-full w-full rounded-full animate-ping opacity-75 ${t.liveDot}`} />
            <span className={`relative inline-flex rounded-full h-2 w-2 ${t.liveDot}`} />
          </span>
          <span className="font-mono text-xs font-semibold tracking-wide">LIVE SAR PIPELINE</span>
        </div>
      </div>
    </header>
  );
}