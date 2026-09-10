import { useMemo } from "react";

/**
 * Per-stage 3D visualization for the analysis modal. Each pipeline stage
 * gets its own small CSS-3D scene (perspective + rotateX/Y/Z + translateZ,
 * true 3D transforms, no WebGL/canvas dependency) so the visual actually
 * changes as the pipeline advances rather than reusing one generic loader.
 *
 * status: "pending" | "running" | "success" | "warning" | "error" | "skipped"
 */
export default function Stage3D({ stage, status = "pending" }) {
  const dim = status === "pending";
  const failed = status === "error";
  const done = status === "success" || status === "skipped" || status === "warning";

  const toneClass = failed
    ? "text-rose-400"
    : done
    ? "text-emerald-400"
    : "text-cyan-300";

  return (
    <div
      className={`relative w-full h-40 sm:h-44 rounded-2xl overflow-hidden perspective-1000 transition-opacity duration-500 ${
        dim ? "opacity-35 saturate-50" : "opacity-100"
      }`}
    >
      <style>{`
        @keyframes s3d-lidOpen { 0%,12%{transform:rotateX(0deg)} 45%,80%{transform:rotateX(-118deg)} 100%{transform:rotateX(0deg)} }
        @keyframes s3d-popOut { 0%,20%{transform:translateY(6px) translateZ(10px) scale(.6);opacity:0} 55%{transform:translateY(-18px) translateZ(40px) scale(1);opacity:1} 85%,100%{transform:translateY(-18px) translateZ(40px) scale(1);opacity:0} }
        @keyframes s3d-slide { 0%,100%{transform:translateX(-14px) translateZ(0)} 50%{transform:translateX(14px) translateZ(18px)} }
        @keyframes s3d-cubeSpin { 0%{transform:rotateX(-18deg) rotateY(0deg)} 100%{transform:rotateX(-18deg) rotateY(360deg)} }
        @keyframes s3d-nodePulse { 0%,100%{opacity:.4;box-shadow:0 0 4px currentColor} 50%{opacity:1;box-shadow:0 0 14px currentColor} }
        @keyframes s3d-peel { 0%,15%{transform:rotateX(0deg)} 55%,85%{transform:rotateX(-165deg)} 100%{transform:rotateX(0deg)} }
        @keyframes s3d-dropPin { 0%{transform:translateY(-34px) translateZ(30px) scale(.7);opacity:0} 30%{opacity:1} 55%{transform:translateY(0px) translateZ(30px) scale(1)} 68%{transform:translateY(-6px) translateZ(30px) scale(1)} 80%,100%{transform:translateY(0px) translateZ(30px) scale(1)} }
        @keyframes s3d-globeSpin { 0%{transform:rotateY(0deg)} 100%{transform:rotateY(360deg)} }
        @keyframes s3d-wisp { 0%{transform:rotate(0deg) translateX(var(--wr,30px)) rotate(0deg) translateZ(var(--wz,0px))} 100%{transform:rotate(360deg) translateX(var(--wr,30px)) rotate(-360deg) translateZ(var(--wz,0px))} }
        @keyframes s3d-wave { 0%,100%{transform:translateY(0) rotateX(55deg)} 50%{transform:translateY(-7px) rotateX(55deg)} }
        @keyframes s3d-trail { 0%{stroke-dashoffset:120} 100%{stroke-dashoffset:0} }
        @keyframes s3d-driftDot { 0%{offset-distance:0%} 100%{offset-distance:100%} }
        @keyframes s3d-lock { 0%,100%{transform:scale(1);opacity:.7} 50%{transform:scale(1.12);opacity:1} }
      `}</style>

      {/* shared ambient backdrop */}
      <div className="absolute inset-0 bg-grid-fine bg-[length:16px_16px] opacity-20 [mask-image:radial-gradient(circle,black_40%,transparent_80%)]" />
      <div className={`absolute inset-0 ${failed ? "bg-rose-500/5" : "bg-cyan-500/5"}`} />

      <div className="relative w-full h-full flex items-center justify-center preserve-3d">
        <StageScene stage={stage} running={status === "running"} toneClass={toneClass} failed={failed} />
      </div>

      {done && !failed && (
        <span className="absolute top-2 right-2 material-symbols-outlined text-emerald-400 text-lg drop-shadow-[0_0_6px_rgba(52,211,153,0.7)]">
          check_circle
        </span>
      )}
      {failed && (
        <span className="absolute top-2 right-2 material-symbols-outlined text-rose-400 text-lg drop-shadow-[0_0_6px_rgba(251,113,133,0.7)]">
          error
        </span>
      )}
    </div>
  );
}

function StageScene({ stage, running, toneClass, failed }) {
  const play = running ? "running" : "paused";

  switch (stage) {
    case "extraction":
      return (
        <div className="relative preserve-3d" style={{ width: 70, height: 54 }}>
          {/* box */}
          <div className="absolute inset-x-0 bottom-0 h-9 rounded-b-md bg-cyan-500/15 border border-cyan-400/40" style={{ transform: "translateZ(0px)" }} />
          <div className="absolute left-0 bottom-0 w-3 h-9" style={{ background: "rgba(34,211,238,0.10)", transform: "rotateY(-90deg) translateZ(1.5px)" }} />
          {/* lid, hinged at top */}
          <div
            className="absolute inset-x-0 top-0 h-9 rounded-t-md border border-cyan-400/50 bg-cyan-400/20"
            style={{ transformOrigin: "top center", animation: `s3d-lidOpen 2.8s ease-in-out infinite`, animationPlayState: play }}
          />
          {/* popping file */}
          <span
            className={`material-symbols-outlined absolute left-1/2 -ml-2.5 top-2 text-lg ${toneClass}`}
            style={{ animation: `s3d-popOut 2.8s ease-in-out infinite`, animationPlayState: play }}
          >
            description
          </span>
        </div>
      );

    case "preprocessing":
      return (
        <div className="relative preserve-3d" style={{ width: 84, height: 60 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute inset-x-3 rounded-md border border-cyan-400/35 bg-cyan-400/10"
              style={{
                top: 8 + i * 15,
                height: 14,
                transform: `translateZ(${i * 14}px)`,
                animation: `s3d-slide ${2.2 + i * 0.3}s ease-in-out infinite`,
                animationDelay: `${i * 0.15}s`,
                animationPlayState: play,
              }}
            />
          ))}
          <span className={`material-symbols-outlined absolute -top-1 right-0 text-sm ${toneClass}`} style={{ transform: "translateZ(40px)" }}>
            tune
          </span>
        </div>
      );

    case "model_inference":
      return (
        <div className="preserve-3d" style={{ width: 64, height: 64, animation: "s3d-cubeSpin 6s linear infinite", animationPlayState: play }}>
          {[
            { t: "translateZ(32px)" },
            { t: "translateZ(-32px) rotateY(180deg)" },
            { t: "rotateY(90deg) translateZ(32px)" },
            { t: "rotateY(-90deg) translateZ(32px)" },
            { t: "rotateX(90deg) translateZ(32px)" },
            { t: "rotateX(-90deg) translateZ(32px)" },
          ].map((f, i) => (
            <div
              key={i}
              className="absolute inset-0 border border-cyan-400/30 bg-cyan-400/5 flex items-center justify-center"
              style={{ transform: f.t }}
            >
              <span
                className="w-1.5 h-1.5 rounded-full bg-cyan-300"
                style={{ animation: "s3d-nodePulse 1.4s ease-in-out infinite", animationDelay: `${i * 0.12}s`, color: "#67e8f9" }}
              />
            </div>
          ))}
        </div>
      );

    case "segmentation":
      return (
        <div className="relative preserve-3d" style={{ width: 78, height: 56 }}>
          <div className="absolute inset-0 rounded-lg border border-teal-400/40 bg-teal-400/15" />
          <div
            className="absolute inset-0 rounded-lg border border-cyan-400/40 bg-cyan-400/10 flex items-center justify-center overflow-hidden"
            style={{ transformOrigin: "top", animation: "s3d-peel 3.2s ease-in-out infinite", animationPlayState: play }}
          >
            <span className="material-symbols-outlined text-cyan-200/80 text-lg">layers</span>
          </div>
          <span className="absolute bottom-1 right-1.5 text-[9px] font-mono text-teal-300/80">MASK</span>
        </div>
      );

    case "geolocation":
      return (
        <div className="relative preserve-3d" style={{ width: 64, height: 64 }}>
          <div className="absolute inset-0 rounded-full border border-cyan-400/25" style={{ transform: "rotateX(70deg)" }} />
          <div
            className="absolute inset-[8%] rounded-full border border-cyan-300/40 bg-[radial-gradient(circle_at_35%_30%,rgba(103,232,249,0.4),rgba(10,20,32,0.9)_70%)]"
            style={{ animation: "s3d-globeSpin 7s linear infinite", animationPlayState: play }}
          />
          <span
            className={`material-symbols-outlined absolute left-1/2 -ml-2.5 top-0 text-xl ${toneClass}`}
            style={{ animation: "s3d-dropPin 2.6s ease-in-out infinite", animationPlayState: play }}
          >
            location_on
          </span>
        </div>
      );

    case "environmental_data":
      return (
        <div className="relative preserve-3d" style={{ width: 84, height: 70 }}>
          <span className={`material-symbols-outlined absolute left-1/2 top-1/2 -ml-2.5 -mt-2.5 text-lg ${toneClass}`}>air</span>
          {[
            { r: 26, z: 10, d: "3.2s", c: "bg-cyan-300" },
            { r: 34, z: -8, d: "4.4s", c: "bg-teal-300" },
            { r: 20, z: 20, d: "2.6s", c: "bg-sky-300" },
          ].map((p, i) => (
            <span
              key={i}
              className={`absolute left-1/2 top-1/2 w-1.5 h-1.5 -ml-[3px] -mt-[3px] rounded-full ${p.c}`}
              style={{
                "--wr": `${p.r}px`,
                "--wz": `${p.z}px`,
                animation: `s3d-wisp ${p.d} linear infinite`,
                animationPlayState: play,
                boxShadow: "0 0 8px currentColor",
              }}
            />
          ))}
        </div>
      );

    case "drift_hindcast":
      return (
        <div className="relative preserve-3d" style={{ width: 90, height: 64 }}>
          {[0, 1, 2].map((i) => (
            <div
              key={i}
              className="absolute inset-x-2 rounded-sm bg-cyan-400/10 border-t border-cyan-300/30"
              style={{
                top: 10 + i * 12,
                height: 10,
                animation: `s3d-wave 2.4s ease-in-out infinite`,
                animationDelay: `${i * 0.25}s`,
                animationPlayState: play,
              }}
            />
          ))}
          <svg viewBox="0 0 90 64" className="absolute inset-0 w-full h-full overflow-visible">
            <path
              d="M78 14 C 50 10, 30 40, 14 50"
              fill="none"
              stroke="rgba(103,232,249,0.55)"
              strokeWidth="1.5"
              strokeDasharray="4 4"
              style={{ animation: "s3d-trail 3s linear infinite", animationPlayState: play }}
            />
          </svg>
          <span className={`material-symbols-outlined absolute top-1.5 right-1.5 text-base ${toneClass}`}>waves</span>
        </div>
      );

    case "vessel_attribution":
      return (
        <div className="relative preserve-3d flex items-center justify-center" style={{ width: 70, height: 70 }}>
          <div className="absolute inset-0 rounded-full overflow-hidden border border-cyan-400/25" style={{ transform: "rotateX(62deg)" }}>
            <div
              className="radar-sweep absolute inset-0"
              style={{ background: "conic-gradient(from 0deg, rgba(34,211,238,0.5), transparent 26%)", animationPlayState: play }}
            />
          </div>
          <span className="absolute w-8 h-8 rounded-full border border-cyan-300/40" style={{ animation: "s3d-lock 2s ease-in-out infinite", animationPlayState: play }} />
          <span className={`material-symbols-outlined relative text-xl ${toneClass}`} style={{ transform: "translateZ(20px)" }}>
            directions_boat
          </span>
        </div>
      );

    default:
      return (
        <span className={`material-symbols-outlined text-3xl ${toneClass} ${running ? "animate-spin" : ""}`}>
          {failed ? "error" : "satellite_alt"}
        </span>
      );
  }
}