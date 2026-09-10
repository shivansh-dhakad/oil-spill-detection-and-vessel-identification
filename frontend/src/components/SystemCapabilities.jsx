function Pill({ children, tone = "sky" }) {
  const tones = {
    sky: "bg-sky-50 text-primary border-sky-200",
    emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
    slate: "bg-slate-50 text-slate-600 border-slate-200",
    amber: "bg-amber-50 text-amber-700 border-amber-200",
  };
  return (
    <span className={`px-2 py-0.5 rounded-full border font-mono text-[10px] font-semibold whitespace-nowrap ${tones[tone]}`}>
      {children}
    </span>
  );
}

/** Small "value over label" chip used for the one or two key stats on a card. */
function Stat({ value, label }) {
  return (
    <div className="px-2.5 py-2 rounded-lg bg-slate-50 border border-slate-100 text-center">
      <div className="font-mono text-sm font-bold text-slate-900 leading-tight">{value}</div>
      <div className="text-[9px] text-slate-400 uppercase font-semibold mt-0.5 tracking-wide">{label}</div>
    </div>
  );
}

/** Consistent icon-badge + title + status pill header used at the top of every card/row. */
function CardHeader({ icon, iconTone = "text-primary bg-sky-50 border-sky-100", title, pill, pillTone }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <div className="flex items-center gap-2.5">
        <span className={`w-8 h-8 rounded-lg border flex items-center justify-center shrink-0 ${iconTone}`}>
          <span className="material-symbols-outlined text-base">{icon}</span>
        </span>
        <h3 className="text-sm font-bold text-slate-heading tracking-tight">{title}</h3>
      </div>
      {pill && <Pill tone={pillTone}>{pill}</Pill>}
    </div>
  );
}

const ATTRIBUTION_WEIGHTS = [
  { label: "Haversine Proximity", pct: 45},
  { label: "Time Proximity", pct: 25},
  { label: "Trajectory Intersection", pct: 15 },
  { label: "Vessel Type Risk", pct: 10 },
  { label: "Speed Anomaly", pct: 5 },
];

/** Boxed weight tile used inside the Vessel Attribution Score panel. */
function WeightTile({ label, pct, desc }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 p-2.5 text-center flex flex-col items-center gap-1">
      <div className="font-mono text-lg font-extrabold text-primary leading-none">{pct}%</div>
      <div className="text-[10.5px] font-bold text-slate-heading leading-tight">{label}</div>
      <div className="text-[9.5px] text-slate-400 leading-snug">{desc}</div>
    </div>
  );
}

/**
 * Right-column card: the three data/scoring inputs behind a prediction, each
 * reduced to a one-line summary — enough to understand what feeds the model
 * without the full technical spec.
 */
export function AnalysisParametersCard() {
  return (
    <section className="bg-card-white rounded-2xl border border-border-soft shadow-sm h-full flex flex-col p-5 md:p-6">
      <div className="flex items-center justify-between pb-4 border-b border-slate-100 shrink-0">
        <h2 className="text-base font-bold text-slate-heading tracking-tight">Analysis Parameters</h2>
        <Pill tone="sky">v1.0</Pill>
      </div>

      <div className="flex-1 flex flex-col justify-evenly gap-4 py-3">
        {/* Ocean & Wind */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 space-y-2.5">
          <CardHeader icon="air" title="Ocean &amp; Wind Data" pill="Live" pillTone="emerald" />
          <p className="text-xs text-slate-body leading-relaxed pl-[42px]">
            Open-Meteo supplies wave and 10m wind data, while Copernicus Marine in-situ current observations fill
            missing ocean-current data for the backward drift hindcast.
          </p>
          <div className="flex flex-wrap gap-2 pl-[42px]">
            <Pill tone="slate">Current velocity &amp; direction</Pill>
            <Pill tone="slate">Wave height</Pill>
            <Pill tone="slate">10m wind speed</Pill>
          </div>
        </div>

        {/* AIS Tracking */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 space-y-2.5">
          <CardHeader
            icon="directions_boat"
            iconTone="text-teal-600 bg-teal-50 border-teal-100"
            title="AIS Vessel Tracking"
            pill="2 sources"
            pillTone="slate"
          />
          <p className="text-xs text-slate-body leading-relaxed pl-[42px]">
            Two APIs locate and identify vessels that could have crossed the spill zone.
          </p>
          <div className="grid grid-cols-2 gap-2 pl-[42px]">
            <div className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
              <div className="text-[11px] font-semibold text-slate-heading">Global Fishing Watch</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Historical presence &amp; vessel identity</div>
            </div>
            <div className="rounded-lg bg-white border border-slate-100 px-2.5 py-2">
              <div className="text-[11px] font-semibold text-slate-heading">AISStream</div>
              <div className="text-[10px] text-slate-400 mt-0.5">Live position feed</div>
            </div>
          </div>
        </div>

        {/* Attribution Scoring */}
        <div className="rounded-xl border border-slate-100 bg-slate-50/60 p-3.5 space-y-3">
          <CardHeader icon="insights" title="Vessel Attribution Score" pill="5-factor" pillTone="sky" />
          <p className="text-xs text-slate-body leading-relaxed pl-[42px]">
            Each candidate vessel gets a weighted score from five factors below-
          </p>
          <div className="grid grid-cols-5 gap-2">
            {ATTRIBUTION_WEIGHTS.map((w) => (
              <WeightTile key={w.label} label={w.label} pct={w.pct} desc={w.desc} />
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

/** Left-column card: the UNet++ detection model, at a glance. */
export function DetectionModelCard() {
  return (
    <section className="bg-card-white rounded-2xl border border-border-soft shadow-sm p-5">
      <CardHeader icon="memory" title="Detection Model" pill="UNet++ (ResNet34)" pillTone="sky" />
      <p className="text-xs text-slate-body leading-relaxed mt-3">
        Binary UNet++ segments each SAR image pixel as oil or background to locate the slick — 85.4% val IoU / 90.9%
        Dice after 38 training epochs.
      </p>
      <div className="grid grid-cols-3 gap-2 mt-3">
        <Stat value="256²" label="Input Size" />
        <Stat value="~26.1M" label="Param" />
        <Stat value="85.4%" label="Val IoU" />
      </div>
    </section>
  );
}

/** Left-column card: the Isolation Forest vessel-anomaly scorer, at a glance. */
export function VesselAnomalyCard() {
  return (
    <section className="bg-card-white rounded-2xl border border-border-soft shadow-sm p-5">
      <CardHeader
        icon="radar"
        iconTone="text-teal-600 bg-teal-50 border-teal-100"
        title="Anomaly Detection"
        pill="Active"
        pillTone="emerald"
      />
      <p className="text-xs text-slate-body leading-relaxed mt-3">
        Flags unusual vessel behavior near the spill and folds it into the ranking.
      </p>
      <div className="grid grid-cols-2 gap-2 mt-3">
        <Stat value="200" label="Estimators" />
        <Stat value="8" label="Features" />
      </div>
    </section>
  );
}

/** Combined stack (kept for any other layout that wants all three cards in one flow). */
export default function SystemCapabilities() {
  return (
    <div className="space-y-4">
      <AnalysisParametersCard />
      <div className="grid grid-cols-2 gap-4">
        <DetectionModelCard />
        <VesselAnomalyCard />
      </div>
    </div>
  );
}