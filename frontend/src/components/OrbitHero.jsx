import { useRef } from "react";

/**
 * Pure-CSS 3D "surveillance globe" — a tilted, rotating ring system with an
 * orbiting satellite marker and a sweeping radar scan, built with real 3D
 * transforms (perspective + rotateX/Y + translateZ), not a flat illustration.
 * Reacts to pointer movement for a subtle parallax tilt. No render-heavy
 * dependency (no WebGL) so it stays fast on every device.
 */
export default function OrbitHero({ className = "" }) {
  const wrapRef = useRef(null);

  function handleMove(e) {
    const el = wrapRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width - 0.5;
    const y = (e.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty("--rx", `${(-y * 10).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(x * 14).toFixed(2)}deg`);
  }

  function handleLeave() {
    const el = wrapRef.current;
    if (!el) return;
    el.style.setProperty("--rx", `6deg`);
    el.style.setProperty("--ry", `0deg`);
  }

  return (
    <div
      ref={wrapRef}
      onMouseMove={handleMove}
      onMouseLeave={handleLeave}
      className={`relative perspective-1000 select-none ${className}`}
      style={{ "--rx": "6deg", "--ry": "0deg" }}
    >
      <div
        className="relative w-full h-full preserve-3d transition-transform duration-500 ease-out-expo"
        style={{ transform: "rotateX(var(--rx)) rotateY(var(--ry))" }}
      >
        {/* core globe */}
        <div className="absolute inset-[18%] rounded-full bg-[radial-gradient(circle_at_32%_28%,rgba(103,232,249,0.55),rgba(15,31,48,0.9)_60%,rgba(3,9,16,0.95)_100%)] shadow-glow-lg" />
        <div className="absolute inset-[18%] rounded-full opacity-70 bg-grid-fine bg-[length:14px_14px] [mask-image:radial-gradient(circle,black_55%,transparent_75%)]" />

        {/* orbit rings, each on its own 3D plane */}
        <div className="absolute inset-[6%] rounded-full border border-cyan-300/25" style={{ transform: "rotateX(75deg)" }} />
        <div className="absolute inset-[0%] rounded-full border border-teal-300/20 animate-spin3d" style={{ transformOrigin: "50% 50%" }} />
        <div className="absolute inset-[10%] rounded-full border border-dashed border-cyan-200/20" style={{ transform: "rotateX(70deg) rotateZ(20deg)" }} />

        {/* radar sweep painted onto the globe face */}
        <div className="absolute inset-[18%] rounded-full overflow-hidden">
          <div
            className="radar-sweep absolute inset-0"
            style={{
              background: "conic-gradient(from 0deg, rgba(34,211,238,0.5), transparent 28%)",
            }}
          />
        </div>

        {/* orbiting satellite */}
        <div
          className="absolute left-1/2 top-1/2 w-2 h-2 -ml-1 -mt-1 rounded-full bg-cyan-300 shadow-[0_0_14px_4px_rgba(34,211,238,0.65)] animate-orbit"
          style={{ "--orbit-radius": "46%", transform: "rotateX(70deg)" }}
        />
        <div
          className="absolute left-1/2 top-1/2 w-1.5 h-1.5 -ml-[3px] -mt-[3px] rounded-full bg-teal-300 shadow-[0_0_10px_3px_rgba(45,212,191,0.6)]"
          style={{
            animation: "orbit 10s linear infinite reverse",
            "--orbit-radius": "62%",
            transform: "rotateX(75deg) rotateZ(80deg)",
          }}
        />

        {/* floating data pips for depth */}
        <span className="absolute top-[8%] left-[6%] material-symbols-outlined text-cyan-300/70 text-base animate-floatY" style={{ transform: "translateZ(40px)" }}>
          satellite_alt
        </span>
        <span className="absolute bottom-[10%] right-[8%] material-symbols-outlined text-teal-300/70 text-base animate-floatY" style={{ animationDelay: "1.2s", transform: "translateZ(50px)" }}>
          directions_boat
        </span>
        <span className="absolute top-[14%] right-[4%] material-symbols-outlined text-cyan-200/60 text-sm animate-floatY" style={{ animationDelay: "0.6s", transform: "translateZ(30px)" }}>
          waves
        </span>
      </div>
    </div>
  );
}
