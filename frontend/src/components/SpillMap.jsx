import { useEffect, useMemo, useRef } from "react";
import { MapContainer, TileLayer, CircleMarker, Circle, Marker, Polygon, Polyline, Popup, ZoomControl, useMap } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

function FitBounds({ points }) {
  const map = useMap();
  const fitted = useRef(false);
  useEffect(() => {
    if (fitted.current || !Array.isArray(points) || points.length === 0) return;
    const validPoints = points.filter(
      (p) => Array.isArray(p) && p.length === 2 && Number.isFinite(p[0]) && Number.isFinite(p[1])
    );
    if (validPoints.length === 0) return;
    if (validPoints.length === 1) {
      map.setView(validPoints[0], 9);
    } else {
      try {
        map.fitBounds(validPoints, { padding: [48, 48], maxZoom: 11 });
      } catch (err) {
        map.setView(validPoints[0], 9);
      }
    }
    fitted.current = true;
  }, [points, map]);
  return null;
}

function probabilityColor(probability) {
  if (probability == null) return "#94a3b8";
  if (probability >= 75) return "#0284c7";
  if (probability >= 45) return "#f59e0b";
  return "#94a3b8";
}

// Map legend ranking colors: #1 closest -> dark red, #2 -> orange,
// #3 -> yellow, everyone else -> blue. Falls back to the Bayesian
// probability color when a vessel has no Haversine proximity rank at all.
function rankColor(rank) {
  if (rank === 1) return "#7f1d1d";
  if (rank === 2) return "#f97316";
  if (rank === 3) return "#eab308";
  return "#2563eb";
}

function vesselMarkerColor(v, isSelected) {
  if (isSelected) return "#16a34a";
  if (v.proximityColor) return v.proximityColor;
  if (v.proximityRank) return rankColor(v.proximityRank);
  return probabilityColor(v.probability);
}

// Every vessel on the map (selected or not, current position or a historical
// fix) is drawn as a triangle rather than a plain dot - built as a small
// upward-pointing CSS triangle via a Leaflet divIcon so it needs no external
// image asset. `heading` (course-over-ground, degrees) rotates the triangle
// to actually point the way the vessel is heading when it's known.
function vesselTriangleIcon({ color, size = 16, selected = false, heading = null }) {
  const s = selected ? size + 6 : size;
  const rotation = heading != null ? `rotate(${heading}deg)` : "rotate(0deg)";
  const html = `
    <div style="width:${s}px;height:${s}px;transform:${rotation};transform-origin:50% 50%;">
      <div style="
        width:0;height:0;margin:0 auto;
        border-left:${s / 2}px solid transparent;
        border-right:${s / 2}px solid transparent;
        border-bottom:${s}px solid ${color};
      "></div>
    </div>`;
  return L.divIcon({
    className: "vessel-triangle-icon",
    html,
    iconSize: [s, s],
    iconAnchor: [s / 2, s * 0.65],
    popupAnchor: [0, -s * 0.65],
  });
}

// Lightweight vessel-density "heatmap" built from overlapping, low-opacity
// Leaflet circles (radius in meters) rather than pulling in an extra heatmap
// dependency - denser vessel clusters naturally read as darker patches since
// the circles' fills stack.
function VesselDensityHeatmap({ vessels }) {
  const pts = vessels.filter((v) => v.lat != null && v.lon != null);
  if (pts.length === 0) return null;
  return (
    <>
      {pts.map((v, i) => (
        <Circle
          key={`heat-${v.mmsi || v.name || i}`}
          center={[v.lat, v.lon]}
          radius={22000}
          pathOptions={{
            stroke: false,
            fillColor: "#dc2626",
            fillOpacity: 0.07,
          }}
          interactive={false}
        />
      ))}
    </>
  );
}

// Static legend box matching the investigation map's color key.
function MapLegend() {
  const rows = [
    { color: "#e11d48", label: "Spill Origin", shape: "circle" },
    { color: "#7f1d1d", label: "Closest Vessel (#1)", shape: "triangle" },
    { color: "#f97316", label: "2nd Closest (#2)", shape: "triangle" },
    { color: "#eab308", label: "3rd Closest (#3)", shape: "triangle" },
    { color: "#2563eb", label: "Other Vessels", shape: "triangle" },
    { color: "#9ca3af", label: "Distance to Origin", shape: "line" },
  ];
  return (
    <div className="absolute top-60 left-5 z-[500] bg-white/95 backdrop-blur-md border border-slate-200/80 rounded-xl shadow-lg px-3 py-2.5 text-[11px] font-mono">
      <div className="font-bold text-slate-700 mb-1.5 text-[10px] uppercase tracking-wide">Map Legend</div>
      <div className="space-y-1">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center gap-2">
            {r.shape === "circle" && (
              <span className="inline-block w-2.5 h-2.5 rounded-full shrink-0" style={{ background: r.color }} />
            )}
            {r.shape === "triangle" && (
              <span
                className="inline-block w-0 h-0 shrink-0"
                style={{
                  borderLeft: "5px solid transparent",
                  borderRight: "5px solid transparent",
                  borderBottom: `9px solid ${r.color}`,
                }}
              />
            )}
            {r.shape === "line" && <span className="inline-block w-3 h-0.5 shrink-0" style={{ background: r.color }} />}
            <span className="text-slate-600">{r.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

/**
 * OpenStreetMap tile map showing:
 *  - a single oil-spill mark at the detected slick centroid (no boundary
 *    polygon/circle is drawn - just the mark itself)
 *  - the estimated drift origin, and (when a candidate with a real AIS track
 *    is selected) a dotted line from that origin to the selected vessel's
 *    interpolated position at the estimated spill time
 *  - every vessel candidate drawn as a triangle mark, colored/sized by
 *    attribution probability and selection state
 *  - the selected vessel's full journey (a solid path from its earliest to
 *    its latest AIS fix), when a candidate with real position history is
 *    selected
 *
 * All coordinates are optional - the map still renders (centered on India's
 * EEZ / the given fallback) when a run has no real geolocation yet.
 */
export default function SpillMap({
  spillCenter,
  spillPolygon = [],
  driftOrigin,
  trajectoryPoints = [],
  vessels = [],
  selectedVessel = null,
  fallbackCenter,
  showHeatmap = true,
  showLegend = true,
  showDistanceLines = true,
}) {
  const rawCenter = spillCenter || fallbackCenter || { lat: 15, lon: 75 };
  const centerLat = Number.isFinite(rawCenter?.lat) ? rawCenter.lat : 15;
  const centerLon = Number.isFinite(rawCenter?.lon) ? rawCenter.lon : 75;

  // Gray line from every vessel with a known position back to the spill
  // origin (falls back to the drift-hindcast origin when no direct detection
  // centroid is available), per the investigation map spec.
  const originForLines = spillCenter || driftOrigin || null;
  const distanceLines = useMemo(() => {
    if (!originForLines || !Number.isFinite(originForLines.lat) || !Number.isFinite(originForLines.lon)) return [];
    return vessels
      .filter((v) => Number.isFinite(v.lat) && Number.isFinite(v.lon))
      .map((v) => ({
        key: v.mmsi || v.name,
        positions: [[originForLines.lat, originForLines.lon], [v.lat, v.lon]],
      }));
  }, [vessels, originForLines]);

  const trajectoryLatLngs = useMemo(
    () => trajectoryPoints.filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon)).map((p) => [p.lat, p.lon]),
    [trajectoryPoints]
  );

  const boundaryPolygons = useMemo(
    () => spillPolygon
      .filter((patch) => Array.isArray(patch) && patch.length >= 3)
      .map((patch) => patch.filter((point) => Array.isArray(point) && point.length === 2 && Number.isFinite(point[0]) && Number.isFinite(point[1])))
      .filter((patch) => patch.length >= 3),
    [spillPolygon]
  );

  // The selected vessel's full journey: start (earliest fix) -> end (latest
  // fix), in chronological order, drawn as one continuous path.
  const journeyLatLngs = useMemo(
    () =>
      (selectedVessel?.trackPoints || [])
        .filter((p) => Number.isFinite(p.lat) && Number.isFinite(p.lon))
        .map((p) => [p.lat, p.lon]),
    [selectedVessel]
  );

  // Dotted line: spill origin -> selected vessel's position at the time of
  // the spill (interpolated from its track, not just its latest fix).
  const spillTimeLine = useMemo(() => {
    const pos = selectedVessel?.positionAtSpillTime;
    if (
      !driftOrigin ||
      !pos ||
      !Number.isFinite(driftOrigin.lat) ||
      !Number.isFinite(driftOrigin.lon) ||
      !Number.isFinite(pos.lat) ||
      !Number.isFinite(pos.lon)
    )
      return null;
    return [[driftOrigin.lat, driftOrigin.lon], [pos.lat, pos.lon]];
  }, [driftOrigin, selectedVessel]);

  const allPoints = useMemo(() => {
    const pts = [];
    if (spillCenter && Number.isFinite(spillCenter.lat) && Number.isFinite(spillCenter.lon))
      pts.push([spillCenter.lat, spillCenter.lon]);
    if (driftOrigin && Number.isFinite(driftOrigin.lat) && Number.isFinite(driftOrigin.lon))
      pts.push([driftOrigin.lat, driftOrigin.lon]);
    for (const v of vessels) if (Number.isFinite(v.lat) && Number.isFinite(v.lon)) pts.push([v.lat, v.lon]);
    for (const p of trajectoryLatLngs) pts.push(p);
    for (const patch of boundaryPolygons) for (const p of patch) pts.push(p);
    for (const p of journeyLatLngs) pts.push(p);
    if (spillTimeLine) pts.push(spillTimeLine[1]);
    return pts;
  }, [spillCenter, driftOrigin, vessels, trajectoryLatLngs, boundaryPolygons, journeyLatLngs, spillTimeLine]);

  return (
    <MapContainer
      center={[centerLat, centerLon]}
      zoom={7}
      zoomControl={false}
      scrollWheelZoom
      style={{ height: "100%", width: "100%" }}
      className="z-0"
    >
      <ZoomControl position="topright" />
      <TileLayer
        attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />

      {allPoints.length > 0 && <FitBounds points={allPoints} />}

      {/* Vessel-density heatmap (drawn first so it sits under every marker/line) */}
      {showHeatmap && <VesselDensityHeatmap vessels={vessels} />}

      {boundaryPolygons.map((patch, index) => (
        <Polygon
          key={`spill-boundary-${index}`}
          positions={patch}
          pathOptions={{ color: "#e11d48", weight: 2, opacity: 0.95, fillColor: "#fb7185", fillOpacity: 0.28 }}
        >
          <Popup>Detected spill boundary</Popup>
        </Polygon>
      ))}

      {/* Gray line from every vessel to the spill origin */}
      {showDistanceLines &&
        distanceLines.map((line) => (
          <Polyline
            key={`dist-${line.key}`}
            positions={line.positions}
            pathOptions={{ color: "#9ca3af", weight: 1, opacity: 0.55, dashArray: "2,5" }}
            interactive={false}
          />
        ))}

      {/* Selected vessel's full journey: earliest fix -> latest fix */}
      {journeyLatLngs.length > 1 && (
        <>
          <Polyline positions={journeyLatLngs} pathOptions={{ color: "#16a34a", weight: 4, opacity: 0.95 }} />
          <Marker
            position={journeyLatLngs[0]}
            icon={vesselTriangleIcon({ color: "#16a34a", size: 12 })}
          >
            <Popup>
              <div className="text-xs font-semibold">{selectedVessel?.name} - Journey Start</div>
            </Popup>
          </Marker>
          <Marker
            position={journeyLatLngs[journeyLatLngs.length - 1]}
            icon={vesselTriangleIcon({
              color: "#16a34a",
              size: 16,
              selected: true,
              heading: selectedVessel?.trackPoints?.[selectedVessel.trackPoints.length - 1]?.cog ?? null,
            })}
          >
            <Popup>
              <div className="text-xs font-semibold">{selectedVessel?.name} - Journey End</div>
            </Popup>
          </Marker>
        </>
      )}

      {/* Dotted line from the spill origin to the selected vessel's position at spill time */}
      {spillTimeLine && (
        <>
          <Polyline
            positions={spillTimeLine}
            pathOptions={{ color: "#f59e0b", weight: 2, opacity: 0.9, dashArray: "3,7" }}
          />
          <CircleMarker
            center={spillTimeLine[1]}
            radius={5}
            pathOptions={{ fillColor: "#f59e0b", fillOpacity: 1, stroke: false }}
          >
            <Popup>
              <div className="text-xs font-semibold">{selectedVessel?.name} - Position at Spill Time</div>
              {selectedVessel?.positionAtSpillTime?.extrapolated && (
                <div className="text-[11px] text-amber-600">Nearest known fix (outside observed track span)</div>
              )}
            </Popup>
          </CircleMarker>
        </>
      )}

      {trajectoryLatLngs.length > 1 && (
        <Polyline positions={trajectoryLatLngs} pathOptions={{ color: "#0284c7", weight: 3, dashArray: "6,6", opacity: 0.8 }} />
      )}

      {driftOrigin && Number.isFinite(driftOrigin.lat) && Number.isFinite(driftOrigin.lon) && (
        <CircleMarker
          center={[driftOrigin.lat, driftOrigin.lon]}
          radius={7}
          pathOptions={{ fillColor: "#f59e0b", fillOpacity: 1, stroke: false }}
        >
          <Popup>
            <div className="text-xs font-semibold">Estimated Release Origin</div>
            <div className="text-[11px] font-mono text-slate-500">
              {driftOrigin.lat.toFixed(4)}°, {driftOrigin.lon.toFixed(4)}°
            </div>
          </Popup>
        </CircleMarker>
      )}

      {/* Large red warning marker at the spill origin - a soft pulse ring
          behind a solid core so it reads clearly against vessel clutter. */}
      {spillCenter && Number.isFinite(spillCenter.lat) && Number.isFinite(spillCenter.lon) && (
        <>
          <CircleMarker
            center={[spillCenter.lat, spillCenter.lon]}
            radius={22}
            pathOptions={{ fillColor: "#e11d48", fillOpacity: 0.12, stroke: false }}
            interactive={false}
          />
          <CircleMarker
            center={[spillCenter.lat, spillCenter.lon]}
            radius={13}
            pathOptions={{ fillColor: "#e11d48", fillOpacity: 1, stroke: false }}
          >
            <Popup>
              <div className="text-xs font-semibold">⚠ Oil Spill Detected</div>
              <div className="text-[11px] font-mono text-slate-500">
                {spillCenter.lat.toFixed(4)}°, {spillCenter.lon.toFixed(4)}°
              </div>
            </Popup>
          </CircleMarker>
        </>
      )}

      {/* Every vessel candidate, shown as a triangle mark colored by
          Haversine proximity rank (falls back to attribution probability). */}
      {vessels
        .filter((v) => v.lat != null && v.lon != null)
        .map((v) => {
          const isSelected = selectedVessel && v.mmsi && v.mmsi === selectedVessel.mmsi;
          return (
            <Marker
              key={v.mmsi || v.name}
              position={[v.lat, v.lon]}
              icon={vesselTriangleIcon({
                color: vesselMarkerColor(v, isSelected),
                selected: isSelected,
                heading: v.headingDeg ?? null,
              })}
            >
              <Popup>
                <div className="text-xs font-semibold">
                  {v.proximityRank ? `#${v.proximityRank} · ` : ""}
                  {v.name}
                </div>
                <div className="text-[11px] font-mono text-slate-500">MMSI {v.mmsi}</div>
                {v.distanceKm != null && (
                  <div className="text-[11px] font-mono text-slate-700 font-semibold">
                    {v.distanceKm.toFixed ? v.distanceKm.toFixed(2) : v.distanceKm} km from origin
                  </div>
                )}
                {v.probability != null && (
                  <div className="text-[11px] font-mono text-primary font-semibold">{v.probability}% match</div>
                )}
              </Popup>
            </Marker>
          );
        })}

      {showLegend && <MapLegend />}
    </MapContainer>
  );
}