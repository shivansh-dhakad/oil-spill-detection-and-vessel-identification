// Charts.jsx - lightweight, dependency-free SVG chart primitives for the
// analysis report. Light "survey chart" palette (matches dashboard.css).
// Hex colors are used on purpose: CSS variables don't resolve reliably in
// SVG presentation attributes.

const INK = "#0c2340";
const INK2 = "#3c4e64";
const INK3 = "#6b7d92";
const SEA = "#0f7f8c";
const SLICK = "#e2532b";
const PAPER = "#fbf9f3";
const GRID = "rgba(12,35,64,0.1)";
const TRACK = "rgba(12,35,64,0.07)";
const MONO = "JetBrains Mono, monospace";

function clamp01(v) {
  return Math.max(0, Math.min(1, v));
}

function rankFill(rank) {
  return rank === 1 ? "#7f1d1d" : rank === 2 ? "#f97316" : rank === 3 ? "#eab308" : "#2563eb";
}

/** Horizontal bar chart - one bar per data point, 0-100 scale by default. */
export function BarChart({ data = [], max = 100, valueSuffix = "%", height: customHeight }) {
  if (!data.length) return null;
  const barHeight = 22;
  const rowGap = 12;
  const totalHeight = customHeight || data.length * (barHeight + rowGap) + 12;

  return (
    <svg viewBox={`0 0 360 ${totalHeight}`} className="w-full" style={{ height: totalHeight }}>
      {data.map((d, i) => {
        const val = Math.max(0, d.value ?? 0);
        const w = clamp01(val / max) * 195;
        const y = i * (barHeight + rowGap) + 6;
        const barColor = d.color || SEA;
        return (
          <g key={d.label || i}>
            <text x="0" y={y + barHeight / 2 + 4} fontSize="10" fill={INK2} fontFamily={MONO} fontWeight="600">
              {d.label && d.label.length > 15 ? `${d.label.slice(0, 14)}…` : d.label || `Item ${i + 1}`}
            </text>
            <rect x="105" y={y} width="195" height={barHeight} rx="6" fill={TRACK} stroke={GRID} />
            <rect x="105" y={y} width={Math.max(4, w)} height={barHeight} rx="6" fill={barColor} opacity="0.92" />
            <text x="308" y={y + barHeight / 2 + 4} fontSize="10" fill={INK} fontFamily={MONO} fontWeight="700">
              {d.value != null ? `${d.value}${valueSuffix}` : "—"}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

/** Multi-series line chart with grid, axis labels, and legend. */
export function LineChart({
  series = [],
  xLabels = [],
  height = 190,
  yLabel = "",
  xLabel = "Backtrack Hours (T - h)",
}) {
  const allValues = series
    .flatMap((s) => (s.points || []).map((p) => p.y))
    .filter((v) => v != null && Number.isFinite(v));

  if (!allValues.length) {
    return (
      <div className="lr-empty">No environmental trajectory data available to chart.</div>
    );
  }

  const rawMin = Math.min(...allValues);
  const rawMax = Math.max(...allValues);
  const minY = Math.floor(Math.max(0, rawMin - (rawMax - rawMin) * 0.1));
  const maxY = Math.ceil(rawMax + (rawMax - rawMin) * 0.1 || 1);
  const rangeY = maxY - minY || 1;

  const width = 420;
  const paddingL = 36;
  const paddingR = 20;
  const paddingT = 26;
  const paddingB = 34;
  const plotW = width - paddingL - paddingR;
  const plotH = height - paddingT - paddingB;

  function toPolyline(points) {
    const n = points.length;
    const coords = [];
    points.forEach((p, idx) => {
      if (p.y == null || !Number.isFinite(p.y)) return;
      const x = paddingL + (idx / Math.max(1, n - 1)) * plotW;
      const y = paddingT + plotH - ((p.y - minY) / rangeY) * plotH;
      coords.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    });
    return coords.join(" ");
  }

  const maxPointsLen = Math.max(...series.map((s) => (s.points || []).length), 1);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" style={{ height }}>
        {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
          const y = paddingT + plotH * (1 - ratio);
          const val = minY + rangeY * ratio;
          return (
            <g key={ratio}>
              <line x1={paddingL} y1={y} x2={width - paddingR} y2={y} stroke={GRID} strokeDasharray="3 3" />
              <text x={paddingL - 6} y={y + 3} fontSize="8" fill={INK3} fontFamily={MONO} textAnchor="end">
                {val.toFixed(1)}
              </text>
            </g>
          );
        })}

        <line x1={paddingL} y1={paddingT + plotH} x2={width - paddingR} y2={paddingT + plotH} stroke="rgba(12,35,64,0.3)" strokeWidth="1" />

        {series.map((s) => (
          <g key={s.name}>
            <polyline points={toPolyline(s.points)} fill="none" stroke={s.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {(s.points || []).map((p, idx) => {
              if (p.y == null || !Number.isFinite(p.y)) return null;
              const x = paddingL + (idx / Math.max(1, (s.points || []).length - 1)) * plotW;
              const y = paddingT + plotH - ((p.y - minY) / rangeY) * plotH;
              return <circle key={idx} cx={x} cy={y} r="3" fill={s.color} stroke={PAPER} strokeWidth="1.5" />;
            })}
          </g>
        ))}

        {Array.from({ length: Math.min(maxPointsLen, 6) }).map((_, i, arr) => {
          const idx = Math.round((i / (arr.length - 1 || 1)) * (maxPointsLen - 1));
          const x = paddingL + (idx / Math.max(1, maxPointsLen - 1)) * plotW;
          const label = xLabels[idx] || (idx === 0 ? "Detect" : idx === maxPointsLen - 1 ? "Origin" : `T-${idx}h`);
          return (
            <text key={i} x={x} y={paddingT + plotH + 15} fontSize="8" fill={INK3} fontFamily={MONO} textAnchor="middle">
              {label}
            </text>
          );
        })}

        <text x={paddingL} y={12} fontSize="9" fill={INK2} fontFamily={MONO} fontWeight="600">
          {yLabel}
        </text>

        <g transform={`translate(${width - paddingR - 140}, 4)`}>
          {series.map((s, i) => (
            <g key={s.name} transform={`translate(${i * 72}, 0)`}>
              <rect width="10" height="8" rx="2" fill={s.color} />
              <text x="14" y="7" fontSize="8.5" fill={INK} fontFamily={MONO} fontWeight="600">
                {s.name}
              </text>
            </g>
          ))}
        </g>
      </svg>
      {xLabel && (
        <div style={{ textAlign: "center", fontSize: 10, color: INK3, fontFamily: MONO, marginTop: 4 }}>{xLabel}</div>
      )}
    </div>
  );
}

/** Radar / spider chart for a small set of 0-100 evidence scores. */
export function RadarChart({ data = [], size = 240, color = SEA }) {
  const points = data.filter((d) => d.value != null);
  const n = points.length;
  if (n < 3) return null;
  const center = size / 2;
  const radius = size / 2 - 40;
  const angleStep = (Math.PI * 2) / n;

  function pointFor(i, value) {
    const angle = -Math.PI / 2 + i * angleStep;
    const r = clamp01((value ?? 0) / 100) * radius;
    return [center + r * Math.cos(angle), center + r * Math.sin(angle)];
  }
  function labelPointFor(i) {
    const angle = -Math.PI / 2 + i * angleStep;
    return [center + (radius + 24) * Math.cos(angle), center + (radius + 24) * Math.sin(angle)];
  }

  const dataPolygon = points.map((d, i) => pointFor(i, d.value).join(",")).join(" ");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size, maxWidth: "100%" }}>
      {[0.25, 0.5, 0.75, 1].map((r) => (
        <polygon
          key={r}
          points={Array.from({ length: n }, (_, i) => {
            const angle = -Math.PI / 2 + i * angleStep;
            return `${center + r * radius * Math.cos(angle)},${center + r * radius * Math.sin(angle)}`;
          }).join(" ")}
          fill="none"
          stroke="rgba(12,35,64,0.16)"
          strokeWidth="1"
        />
      ))}
      {points.map((_, i) => {
        const angle = -Math.PI / 2 + i * angleStep;
        return (
          <line key={i} x1={center} y1={center} x2={center + radius * Math.cos(angle)} y2={center + radius * Math.sin(angle)} stroke="rgba(12,35,64,0.16)" strokeWidth="1" />
        );
      })}
      <polygon points={dataPolygon} fill={color} fillOpacity="0.22" stroke={color} strokeWidth="2" />
      {points.map((d, i) => {
        const [x, y] = pointFor(i, d.value);
        return <circle key={d.label} cx={x} cy={y} r="3.5" fill={color} stroke={PAPER} strokeWidth="1.5" />;
      })}
      {points.map((d, i) => {
        const [x, y] = labelPointFor(i);
        return (
          <text key={d.label} x={x} y={y} fontSize="9" fill={INK} fontFamily={MONO} fontWeight="700" textAnchor="middle" dominantBaseline="middle">
            {d.label}
          </text>
        );
      })}
    </svg>
  );
}

/**
 * Vessel closeness to spill origin at the estimated release time.
 * Shorter bar = closer to origin = higher spatiotemporal suspicion.
 */
export function VesselProximityToOriginChart({ candidates = [] }) {
  if (!candidates || candidates.length === 0) return null;

  const list = candidates
    .filter((c) => c.proximityNm != null || c.distanceKm != null)
    .slice(0, 6)
    .map((c) => {
      const distNm = c.proximityNm != null ? c.proximityNm : +(c.distanceKm * 0.539957).toFixed(2);
      const distKm = c.distanceKm != null ? c.distanceKm : +(distNm * 1.852).toFixed(2);
      return { ...c, distNm, distKm };
    });

  if (list.length === 0) return null;

  const maxVal = Math.max(...list.map((c) => c.distNm), 10);
  const rowHeight = 36;
  const totalHeight = list.length * (rowHeight + 8) + 24;
  const width = 440;
  const barMaxW = 170;
  const barStartX = 140;

  return (
    <div className="w-full overflow-hidden">
      <svg viewBox={`0 0 ${width} ${totalHeight}`} className="w-full" style={{ height: totalHeight }}>
        <line x1={barStartX} y1={6} x2={barStartX} y2={totalHeight - 12} stroke={SLICK} strokeWidth="1.5" strokeDasharray="2 2" />
        <text x={barStartX} y={10} fontSize="8" fill={SLICK} fontFamily={MONO} textAnchor="middle" fontWeight="bold">
          ORIGIN (0 NM)
        </text>

        {list.map((c, i) => {
          const y = i * (rowHeight + 8) + 20;
          const barW = Math.max(4, Math.min(barMaxW, (c.distNm / maxVal) * barMaxW));
          const fill = rankFill(c.rank);
          return (
            <g key={c.mmsi || c.name || i}>
              <circle cx="10" cy={y + 12} r="8" fill={fill} />
              <text x="10" y={y + 15} fontSize="9" fill="#ffffff" fontFamily={MONO} fontWeight="bold" textAnchor="middle">
                {c.rank || i + 1}
              </text>
              <text x="24" y={y + 10} fontSize="10" fill={INK} fontFamily="sans-serif" fontWeight="bold">
                {c.name && c.name.length > 14 ? `${c.name.slice(0, 13)}…` : c.name || `MMSI ${c.mmsi}`}
              </text>
              <text x="24" y={y + 22} fontSize="8.5" fill={INK3} fontFamily={MONO}>
                {c.timeDeltaMin != null ? `Δt: ${c.timeDeltaMin}m` : c.vesselType || "Vessel"}
                {c.speedKts != null ? ` • ${c.speedKts}kts` : ""}
              </text>
              <rect x={barStartX} y={y + 4} width={barMaxW} height={16} rx="4" fill={TRACK} stroke={GRID} />
              <rect x={barStartX} y={y + 4} width={barW} height={16} rx="4" fill={fill} opacity="0.88" />
              <text x={barStartX + barW + 8} y={y + 16} fontSize="9.5" fill={INK} fontFamily={MONO} fontWeight="bold">
                {c.distNm} NM
                <tspan fontSize="8" fill={INK3} dx="4">
                  ({c.distKm} km)
                </tspan>
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Vessel speed (SOG) vs distance-to-origin kinematics scatter. */
export function VesselKinematicsChart({ candidates = [] }) {
  const withSpeed = candidates
    .filter((c) => c.speedKts != null && (c.proximityNm != null || c.distanceKm != null))
    .slice(0, 6);

  if (withSpeed.length === 0) return null;

  const width = 420;
  const height = 160;
  const paddingL = 36;
  const paddingR = 24;
  const paddingT = 20;
  const paddingB = 30;
  const plotW = width - paddingL - paddingR;
  const plotH = height - paddingT - paddingB;

  const maxDist = Math.max(...withSpeed.map((c) => c.proximityNm || c.distanceKm * 0.54), 10);
  const maxSpeed = Math.max(...withSpeed.map((c) => c.speedKts), 20);

  return (
    <div className="w-full">
      <svg viewBox={`0 0 ${width} ${height}`} className="w-full" style={{ height }}>
        <line x1={paddingL} y1={paddingT} x2={paddingL} y2={paddingT + plotH} stroke="rgba(12,35,64,0.3)" />
        <line x1={paddingL} y1={paddingT + plotH} x2={width - paddingR} y2={paddingT + plotH} stroke="rgba(12,35,64,0.3)" />

        <text x={paddingL} y={12} fontSize="8.5" fill={INK2} fontFamily={MONO} fontWeight="600">
          SOG Speed (kts)
        </text>
        <text x={width - paddingR} y={height - 6} fontSize="8.5" fill={INK2} fontFamily={MONO} textAnchor="end" fontWeight="600">
          Distance to Origin (NM) →
        </text>

        <rect x={paddingL} y={paddingT} width={Math.min(plotW, plotW * (5 / maxDist))} height={plotH} fill="rgba(226,83,43,0.09)" stroke="rgba(226,83,43,0.3)" strokeDasharray="2 2" />
        <text x={paddingL + 4} y={paddingT + 12} fontSize="7.5" fill="#c23e18" fontFamily={MONO}>
          &lt;5 NM Immediate Zone
        </text>

        {withSpeed.map((c) => {
          const dist = c.proximityNm || c.distanceKm * 0.54;
          const x = paddingL + (dist / maxDist) * plotW;
          const y = paddingT + plotH - (c.speedKts / maxSpeed) * plotH;
          return (
            <g key={c.mmsi || c.name}>
              <circle cx={x} cy={y} r="6" fill={rankFill(c.rank)} stroke={PAPER} strokeWidth="1.5" />
              <text x={x} y={y - 9} fontSize="8" fill={INK} fontFamily={MONO} fontWeight="bold" textAnchor="middle">
                #{c.rank} {c.name ? c.name.slice(0, 8) : c.mmsi}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}