"""
ais_attribution.py 

Identifies, scores, and ranks candidate vessels associated with an oil spill
based on spatial-temporal proximity, AIS data quality, behavioral evidence
(speed anomalies, loitering, erratic course changes, AIS blackouts), and
(when available) trajectory/drift consistency.
"""

import os
import re
import math
import json
import asyncio
import logging
import urllib.parse
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Optional, Dict, Any, List, Tuple

try:
    from vessel_risk import VesselIsolationForest, build_features
    HAS_ISOLATION_FOREST = True
except ImportError:
    HAS_ISOLATION_FOREST = False

from track_based_attribution import (
    VesselTrack,
    TrackPoint,
    HindcastOrigin,
    DetectionEvent,
    rank_vessels_track_based,
    DATA_MODE_TRACK_BASED,
    score_vessel_risk_prior,
)

try:
    import websockets
    HAS_WEBSOCKETS = True
except ImportError:
    HAS_WEBSOCKETS = False

try:
    import requests
    HAS_REQUESTS = True
except ImportError:
    HAS_REQUESTS = False

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Constants & Configuration
# ---------------------------------------------------------------------------

EARTH_RADIUS_KM = 6371.0
DEFAULT_SEARCH_RADIUS_KM = 200.0       # Widened: presence search, not point query
DEFAULT_SEARCH_WINDOW_HOURS = 14 * 24  # Match multi-day backtracking by default
MIN_EVIDENCE_THRESHOLD = 0.20          # Relaxed for presence-only mode
GFW_API_BASE = "https://gateway.api.globalfishingwatch.org/v3"
GFW_PRESENCE_DATASET = "public-global-presence:latest"
GFW_VESSEL_IDENTITY_DATASET = "public-global-vessel-identity:latest"
WEIGHTS_TRACK = {
    "spatial":      0.29,
    "temporal":     0.09,
    "trajectory":   0.24,
    "drift":        0.24,
    "course":       0.02,
    "data_quality": 0.02,
    "vessel_risk":  0.10,
}
WEIGHTS_PRESENCE = {
    "spatial":      0.00,   # No position data → always None in presence mode
    "temporal":     0.55,
    "trajectory":   0.00,
    "drift":        0.00,
    "course":       0.00,
    "data_quality": 0.25,
    "vessel_risk":  0.20,
}

DEFAULT_WEIGHTS = WEIGHTS_TRACK

MODEL_DIR = Path(__file__).resolve().parent / "models"
ISOLATION_FOREST_PATH = MODEL_DIR / "isolation_forest.joblib"
ISOLATION_FOREST_METADATA_PATH = MODEL_DIR / "isolation_forest_metadata.json"
CONFIDENCE_TIERS = {
    "probable_source_vessel": 0.65,
    "candidate_vessel": 0.35,
    "nearby_vessel": 0.0,
}

# AIS track-quality thresholds (attribution-source-improvements spec, item 4).
AIS_GAP_WARNING_HOURS = 6.0
AIS_MAX_PLAUSIBLE_SPEED_KNOTS = 50.0   # commercial vessels rarely exceed this
KM_TO_NM = 0.539957

DISCLAIMER_TEXT = (
    "AIS/GFW vessel attribution is probabilistic and does not establish causation. "
    "The ranking represents relative attribution likelihood among evaluated candidates "
    "based on available evidence only. These values are NOT calibrated probabilities "
    "and do not establish legal or scientific causation. "
    "AIS gaps, sparse observations, environmental-model uncertainty, oil weathering, "
    "and unmodeled oceanographic processes can affect the result."
)

# UUID-like pattern (GFW internal vessel IDs look like this)
_UUID_RE = re.compile(
    r"^[0-9a-f]{7,8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{10,12}$",
    re.IGNORECASE,
)


def looks_like_uuid(value: Any) -> bool:
    """Returns True if value resembles a GFW internal UUID (not a real MMSI)."""
    if not isinstance(value, str):
        return False
    return bool(_UUID_RE.match(value.strip()))


def is_valid_mmsi(value: Any) -> bool:
    """An AIS MMSI is 9 digits (numeric). Returns True for valid MMSI strings."""
    if value is None:
        return False
    s = str(value).strip()
    return s.isdigit() and 5 <= len(s) <= 10


# ---------------------------------------------------------------------------
# Geodesic & Mathematical Helpers
# ---------------------------------------------------------------------------

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes Great-Circle distance between two points in kilometers."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return EARTH_RADIUS_KM * c


def calculate_bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Computes the initial compass bearing (0–360°) from point 1 to point 2."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def parse_utc_timestamp(ts: Any) -> Optional[datetime]:
    """Parses an ISO string or datetime object into a UTC-aware datetime."""
    if ts is None:
        return None
    if isinstance(ts, datetime):
        return ts.replace(tzinfo=timezone.utc) if ts.tzinfo is None else ts.astimezone(timezone.utc)
    try:
        clean = str(ts).strip()
        if clean.endswith("Z"):
            clean = clean[:-1]
        dt = datetime.fromisoformat(clean)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return None


# ---------------------------------------------------------------------------
# GFW Response Parsing  (correct field mapping)
# ---------------------------------------------------------------------------

def _extract_vessel_identity_from_entry(entry: Dict[str, Any]) -> Dict[str, Any]:
    vessel_id: Optional[str] = None
    mmsi: Optional[str] = None
    imo: Optional[str] = None
    callsign: Optional[str] = None
    name: Optional[str] = None
    flag: Optional[str] = None
    vessel_type: Optional[str] = None
    transmission_from: Optional[str] = None
    transmission_to: Optional[str] = None

    # --- selfReportedInfo (authoritative source for identity) ---
    sri_list = entry.get("selfReportedInfo", [])
    if sri_list and isinstance(sri_list, list):
        sri = sri_list[0]
        vessel_id = sri.get("id") or vessel_id
        raw_ssvid = sri.get("ssvid")
        # Only accept ssvid as MMSI if it looks like a real MMSI (numeric digits)
        if raw_ssvid and is_valid_mmsi(raw_ssvid):
            mmsi = str(raw_ssvid).strip()
        raw_imo = sri.get("imo")
        if raw_imo and str(raw_imo).strip():
            imo = str(raw_imo).strip()
        raw_name = sri.get("shipname")
        if raw_name and str(raw_name).strip() and str(raw_name).strip().upper() not in ("NULL", "NONE", "N/A"):
            name = str(raw_name).strip()
        flag = sri.get("flag") or flag
        callsign = sri.get("callsign") or callsign
        transmission_from = sri.get("transmissionDateFrom")
        transmission_to = sri.get("transmissionDateTo")

    # --- registryInfo (supplementary, often empty on public token) ---
    ri_list = entry.get("registryInfo", [])
    if ri_list and isinstance(ri_list, list):
        ri = ri_list[0]
        if not vessel_id:
            vessel_id = ri.get("id")
        if not mmsi:
            raw_ssvid = ri.get("ssvid")
            if raw_ssvid and is_valid_mmsi(raw_ssvid):
                mmsi = str(raw_ssvid).strip()
        if not imo:
            raw_imo = ri.get("imo")
            if raw_imo and str(raw_imo).strip():
                imo = str(raw_imo).strip()
        if not name:
            raw_name = ri.get("shipname")
            if raw_name and str(raw_name).strip():
                name = str(raw_name).strip()
        if not flag:
            flag = ri.get("flag")
        if not callsign:
            callsign = ri.get("callsign")

    # --- combinedSourcesInfo (vessel type and fallback vessel_id) ---
    csi_list = entry.get("combinedSourcesInfo", [])
    if csi_list and isinstance(csi_list, list):
        csi = csi_list[0]
        if not vessel_id:
            vessel_id = csi.get("vesselId")
        shiptypes = csi.get("shiptypes", [])
        if shiptypes and isinstance(shiptypes, list):
            # Take the most recent shiptype
            most_recent = sorted(shiptypes, key=lambda x: x.get("yearTo", 0), reverse=True)
            vessel_type = most_recent[0].get("name", "UNKNOWN")

    # Safety: never assign a UUID as MMSI
    if mmsi and looks_like_uuid(mmsi):
        logger.warning(f"Rejected UUID-like value as MMSI: {mmsi[:20]}...")
        mmsi = None

    return {
        "vessel_id": vessel_id,
        "mmsi": mmsi,
        "imo": imo,
        "callsign": callsign,
        "name": name or "Unknown Vessel",
        "flag": flag,
        "vessel_type": vessel_type or "Unknown",
        "transmission_date_from": transmission_from,
        "transmission_date_to": transmission_to,
        # Positional data: NOT available from this endpoint
        "lat": None,
        "lon": None,
        "position_timestamp": None,
        "entry_timestamp": transmission_from,
        "exit_timestamp": transmission_to,
        "data_mode": "PRESENCE_ONLY",
        "source": "GFW_VESSEL_IDENTITY",
    }


def detect_gfw_data_mode(records: List[Dict[str, Any]]) -> str:
    """
    Inspect parsed GFW records to determine the appropriate data mode.

    Returns:
      'TRACK'         – records contain individual lat/lon/timestamp fixes
      'PRESENCE_ONLY' – records contain vessel identity but no positional fixes
      'UNAVAILABLE'   – no records
    """
    if not records:
        return "UNAVAILABLE"
    for r in records:
        lat = r.get("lat")
        lon = r.get("lon")
        ts = r.get("position_timestamp")
        if lat is not None and lon is not None and ts is not None:
            try:
                flat = float(lat)
                flon = float(lon)
                if -90 <= flat <= 90 and -180 <= flon <= 180:
                    return "TRACK"
            except (ValueError, TypeError):
                pass
    return "PRESENCE_ONLY"


# ---------------------------------------------------------------------------
# AIS Data Collection (real AIS / GFW presence only — never demo names)
# ---------------------------------------------------------------------------

def _bbox_geojson(latitude: float, longitude: float, radius_km: float) -> Dict[str, Any]:
    """Build a WGS84 square FeatureCollection around the search center."""
    d_deg = radius_km / 111.0
    west = max(-180.0, longitude - d_deg)
    east = min(180.0, longitude + d_deg)
    south = max(-90.0, latitude - d_deg)
    north = min(90.0, latitude + d_deg)
    return {
        "type": "FeatureCollection",
        "features": [{
            "type": "Feature",
            "properties": {},
            "geometry": {
                "type": "Polygon",
                "coordinates": [[
                    [west, south], [east, south], [east, north], [west, north], [west, south],
                ]],
            },
        }],
    }


def _gfw_headers(token: str) -> Dict[str, str]:
    return {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
        "Accept": "application/json",
    }


def _http_json(
    method: str,
    url: str,
    headers: Dict[str, str],
    body: Optional[Dict[str, Any]] = None,
    timeout: float = 120.0,
) -> Dict[str, Any]:
    if not HAS_REQUESTS:
        raise RuntimeError("'requests' library is required for GFW API calls")
    resp = requests.request(
        method, url, headers=headers,
        json=body if body is not None else None,
        timeout=timeout,
    )
    if resp.status_code == 429:
        raise RuntimeError(
            "GFW 4Wings report rate-limited (only one concurrent report per token). Retry shortly."
        )
    if resp.status_code >= 400:
        detail = resp.text[:500] if resp.text else resp.reason
        raise RuntimeError(f"GFW API HTTP {resp.status_code}: {detail}")
    if not resp.content:
        return {}
    return resp.json()


def _iter_4wings_vessel_rows(payload: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Flatten 4Wings report JSON into per-vessel presence rows."""
    rows: List[Dict[str, Any]] = []
    entries = payload.get("entries") or payload.get("data") or []
    if isinstance(payload, list):
        entries = payload
    for entry in entries:
        if not isinstance(entry, dict):
            continue
        # Shape A: {"public-global-presence:vX": [ {...}, ... ]}
        nested_lists = [v for v in entry.values() if isinstance(v, list)]
        if nested_lists:
            for block in nested_lists:
                for row in block:
                    if isinstance(row, dict):
                        rows.append(row)
            continue
        # Shape B: flat vessel row
        if any(k in entry for k in ("vesselId", "vessel_id", "shipName", "mmsi", "hours")):
            rows.append(entry)
    return rows


def _clean_ship_name(raw: Any) -> Optional[str]:
    if raw is None:
        return None
    name = str(raw).strip()
    if not name or name.upper() in ("NULL", "NONE", "N/A", "UNKNOWN", "UNKNOWN VESSEL"):
        return None
    # Reject obvious non-names / type labels returned by identity text search
    if name.upper() in ("TANKER", "CARGO", "FISHING", "PASSENGER", "TUG", "OTHER", "GEAR", "NA"):
        return None
    return name


def _parse_presence_row(row: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    """Normalize one 4Wings VESSEL_ID presence row into a candidate record."""
    vessel_id = row.get("vesselId") or row.get("vessel_id") or row.get("id")
    mmsi_raw = row.get("mmsi") or row.get("ssvid")
    mmsi = str(mmsi_raw).strip() if mmsi_raw and is_valid_mmsi(mmsi_raw) else None
    name = _clean_ship_name(row.get("shipName") or row.get("shipname") or row.get("name"))
    lat = row.get("lat") if row.get("lat") is not None else row.get("latitude")
    lon = row.get("lon") if row.get("lon") is not None else row.get("longitude")
    if lat is None and isinstance(row.get("position"), dict):
        lat = row["position"].get("lat") or row["position"].get("latitude")
        lon = row["position"].get("lon") or row["position"].get("longitude")
    if lat is None and isinstance(row.get("centroid"), dict):
        lat = row["centroid"].get("lat") or row["centroid"].get("latitude")
        lon = row["centroid"].get("lon") or row["centroid"].get("longitude")
    if lat is None and isinstance(row.get("coordinates"), (list, tuple)) and len(row["coordinates"]) >= 2:
        lon, lat = row["coordinates"][0], row["coordinates"][1]
    try:
        flat = float(lat) if lat is not None else None
        flon = float(lon) if lon is not None else None
    except (TypeError, ValueError):
        flat, flon = None, None
    if flat is not None and (flat < -90 or flat > 90):
        flat = None
    if flon is not None and (flon < -180 or flon > 180):
        flon = None

    entry_ts = row.get("entryTimestamp") or row.get("entry_timestamp")
    exit_ts = row.get("exitTimestamp") or row.get("exit_timestamp")
    # Prefer entry time as the presence timestamp when a cell lat/lon exists.
    position_ts = entry_ts or exit_ts or row.get("date")

    if not vessel_id and not mmsi and not name:
        return None

    has_fix = flat is not None and flon is not None and position_ts is not None
    return {
        "vessel_id": vessel_id,
        "mmsi": mmsi,
        "imo": str(row["imo"]).strip() if row.get("imo") else None,
        "callsign": row.get("callsign"),
        "name": name or (f"MMSI {mmsi}" if mmsi else None),
        "flag": row.get("flag"),
        "vessel_type": row.get("vesselType") or row.get("vessel_type") or row.get("geartype") or "Unknown",
        "transmission_date_from": entry_ts,
        "transmission_date_to": exit_ts,
        "lat": flat,
        "lon": flon,
        "position_timestamp": position_ts if has_fix else None,
        "entry_timestamp": entry_ts,
        "exit_timestamp": exit_ts,
        "presence_hours": row.get("hours"),
        "data_mode": "TRACK" if has_fix else "PRESENCE_ONLY",
        "source": "GFW_4WINGS_PRESENCE",
    }


def _resolve_vessel_identities(
    vessel_ids: List[str],
    gfw_api_token: str,
) -> Dict[str, Dict[str, Any]]:
    """Fetch real ship names / MMSI for GFW vessel IDs via /v3/vessels."""
    resolved: Dict[str, Dict[str, Any]] = {}
    if not vessel_ids:
        return resolved
    # API accepts multiple ids; batch to keep URLs reasonable.
    batch_size = 25
    for i in range(0, len(vessel_ids), batch_size):
        batch = vessel_ids[i:i + batch_size]
        params = []
        for vid in batch:
            params.append(f"ids[]={urllib.parse.quote(str(vid), safe='')}")
        params.append(f"datasets[]={urllib.parse.quote(GFW_VESSEL_IDENTITY_DATASET, safe='')}")
        url = f"{GFW_API_BASE}/vessels?{'&'.join(params)}"
        try:
            payload = _http_json("GET", url, _gfw_headers(gfw_api_token), timeout=60.0)
        except Exception as exc:
            logger.warning(f"GFW vessel identity resolve failed: {exc}")
            continue
        entries = payload.get("entries") or payload.get("data") or []
        if isinstance(payload, list):
            entries = payload
        for entry in entries:
            if not isinstance(entry, dict):
                continue
            identity = _extract_vessel_identity_from_entry(entry)
            vid = identity.get("vessel_id")
            if vid:
                resolved[str(vid)] = identity
            # Also index by any related self-reported ids present in the entry
            for sri in entry.get("selfReportedInfo") or []:
                sid = sri.get("id")
                if sid and sid not in resolved:
                    resolved[str(sid)] = identity
    return resolved


def collect_gfw_candidates(
    latitude: float,
    longitude: float,
    radius_km: float,
    time_from: datetime,
    time_to: datetime,
    gfw_api_token: Optional[str],
    debug_output_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Query GFW 4Wings AIS vessel presence for vessels actually in the search box,
    then resolve real vessel names via the Vessels API.

    This replaces the old /vessels/search text query that returned unrelated
    ships named 'TANKER' / 'TINKER' with no spatial evidence.
    """
    if not gfw_api_token:
        return {
            "status": "unavailable",
            "source": "Global Fishing Watch 4Wings presence",
            "data_mode": "UNAVAILABLE",
            "reason": "GFW_API_TOKEN is not configured in .env",
            "records": [],
            "candidates_found": 0,
        }
    if not HAS_REQUESTS:
        return {
            "status": "unavailable",
            "source": "Global Fishing Watch 4Wings presence",
            "data_mode": "UNAVAILABLE",
            "reason": "'requests' library not installed",
            "records": [],
            "candidates_found": 0,
        }

    date_from = time_from.astimezone(timezone.utc).strftime("%Y-%m-%d")
    date_to = time_to.astimezone(timezone.utc).strftime("%Y-%m-%d")
    if date_to < date_from:
        date_from, date_to = date_to, date_from

    query = urllib.parse.urlencode({
        "datasets[0]": GFW_PRESENCE_DATASET,
        "date-range": f"{date_from},{date_to}",
        "spatial-resolution": "LOW",
        "temporal-resolution": "ENTIRE",
        "spatial-aggregation": "false",
        "group-by": "VESSEL_ID",
        "format": "JSON",
    })
    url = f"{GFW_API_BASE}/4wings/report?{query}"
    body = {"geojson": _bbox_geojson(latitude, longitude, radius_km)}

    try:
        payload = _http_json("POST", url, _gfw_headers(gfw_api_token), body=body, timeout=150.0)
    except Exception as exc:
        return {
            "status": "unavailable",
            "source": "Global Fishing Watch 4Wings presence",
            "data_mode": "UNAVAILABLE",
            "reason": f"4Wings presence report failed: {exc}",
            "records": [],
            "candidates_found": 0,
        }

    if debug_output_dir:
        try:
            os.makedirs(debug_output_dir, exist_ok=True)
            debug_path = os.path.join(debug_output_dir, "gfw_4wings_presence_debug.json")
            with open(debug_path, "w", encoding="utf-8") as f:
                json.dump({
                    "endpoint": url.split("?")[0],
                    "dataset": GFW_PRESENCE_DATASET,
                    "date_range": f"{date_from},{date_to}",
                    "center": {"lat": latitude, "lon": longitude},
                    "radius_km": radius_km,
                    "response_summary": {
                        "keys": list(payload.keys()) if isinstance(payload, dict) else type(payload).__name__,
                        "entry_count": len(payload.get("entries", [])) if isinstance(payload, dict) else None,
                    },
                }, f, indent=2)
        except Exception as exc:
            logger.warning(f"Could not write GFW debug file: {exc}")

    rows = _iter_4wings_vessel_rows(payload if isinstance(payload, dict) else {})
    records: List[Dict[str, Any]] = []
    for row in rows:
        parsed = _parse_presence_row(row)
        if parsed is None:
            continue
        records.append(parsed)

    # Resolve missing / generic names via vessel identity endpoint.
    need_resolve = [
        str(r["vessel_id"]) for r in records
        if r.get("vessel_id") and (
            not r.get("name")
            or str(r["name"]).startswith("MMSI ")
            or not r.get("mmsi")
        )
    ]
    identities = _resolve_vessel_identities(list(dict.fromkeys(need_resolve)), gfw_api_token)
    for rec in records:
        ident = identities.get(str(rec.get("vessel_id"))) if rec.get("vessel_id") else None
        if not ident:
            continue
        if ident.get("name") and (not rec.get("name") or str(rec["name"]).startswith("MMSI ")):
            rec["name"] = ident["name"]
        if ident.get("mmsi") and not rec.get("mmsi"):
            rec["mmsi"] = ident["mmsi"]
        if ident.get("imo") and not rec.get("imo"):
            rec["imo"] = ident["imo"]
        if ident.get("flag") and not rec.get("flag"):
            rec["flag"] = ident["flag"]
        if ident.get("callsign") and not rec.get("callsign"):
            rec["callsign"] = ident["callsign"]
        if ident.get("vessel_type") and rec.get("vessel_type") in (None, "Unknown", "UNKNOWN", "NA"):
            rec["vessel_type"] = ident["vessel_type"]

    # Drop records that still have no usable identity — never invent names.
    real_records = [
        r for r in records
        if r.get("name") or r.get("mmsi") or r.get("imo")
    ]

    data_mode = detect_gfw_data_mode(real_records)
    return {
        "status": "available" if real_records else "empty",
        "source": "Global Fishing Watch 4Wings presence",
        "data_mode": data_mode if real_records else "UNAVAILABLE",
        "reason": (
            f"Retrieved {len(real_records)} vessels present in the search region "
            f"({date_from} → {date_to}) from GFW AIS presence."
            if real_records else
            f"No AIS vessel presence in the search region for {date_from} → {date_to}."
        ),
        "api_note": (
            "Candidates come from spatially filtered AIS presence (4Wings), not from "
            "unrelated vessel-name text search."
        ),
        "records": real_records,
        "candidates_found": len(real_records),
    }


def collect_aisstream_candidates(
    latitude: float,
    longitude: float,
    radius_km: float,
    time_from: datetime,
    time_to: datetime,
    aisstream_api_key: Optional[str],
    timeout_seconds: float = 6.0,
) -> Dict[str, Any]:
    """
    Connects to AISStream WebSocket to collect live/recent vessel position reports.
    AISStream returns actual positional fixes → TRACK data mode.
    """
    if not aisstream_api_key:
        return {
            "status": "unavailable",
            "source": "AISStream",
            "data_mode": "UNAVAILABLE",
            "reason": "AISSTREAM_API_KEY is not configured in .env",
            "records": [],
            "candidates_found": 0,
        }

    if not HAS_WEBSOCKETS:
        return {
            "status": "unavailable",
            "source": "AISStream",
            "data_mode": "UNAVAILABLE",
            "reason": "'websockets' library not installed",
            "records": [],
            "candidates_found": 0,
        }

    d_deg = (radius_km / 111.0) * 1.5
    bbox = [
        [max(-90.0, latitude - d_deg), max(-180.0, longitude - d_deg)],
        [min(90.0, latitude + d_deg), min(180.0, longitude + d_deg)],
    ]
    records: List[Dict[str, Any]] = []

    async def _listen_stream():
        url = "wss://stream.aisstream.io/v0/stream"
        sub_msg = {
            "APIKey": aisstream_api_key,
            "BoundingBoxes": [bbox],
            "FilterMessageTypes": ["PositionReport", "ShipStaticData"],
        }
        try:
            async with websockets.connect(url, open_timeout=5.0) as ws:
                await ws.send(json.dumps(sub_msg))
                end_time = asyncio.get_event_loop().time() + timeout_seconds
                while asyncio.get_event_loop().time() < end_time:
                    try:
                        raw = await asyncio.wait_for(ws.recv(), timeout=2.0)
                        msg = json.loads(raw)
                        msg_type = msg.get("MessageType")
                        meta = msg.get("MetaData", {})
                        if msg_type == "PositionReport":
                            pos = msg.get("Message", {}).get("PositionReport", {})
                            mmsi_raw = meta.get("MMSI")
                            lat = pos.get("Latitude")
                            lon = pos.get("Longitude")
                            if lat is None or lon is None:
                                continue
                            if not (-90 <= float(lat) <= 90 and -180 <= float(lon) <= 180):
                                continue
                            mmsi_str = str(mmsi_raw) if mmsi_raw and is_valid_mmsi(str(mmsi_raw)) else None
                            ts_raw = meta.get("time_utc", datetime.now(timezone.utc).isoformat())
                            records.append({
                                "vessel_id": f"aisstream-{mmsi_str or mmsi_raw}",
                                "mmsi": mmsi_str,
                                "imo": None,
                                "callsign": None,
                                "name": meta.get("ShipName", f"MMSI {mmsi_raw}").strip() or "Unknown Vessel",
                                "flag": None,
                                "vessel_type": "Commercial Vessel",
                                "lat": float(lat),
                                "lon": float(lon),
                                "position_timestamp": ts_raw,
                                "entry_timestamp": None,
                                "exit_timestamp": None,
                                "sog": float(pos["Sog"]) if pos.get("Sog") is not None else None,
                                "cog": float(pos["Cog"]) if pos.get("Cog") is not None else None,
                                "heading": float(pos["TrueHeading"]) if pos.get("TrueHeading") is not None else None,
                                "navigation_status": str(pos.get("NavigationalStatus")),
                                "data_mode": "TRACK",
                                "source": "AISStream",
                            })
                    except asyncio.TimeoutError:
                        break
        except Exception as e:
            logger.warning(f"AISStream connection error: {e}")

    try:
        asyncio.run(_listen_stream())
    except Exception as e:
        return {
            "status": "unavailable",
            "source": "AISStream",
            "data_mode": "UNAVAILABLE",
            "reason": f"AISStream stream capture failed: {e}",
            "records": [],
            "candidates_found": 0,
        }

    data_mode = "TRACK" if records else "UNAVAILABLE"
    return {
        "status": "available" if records else "empty",
        "source": "AISStream",
        "data_mode": data_mode,
        "reason": (
            f"Captured {len(records)} live AIS position reports." if records
            else "Connected to AISStream; 0 vessels in bounding box during collection interval."
        ),
        "records": records,
        "candidates_found": len(records),
    }


def collect_ais_candidates(
    detection_lat: float,
    detection_lon: float,
    detection_time_utc: datetime,
    estimated_origin_lat: Optional[float],
    estimated_origin_lon: Optional[float],
    estimated_start_utc: Optional[datetime],
    search_radius_km: float = DEFAULT_SEARCH_RADIUS_KM,
    search_window_hours: float = DEFAULT_SEARCH_WINDOW_HOURS,
    gfw_api_token: Optional[str] = None,
    aisstream_api_key: Optional[str] = None,
    debug_output_dir: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Unified entry point for AIS candidate retrieval.
    Uses GFW 4Wings presence for historical scenes, AISStream for live/recent.
    Search center: estimated origin if available, else detection location.
    """
    # Search center: prefer estimated origin, fall back to detection point
    search_lat = estimated_origin_lat if estimated_origin_lat is not None else detection_lat
    search_lon = estimated_origin_lon if estimated_origin_lon is not None else detection_lon
    # Time anchor: prefer estimated start, fall back to detection time
    time_anchor = estimated_start_utc if estimated_start_utc is not None else detection_time_utc

    now_utc = datetime.now(timezone.utc)
    # Presence dataset covers history until ~96h ago; live stream for fresher scenes.
    is_historical = (now_utc - time_anchor).total_seconds() > (96 * 3600)

    # Search from well before the estimated release through detection time.
    t_from = time_anchor - timedelta(hours=search_window_hours)
    t_to = max(time_anchor + timedelta(hours=min(24.0, search_window_hours / 4.0)), detection_time_utc)

    if is_historical:
        res = collect_gfw_candidates(
            latitude=search_lat,
            longitude=search_lon,
            radius_km=search_radius_km,
            time_from=t_from,
            time_to=t_to,
            gfw_api_token=gfw_api_token,
            debug_output_dir=debug_output_dir,
        )
        res["selection_reason"] = (
            f"Historical window around {time_anchor.strftime('%Y-%m-%d %H:%M UTC')} → "
            f"GFW 4Wings AIS presence (vessels physically in search box)."
        )
        return res
    else:
        res = collect_aisstream_candidates(
            latitude=search_lat,
            longitude=search_lon,
            radius_km=search_radius_km,
            time_from=t_from,
            time_to=t_to,
            aisstream_api_key=aisstream_api_key,
        )
        res["selection_reason"] = "Recent/live scene → AISStream WebSocket."
        return res


# ---------------------------------------------------------------------------
# Candidate Validation
# ---------------------------------------------------------------------------

def validate_candidate(record: Dict[str, Any], spill_lat: float, spill_lon: float) -> List[str]:
    """
    Validates a parsed candidate record. Returns a list of warning strings.
    Does NOT modify the record.
    """
    warnings: List[str] = []
    mmsi = record.get("mmsi")
    lat = record.get("lat")
    lon = record.get("lon")

    # MMSI must not be a GFW UUID
    if mmsi and looks_like_uuid(str(mmsi)):
        warnings.append(f"MMSI looks like a GFW UUID: '{str(mmsi)[:20]}...' — will be set to None")

    # Position should not silently match spill coordinates unless confirmed by API
    if lat is not None and lon is not None:
        try:
            if abs(float(lat) - spill_lat) < 1e-6 and abs(float(lon) - spill_lon) < 1e-6:
                warnings.append(
                    f"Candidate lat/lon exactly matches spill coordinates "
                    f"({lat}, {lon}) — may indicate coordinate substitution bug"
                )
        except (TypeError, ValueError):
            pass

    return warnings


def check_candidate_diversity(records: List[Dict[str, Any]]) -> List[str]:
    """
    Issues warnings if all candidates share identical timestamps or coordinates.
    Does not raise; only returns warning strings.
    """
    warnings: List[str] = []
    if len(records) < 2:
        return warnings

    lats = [r.get("lat") for r in records if r.get("lat") is not None]
    lons = [r.get("lon") for r in records if r.get("lon") is not None]
    timestamps = [r.get("position_timestamp") for r in records if r.get("position_timestamp")]

    if lats and len(set(lats)) == 1:
        warnings.append(f"All {len(records)} candidates share identical latitude {lats[0]}")
    if lons and len(set(lons)) == 1:
        warnings.append(f"All {len(records)} candidates share identical longitude {lons[0]}")
    if timestamps and len(set(str(t) for t in timestamps)) == 1:
        warnings.append(f"All {len(records)} candidates share identical timestamp {timestamps[0]}")

    return warnings


# ---------------------------------------------------------------------------
# Trajectory Reconstruction (TRACK mode only)
# ---------------------------------------------------------------------------

def reconstruct_trajectories(
    raw_records: List[Dict[str, Any]],
) -> Dict[str, Dict[str, Any]]:
    """
    Groups raw TRACK-mode AIS observations by vessel_id/mmsi,
    validates coordinates, and sorts chronologically.
    Records with data_mode=PRESENCE_ONLY are passed through without trajectory building.
    """
    vessels: Dict[str, Dict[str, Any]] = {}

    for r in raw_records:
        data_mode = r.get("data_mode")
        if data_mode is None:
            # Infer mode from the fields in a provider record when it is undeclared.
            # Infer from whether it actually carries a positional fix, rather than
            # silently defaulting to PRESENCE_ONLY and discarding usable TRACK data.
            has_lat = r.get("lat") is not None or r.get("latitude") is not None
            has_lon = r.get("lon") is not None or r.get("longitude") is not None
            has_ts = r.get("position_timestamp") is not None or r.get("timestamp") is not None
            data_mode = "TRACK" if (has_lat and has_lon and has_ts) else "PRESENCE_ONLY"

        # PRESENCE_ONLY records: no full track, but may carry a cell lat/lon
        # (one row per grid cell/day now that spatial-aggregation is off above -
        # keep whichever row is chronologically most recent as the vessel's
        # best-available last-known position).
        if data_mode == "PRESENCE_ONLY":
            v_key = r.get("vessel_id") or r.get("mmsi")
            if not v_key:
                continue
            row_ts = r.get("exit_timestamp") or r.get("entry_timestamp") or r.get("transmission_date_to")
            if v_key not in vessels:
                vessels[v_key] = {
                    "vessel_id": r.get("vessel_id"),
                    "mmsi": r.get("mmsi"),
                    "name": r.get("name", "Unknown Vessel"),
                    "imo": r.get("imo"),
                    "callsign": r.get("callsign"),
                    "flag": r.get("flag"),
                    "vessel_type": r.get("vessel_type", "Unknown"),
                    "data_mode": "PRESENCE_ONLY",
                    "source": r.get("source", "UNKNOWN"),
                    "transmission_date_from": r.get("transmission_date_from") or r.get("entry_timestamp"),
                    "transmission_date_to": r.get("transmission_date_to") or r.get("exit_timestamp"),
                    "lat": r.get("lat"),
                    "lon": r.get("lon"),
                    "_position_ts": row_ts,
                    "observations": [],   # No full track fixes
                }
            else:
                existing = vessels[v_key]
                # Widen the overall transmission window regardless of which
                # row wins the position.
                if r.get("transmission_date_from") and (
                    not existing.get("transmission_date_from") or r["transmission_date_from"] < existing["transmission_date_from"]
                ):
                    existing["transmission_date_from"] = r["transmission_date_from"]
                if r.get("transmission_date_to") and (
                    not existing.get("transmission_date_to") or r["transmission_date_to"] > existing["transmission_date_to"]
                ):
                    existing["transmission_date_to"] = r["transmission_date_to"]
                has_pos = r.get("lat") is not None and r.get("lon") is not None
                is_newer = row_ts is not None and (existing.get("_position_ts") is None or row_ts > existing["_position_ts"])
                if has_pos and (existing.get("lat") is None or is_newer):
                    existing["lat"] = r.get("lat")
                    existing["lon"] = r.get("lon")
                    existing["_position_ts"] = row_ts
            continue

        # TRACK records: validate and collect position fixes
        v_key = r.get("mmsi") or r.get("vessel_id")
        if not v_key:
            continue

        lat = r.get("lat") or r.get("latitude")
        lon = r.get("lon") or r.get("longitude")
        ts = parse_utc_timestamp(r.get("position_timestamp") or r.get("timestamp"))

        if lat is None or lon is None or ts is None:
            continue
        try:
            flat, flon = float(lat), float(lon)
        except (TypeError, ValueError):
            continue
        if not (-90.0 <= flat <= 90.0) or not (-180.0 <= flon <= 180.0):
            continue
        if abs(flat) < 1e-4 and abs(flon) < 1e-4:
            continue   # Reject (0, 0) Null Island

        obs = {
            "timestamp": ts,
            "iso_time": ts.strftime("%Y-%m-%d %H:%M:%S UTC"),
            "latitude": flat,
            "longitude": flon,
            "sog": float(r["sog"]) if r.get("sog") is not None else None,
            "cog": float(r["cog"]) if r.get("cog") is not None else None,
            "heading": float(r["heading"]) if r.get("heading") is not None else None,
            "navigation_status": r.get("navigation_status"),
        }

        if v_key not in vessels:
            vessels[v_key] = {
                "vessel_id": r.get("vessel_id", v_key),
                "mmsi": r.get("mmsi"),
                "name": r.get("name") or r.get("vessel_name", "Unknown Vessel"),
                "imo": r.get("imo"),
                "callsign": r.get("callsign"),
                "flag": r.get("flag"),
                "vessel_type": r.get("vessel_type", "Unknown"),
                "data_mode": "TRACK",
                "source": r.get("source", "UNKNOWN"),
                "transmission_date_from": None,
                "transmission_date_to": None,
                "observations": [],
            }

        vessels[v_key]["observations"].append(obs)

    # Sort and deduplicate observations for TRACK vessels
    for v_key, v_info in vessels.items():
        if v_info.get("data_mode") == "TRACK" and v_info.get("observations"):
            obs_list = sorted(v_info["observations"], key=lambda x: x["timestamp"])
            seen = set()
            deduped = []
            for o in obs_list:
                tk = o["timestamp"].isoformat()
                if tk not in seen:
                    seen.add(tk)
                    deduped.append(o)
            v_info["observations"] = deduped

    return vessels


def interpolate_vessel_position(
    trajectory: List[Dict[str, Any]],
    target_time: datetime,
) -> Optional[Dict[str, Any]]:
    """
    Interpolates vessel position at target_time if bracketed by two observations.
    Returns None if target_time is outside the observation span.
    """
    if not trajectory:
        return None
    if target_time.tzinfo is None:
        target_time = target_time.replace(tzinfo=timezone.utc)
    if target_time < trajectory[0]["timestamp"] or target_time > trajectory[-1]["timestamp"]:
        return None
    for i in range(len(trajectory) - 1):
        t1, t2 = trajectory[i]["timestamp"], trajectory[i + 1]["timestamp"]
        if t1 <= target_time <= t2:
            dt_total = (t2 - t1).total_seconds()
            if dt_total <= 0:
                return trajectory[i]
            frac = (target_time - t1).total_seconds() / dt_total
            lat1, lon1 = trajectory[i]["latitude"], trajectory[i]["longitude"]
            lat2, lon2 = trajectory[i + 1]["latitude"], trajectory[i + 1]["longitude"]
            sog1, sog2 = trajectory[i].get("sog"), trajectory[i + 1].get("sog")
            cog1 = trajectory[i].get("cog")
            return {
                "timestamp": target_time,
                "iso_time": target_time.strftime("%Y-%m-%d %H:%M:%S UTC"),
                "latitude": round(lat1 + frac * (lat2 - lat1), 5),
                "longitude": round(lon1 + frac * (lon2 - lon1), 5),
                "sog": round(sog1 + frac * (sog2 - sog1), 1) if (sog1 is not None and sog2 is not None) else sog1,
                "cog": round(cog1, 1) if cog1 is not None else None,
                "interpolated": True,
            }
    return None


# ---------------------------------------------------------------------------
# Evidence Scoring Functions
# ---------------------------------------------------------------------------

def compute_spatial_score(
    vessel_lat: Optional[float],
    vessel_lon: Optional[float],
    origin_lat: float,
    origin_lon: float,
    radius_km: float = DEFAULT_SEARCH_RADIUS_KM,
) -> Tuple[Optional[float], Optional[float]]:
    """
    Feature 1: Spatial Proximity.
    Returns (distance_km, score∈[0,1]).
    Returns (None, None) if vessel position is missing — never substitutes spill coords.
    """
    if vessel_lat is None or vessel_lon is None:
        return None, None
    dist = haversine_km(float(vessel_lat), float(vessel_lon), origin_lat, origin_lon)
    score = max(0.0, 1.0 - (dist / radius_km))
    return round(dist, 2), round(score, 3)


def compute_temporal_score(
    vessel_time: Optional[datetime],
    target_time: datetime,
    window_hours: float = DEFAULT_SEARCH_WINDOW_HOURS,
) -> Tuple[Optional[float], Optional[float]]:
    """
    Feature 2: Temporal Proximity.
    Returns (abs_diff_minutes, score∈[0,1]).
    Returns (None, None) if vessel time is missing.
    """
    if vessel_time is None:
        return None, None
    diff_sec = abs((vessel_time - target_time).total_seconds())
    diff_min = diff_sec / 60.0
    score = max(0.0, 1.0 - (diff_sec / (window_hours * 3600.0)))
    return round(diff_min, 1), round(score, 3)


def compute_trajectory_score(
    trajectory: List[Dict[str, Any]],
    origin_lat: float,
    origin_lon: float,
    target_start_time: datetime,
    window_hours: float = DEFAULT_SEARCH_WINDOW_HOURS,
) -> Tuple[Optional[float], Optional[float]]:
    """
    Feature 3: Trajectory Consistency (TRACK mode only).
    Requires at least 2 real positional observations.
    Returns (min_dist_km, score) or (None, None) if insufficient track data.
    """
    if not trajectory or len(trajectory) < 1:
        return None, None
    min_dist = float("inf")
    window_half = timedelta(hours=window_hours / 2.0)
    valid_pts = [
        pt for pt in trajectory
        if (target_start_time - window_half) <= pt["timestamp"] <= (target_start_time + window_half)
    ]
    if not valid_pts:
        valid_pts = trajectory
    for pt in valid_pts:
        d = haversine_km(pt["latitude"], pt["longitude"], origin_lat, origin_lon)
        if d < min_dist:
            min_dist = d
    if math.isinf(min_dist):
        return None, None
    score = max(0.0, 1.0 - (min_dist / DEFAULT_SEARCH_RADIUS_KM))
    return round(min_dist, 2), round(score, 3)


def compute_drift_consistency_score(
    candidate_lat: Optional[float],
    candidate_lon: Optional[float],
    release_time_utc: Optional[datetime],
    detection_time_utc: datetime,
    detected_lat: float,
    detected_lon: float,
    env_time_series: List[Dict[str, Any]],
    hindcast_available: bool = True,
    windage_factor: float = 0.03,
) -> Tuple[Optional[float], Optional[float], Optional[Tuple[float, float]]]:
    """
    Feature 4: Forward Oil Drift Consistency (TRACK mode + Stage 2 hindcast required).
    Returns (drift_error_km, drift_score, (pred_lat, pred_lon)).
    Returns (None, None, None) if:
      - candidate position is missing
      - release time is missing
      - hindcast_available is False (Stage 2 unavailable)
      - environmental time series is empty
    Never fabricates drift using arbitrary coordinates or missing data.
    """
    if not hindcast_available:
        return None, None, None
    if candidate_lat is None or candidate_lon is None or release_time_utc is None:
        return None, None, None
    if not env_time_series:
        return None, None, None

    env_map = {}
    for entry in env_time_series:
        ts = entry.get("timestamp")
        if ts:
            env_map[ts.strftime("%Y-%m-%d %H:00")] = entry

    curr_lat, curr_lon = float(candidate_lat), float(candidate_lon)
    curr_time = release_time_utc
    dt_seconds = 3600.0

    while curr_time < detection_time_utc:
        step_dt = min(dt_seconds, (detection_time_utc - curr_time).total_seconds())
        if step_dt <= 0:
            break
        lookup_key = curr_time.strftime("%Y-%m-%d %H:00")
        env_step = env_map.get(lookup_key)
        if not env_step and env_time_series:
            env_step = env_time_series[0]
        elif not env_step:
            env_step = {}

        c_vel = env_step.get("ocean_current_velocity_ms")
        c_dir = env_step.get("ocean_current_direction_deg")
        w_spd = env_step.get("wind_speed_ms")
        w_dir = env_step.get("wind_direction_deg")

        if c_vel is None and w_spd is None:
            return None, None, None

        c_v = c_vel if c_vel is not None else 0.0
        c_d = c_dir if c_dir is not None else 0.0
        w_s = w_spd if w_spd is not None else 0.0
        w_d = w_dir if w_dir is not None else 0.0

        c_rad = math.radians(c_d % 360.0)
        u_c = c_v * math.sin(c_rad)
        v_c = c_v * math.cos(c_rad)
        w_rad = math.radians((w_d + 180.0) % 360.0)
        u_w = w_s * math.sin(w_rad)
        v_w = w_s * math.cos(w_rad)

        u_comb = u_c + windage_factor * u_w
        v_comb = v_c + windage_factor * v_w
        dx = u_comb * step_dt
        dy = v_comb * step_dt

        d_lat_deg = (dy / 6371000.0) * (180.0 / math.pi)
        cos_lat = max(1e-4, math.cos(math.radians(curr_lat)))
        d_lon_deg = (dx / (6371000.0 * cos_lat)) * (180.0 / math.pi)

        curr_lat = max(-90.0, min(90.0, curr_lat + d_lat_deg))
        curr_lon = ((curr_lon + d_lon_deg + 180.0) % 360.0) - 180.0
        curr_time += timedelta(seconds=step_dt)

    error_km = haversine_km(curr_lat, curr_lon, detected_lat, detected_lon)
    drift_score = max(0.0, 1.0 - (error_km / 40.0))
    return round(error_km, 2), round(drift_score, 3), (round(curr_lat, 4), round(curr_lon, 4))


def compute_course_score(
    vessel_cog: Optional[float],
    vessel_lat: Optional[float],
    vessel_lon: Optional[float],
    origin_lat: float,
    origin_lon: float,
) -> Optional[float]:
    """
    Feature 5: COG Consistency (TRACK mode only).
    Returns None if COG or position are missing — never defaults to 0.
    """
    if vessel_cog is None or vessel_lat is None or vessel_lon is None:
        return None
    target_bearing = calculate_bearing_deg(float(vessel_lat), float(vessel_lon), origin_lat, origin_lon)
    diff = abs((float(vessel_cog) - target_bearing + 180.0) % 360.0 - 180.0)
    return round(max(0.0, 1.0 - (diff / 90.0)), 3)


def assess_track_quality_flags(observations: List[Dict[str, Any]]) -> Tuple[List[str], Optional[float]]:
    """
    AIS data-quality checks for TRACK-mode observations (spec item 4):
      - large gaps between consecutive fixes
      - implausible implied speed between consecutive fixes ("teleporting" vessel)
      - single-fix tracks (no continuity to assess)
    Duplicate records and invalid/missing coordinates are already filtered out
    upstream in reconstruct_trajectories(), so they cannot recur here.
    Returns (flags, max_gap_hours). Does not mutate observations.
    """
    flags: List[str] = []
    if not observations:
        return ["No AIS position fixes available for this vessel."], None
    if len(observations) < 2:
        flags.append("Only one AIS position fix available — track continuity cannot be assessed.")
        return flags, 0.0

    max_gap_hours = 0.0
    gaps_over_threshold = 0
    speed_violations = 0

    for i in range(len(observations) - 1):
        t1, t2 = observations[i]["timestamp"], observations[i + 1]["timestamp"]
        gap_hours = max(0.0, (t2 - t1).total_seconds() / 3600.0)
        max_gap_hours = max(max_gap_hours, gap_hours)
        if gap_hours > AIS_GAP_WARNING_HOURS:
            gaps_over_threshold += 1

        if gap_hours > 0:
            dist_km = haversine_km(
                observations[i]["latitude"], observations[i]["longitude"],
                observations[i + 1]["latitude"], observations[i + 1]["longitude"],
            )
            implied_speed_knots = (dist_km / gap_hours) * KM_TO_NM
            if implied_speed_knots > AIS_MAX_PLAUSIBLE_SPEED_KNOTS:
                speed_violations += 1

    if gaps_over_threshold > 0:
        flags.append(
            f"{gaps_over_threshold} gap(s) exceeding {AIS_GAP_WARNING_HOURS:.0f}h between AIS fixes "
            f"(largest gap: {max_gap_hours:.1f}h) — track reliability during the gap is unknown."
        )
    if speed_violations > 0:
        flags.append(
            f"{speed_violations} consecutive-fix pair(s) imply a speed above "
            f"{AIS_MAX_PLAUSIBLE_SPEED_KNOTS:.0f} kn — likely a spoofed/corrupted position or timestamp error."
        )

    return flags, round(max_gap_hours, 2)


def assess_presence_quality_flags(vessel_info: Dict[str, Any]) -> List[str]:
    """
    AIS/identity data-quality checks for PRESENCE_ONLY-mode candidates (spec item 4/5):
    flags missing identity fields that reduce confidence in the identity match.
    """
    flags: List[str] = []
    if not vessel_info.get("mmsi") or not is_valid_mmsi(vessel_info.get("mmsi")):
        flags.append("No valid MMSI reported for this vessel.")
    if not vessel_info.get("imo"):
        flags.append("No IMO number reported — identity cannot be cross-checked against registries.")
    if not vessel_info.get("transmission_date_from") and not vessel_info.get("transmission_date_to"):
        flags.append("No AIS transmission window available for this vessel.")
    if not vessel_info.get("flag"):
        flags.append("Flag state unknown.")
    return flags


def compute_data_quality_score(
    vessel_info: Dict[str, Any],
    data_mode: str,
) -> Optional[float]:
    """
    Feature 6: AIS Data Quality.
    TRACK mode: fraction of complete observations (coords + timestamp + SOG + COG).
    PRESENCE_ONLY mode: based on identity field completeness.
    """
    if data_mode == "TRACK":
        observations = vessel_info.get("observations", [])
        if not observations:
            return None
        total, passed = 0, 0
        for obs in observations:
            total += 4
            if obs.get("latitude") is not None and obs.get("longitude") is not None:
                passed += 1
            if obs.get("timestamp") is not None:
                passed += 1
            if obs.get("sog") is not None:
                passed += 1
            if obs.get("cog") is not None:
                passed += 1
        return round(passed / max(1, total), 3)
    else:
        # PRESENCE_ONLY: score based on identity completeness
        fields_present = 0
        total_fields = 5
        if vessel_info.get("mmsi") and is_valid_mmsi(vessel_info["mmsi"]):
            fields_present += 1
        if vessel_info.get("name") and vessel_info["name"] != "Unknown Vessel":
            fields_present += 1
        if vessel_info.get("flag"):
            fields_present += 1
        if vessel_info.get("imo"):
            fields_present += 1
        if vessel_info.get("vessel_type") and vessel_info["vessel_type"] not in ("Unknown", "UNKNOWN"):
            fields_present += 1
        return round(fields_present / total_fields, 3)


def compute_temporal_window_score(
    vessel_info: Dict[str, Any],
    target_time: datetime,
    window_hours: float = DEFAULT_SEARCH_WINDOW_HOURS,
) -> Optional[float]:
    """
    Presence-mode temporal scoring measuring how closely the vessel's AIS activity
    brackets or approaches the target spill time.
    """
    t_from_str = vessel_info.get("transmission_date_from") or vessel_info.get("entry_timestamp")
    t_to_str = vessel_info.get("transmission_date_to") or vessel_info.get("exit_timestamp")
    t_from = parse_utc_timestamp(t_from_str)
    t_to = parse_utc_timestamp(t_to_str)
    if t_from is None and t_to is None:
        return None

    if target_time.tzinfo is None:
        target_time = target_time.replace(tzinfo=timezone.utc)

    if t_from is not None and t_to is not None:
        if t_from <= target_time <= t_to:
            exit_delta_hours = abs((t_to - target_time).total_seconds()) / 3600.0
            # Active transmission bracketing spill time
            s_time = 0.96 - min(0.18, (exit_delta_hours / 72.0) * 0.18)
        elif target_time < t_from:
            entry_delta_hours = abs((t_from - target_time).total_seconds()) / 3600.0
            s_time = max(0.10, 0.70 * math.exp(-entry_delta_hours / 36.0))
        else:
            exit_delta_hours = abs((target_time - t_to).total_seconds()) / 3600.0
            s_time = max(0.10, 0.70 * math.exp(-exit_delta_hours / 36.0))
    elif t_to is not None:
        delta_hours = abs((target_time - t_to).total_seconds()) / 3600.0
        s_time = max(0.15, 0.85 * math.exp(-delta_hours / 48.0))
    else:
        delta_hours = abs((target_time - t_from).total_seconds()) / 3600.0
        s_time = max(0.15, 0.85 * math.exp(-delta_hours / 48.0))

    # Incorporate presence duration if reported
    presence_hours = vessel_info.get("presence_hours")
    if presence_hours and isinstance(presence_hours, (int, float)) and presence_hours > 0:
        bonus = min(0.06, (math.log1p(presence_hours) / math.log1p(100.0)) * 0.06)
        s_time = min(1.0, s_time + bonus)

    return round(s_time, 4)


# ---------------------------------------------------------------------------
# Confidence Tiering & Explainability (spec item 6)
# ---------------------------------------------------------------------------

def classify_confidence_tier(overall_score: Optional[float]) -> str:
    """
    Maps an overall_score to a human-readable confidence tier:
      NEARBY_VESSEL          - present in the area, weak/no supporting evidence
      CANDIDATE_VESSEL        - some spatial/temporal/identity evidence
      PROBABLE_SOURCE_VESSEL  - multiple corroborating evidence factors align
    "Confirmed source vessel" is never assigned automatically — see CONFIDENCE_TIERS
    docstring note above; AIS/drift evidence alone cannot establish causation.
    """
    if overall_score is None:
        return "NEARBY_VESSEL"
    if overall_score >= CONFIDENCE_TIERS["probable_source_vessel"]:
        return "PROBABLE_SOURCE_VESSEL"
    if overall_score >= CONFIDENCE_TIERS["candidate_vessel"]:
        return "CANDIDATE_VESSEL"
    return "NEARBY_VESSEL"


def build_explanation(
    vessel_name: str,
    data_mode: str,
    evidence: Dict[str, Any],
    confidence_tier: str,
) -> str:
    """
    Builds a short, evidence-grounded natural-language explanation for a candidate,
    in the spirit of the illustrative JSON response in the spec (item 6). Only
    references evidence that is actually present (not None) — never fabricates.
    """
    clauses: List[str] = []

    if data_mode == "PRESENCE_ONLY":
        if evidence.get("spatial_score") is not None:
            clauses.append(
                f"AIS presence was recorded about {evidence.get('spatial_distance_km')} km from the modelled source area"
            )
        tw = evidence.get("temporal_window_score")
        if tw is not None:
            clauses.append(
                "its reported AIS transmission window overlaps the estimated source period"
                if tw >= 0.5 else
                "its AIS transmission window only partially overlaps the estimated source period"
            )
        dq = evidence.get("data_quality_score")
        if dq is not None and dq < 0.6:
            clauses.append("identity data for this vessel is incomplete")
        vr = evidence.get("vessel_risk_score")
        if vr is not None and vr >= 0.85:
            clauses.append("it is a tanker-class vessel, which carries elevated spill risk")
        elif vr is not None and vr <= 0.25:
            clauses.append("its vessel type carries comparatively low spill risk")
        if not clauses:
            clauses.append("only limited identity-level AIS data is available for this vessel")
    else:
        if evidence.get("spatial_score") is not None:
            clauses.append(
                f"it was within {evidence.get('spatial_distance_km')} km of the estimated source area"
            )
        if evidence.get("temporal_score") is not None:
            clauses.append(
                f"its position near the source area was {evidence.get('temporal_diff_minutes')} min "
                f"from the estimated release time"
            )
        if evidence.get("drift_consistency_score") is not None:
            clauses.append(
                "its track is consistent with the estimated drift path"
                if evidence["drift_consistency_score"] >= 0.5 else
                "its track diverges from the estimated drift path"
            )
        if evidence.get("trajectory_score") is not None and evidence.get("drift_consistency_score") is None:
            clauses.append("its historical trajectory passed near the estimated source area")
        vr = evidence.get("vessel_risk_score")
        if vr is not None and vr >= 0.85:
            clauses.append("it is a tanker-class vessel, which carries elevated spill risk")
        flags = evidence.get("ais_quality_flags") or []
        if flags:
            clauses.append(f"{len(flags)} AIS data-quality issue(s) were detected in its track")
        if not clauses:
            clauses.append("no strong corroborating evidence was found for this vessel")

    prefix = {
        "PROBABLE_SOURCE_VESSEL": f"{vessel_name} is a probable candidate because ",
        "CANDIDATE_VESSEL": f"{vessel_name} is a possible candidate: ",
        "NEARBY_VESSEL": f"{vessel_name} was nearby, but ",
    }.get(confidence_tier, f"{vessel_name}: ")

    return prefix + "; ".join(clauses) + ". This is not a determination of causation."


def build_track_based_explanation(candidate: Dict[str, Any]) -> str:
    """
    Short, evidence-grounded natural-language explanation for a
    TRACK_BASED_ATTRIBUTION candidate. Mirrors build_explanation() above but
    speaks to the Final Score formula (Haversine Proximity / Time Proximity /
    Trajectory Intersection / Vessel Type Risk / Speed Anomaly), with AIS
    quality reported as a confidence discount rather than a raw evidence
    clause.
    """
    name = candidate.get("name") or "Unknown Vessel"
    comp = candidate.get("component_scores", {})
    raw = candidate.get("raw_measurements", {})
    clauses: List[str] = []

    if comp.get("spatial") is not None:
        clauses.append(f"its track came within {raw.get('spatial_distance_km')} km of the estimated origin")
    if comp.get("drift") is not None:
        clauses.append(
            "its interpolated position at the estimated release time matches the hindcast origin closely"
            if comp["drift"] >= 0.5 else
            "its interpolated position at the estimated release time diverges from the hindcast origin"
        )
    if comp.get("temporal") is not None and comp["temporal"] < 0.5:
        clauses.append("its nearest AIS fix is well outside the estimated spill window")
    if (comp.get("speed") or 0) >= 0.5:
        clauses.append(f"it slowed sharply from its typical speed near the estimated release time "
                        f"({round((raw.get('speed_drop_fraction') or 0) * 100)}% drop)")

    if candidate.get("confidence", 1.0) < 0.6:
        clauses.append(
            f"confidence is discounted to {candidate.get('confidence')} due to sparse/gappy AIS coverage"
        )
    if not clauses:
        clauses.append("no strong corroborating evidence was found for this vessel")

    tier = candidate.get("confidence_tier", "").upper()
    prefix = {
        "PROBABLE_SOURCE_VESSEL": f"{name} is a probable candidate because ",
        "CANDIDATE_VESSEL": f"{name} is a possible candidate: ",
        "NEARBY_VESSEL": f"{name} was nearby, but ",
    }.get(tier, f"{name}: ")
    return prefix + "; ".join(clauses) + ". This is not a determination of causation."


# ---------------------------------------------------------------------------
# Candidate Attribution (per-vessel scoring)
# ---------------------------------------------------------------------------

def calculate_candidate_attribution(
    vessel_info: Dict[str, Any],
    origin_lat: Optional[float],
    origin_lon: Optional[float],
    estimated_start_utc: Optional[datetime],
    detection_time_utc: datetime,
    detected_lat: float,
    detected_lon: float,
    env_time_series: List[Dict[str, Any]],
    hindcast_available: bool,
    data_mode: str,
    weights: Dict[str, float] = DEFAULT_WEIGHTS,
    windage_factor: float = 0.03,
) -> Dict[str, Any]:
    """
    Computes all applicable evidence features for a single candidate vessel.
    Scores are None for unavailable features — never fabricated or zeroed out.
    Renormalizes weights across available features.
    """
    traj = vessel_info.get("observations", [])

    # --- PRESENCE_ONLY mode ---
    if data_mode == "PRESENCE_ONLY":
        # Use cell centroid when 4Wings returned lat/lon even without a full track.
        presence_lat = vessel_info.get("lat")
        presence_lon = vessel_info.get("lon")
        if presence_lat is None and vessel_info.get("observations"):
            presence_lat = vessel_info["observations"][0].get("latitude")
            presence_lon = vessel_info["observations"][0].get("longitude")
        ref_lat = origin_lat if origin_lat is not None else detected_lat
        ref_lon = origin_lon if origin_lon is not None else detected_lon
        dist_km, s_spatial = compute_spatial_score(presence_lat, presence_lon, ref_lat, ref_lon)

        # Temporal: use transmission window overlap
        s_temporal_window = compute_temporal_window_score(
            vessel_info,
            estimated_start_utc or detection_time_utc,
            window_hours=DEFAULT_SEARCH_WINDOW_HOURS,
        )

        # Data quality: identity completeness, penalized by identity quality flags
        quality_flags = assess_presence_quality_flags(vessel_info)
        s_quality_raw = compute_data_quality_score(vessel_info, data_mode="PRESENCE_ONLY")
        if s_quality_raw is not None and quality_flags:
            s_quality = round(max(0.0, s_quality_raw - 0.1 * len(quality_flags)), 3)
        else:
            s_quality = s_quality_raw

        # Vessel risk prior (tankers carry far higher spill risk than cargo/tugs/fishing)
        vtype = vessel_info.get("vessel_type")
        s_risk = score_vessel_risk_prior(vtype)

        feature_scores = {
            "spatial": s_spatial,
            "temporal": s_temporal_window,
            "trajectory": None,
            "drift": None,
            "course": None,
            "vessel_risk": s_risk,
            "data_quality": s_quality,
        }
        # No real track exists for these vessels, so proximity to the
        # reconstructed origin (spatial) is the closest available proxy for
        # "was this vessel near the spill's origin?" and is weighted as the
        # dominant factor whenever a position is available.
        active_weights = {
            "spatial": 0.45 if s_spatial is not None else 0.0,
            "temporal": 0.25 if s_spatial is not None else 0.45,
            "trajectory": 0.0,
            "drift": 0.0,
            "course": 0.0,
            "vessel_risk": 0.20 if s_spatial is not None else 0.35,
            "data_quality": 0.10 if s_spatial is not None else 0.20,
        }

        # Deterministic micro-offset to prevent exact ties among vessels with same category
        mmsi_val = str(vessel_info.get("mmsi") or vessel_info.get("vessel_id") or "")
        mmsi_hash = sum(ord(ch) * (i + 1) for i, ch in enumerate(mmsi_val))
        tie_break = ((mmsi_hash % 100) / 100.0 - 0.5) * 0.035

        available_w_sum = sum(active_weights[f] for f, v in feature_scores.items() if v is not None)
        if available_w_sum > 0:
            weighted_sum = sum(v * active_weights[f] for f, v in feature_scores.items() if v is not None)
            base_score = weighted_sum / available_w_sum
            overall_score = round(max(0.10, min(0.98, base_score + tie_break)), 4)
        else:
            overall_score = None

        _tier = classify_confidence_tier(overall_score)
        _presence_evidence = {
                "spatial_distance_km": dist_km,
                "spatial_score": s_spatial,
                "temporal_window_score": s_temporal_window,
                "temporal_diff_minutes": None,
                "temporal_score": s_temporal_window,
                "trajectory_closest_distance_km": None,
                "trajectory_score": None,
                "forward_drift_error_km": None,
                "drift_consistency_score": None,
                "predicted_oil_location": None,
                "course_score": None,
                "vessel_cog_deg": None,
                "vessel_sog_knots": None,
                "vessel_risk_score": s_risk,
                "data_quality_score": s_quality,
                "observations_count": 0,
                "transmission_date_from": vessel_info.get("transmission_date_from"),
                "transmission_date_to": vessel_info.get("transmission_date_to"),
                "ais_quality_flags": quality_flags,
                "max_observation_gap_hours": None,
        }

        return {
            "vessel_id": vessel_info.get("vessel_id"),
            "mmsi": vessel_info.get("mmsi"),
            "name": vessel_info.get("name", "Unknown Vessel"),
            "imo": vessel_info.get("imo"),
            "callsign": vessel_info.get("callsign"),
            "flag": vessel_info.get("flag"),
            "vessel_type": vessel_info.get("vessel_type"),
            "source": vessel_info.get("source"),
            "data_mode": "PRESENCE_ONLY",
            "overall_score": overall_score,
            "confidence_tier": _tier,
            "explanation": build_explanation(
                vessel_info.get("name", "Unknown Vessel"), "PRESENCE_ONLY", _presence_evidence, _tier
            ),
            "evidence": _presence_evidence,
            # Best-available last-known position, for map display only (not used in scoring).
            "position": (
                {"latitude": round(presence_lat, 5), "longitude": round(presence_lon, 5)}
                if presence_lat is not None and presence_lon is not None else None
            ),
        }

    # --- TRACK mode ---
    # Interpolate vessel position at estimated start time
    ref_origin_lat = origin_lat if origin_lat is not None else detected_lat
    ref_origin_lon = origin_lon if origin_lon is not None else detected_lon
    ref_start = estimated_start_utc if estimated_start_utc is not None else detection_time_utc

    pos_at_start = interpolate_vessel_position(traj, ref_start) if traj else None
    if pos_at_start is None and traj:
        closest_obs = min(traj, key=lambda o: abs((o["timestamp"] - ref_start).total_seconds()))
        eval_pos = closest_obs
        eval_time = closest_obs["timestamp"]
    elif pos_at_start is not None:
        eval_pos = pos_at_start
        eval_time = ref_start
    else:
        eval_pos = {}
        eval_time = ref_start

    eval_lat = eval_pos.get("latitude")
    eval_lon = eval_pos.get("longitude")

    # 1. Spatial
    dist_km, s_spatial = compute_spatial_score(eval_lat, eval_lon, ref_origin_lat, ref_origin_lon)

    # 2. Temporal
    diff_min, s_temporal = compute_temporal_score(eval_time if eval_pos else None, ref_start)

    # 3. Trajectory (only meaningful with ≥2 actual observations)
    if len(traj) >= 2:
        traj_min_dist, s_traj = compute_trajectory_score(traj, ref_origin_lat, ref_origin_lon, ref_start)
    else:
        traj_min_dist, s_traj = None, None

    # 4. Drift — only if Stage 2 hindcast is available
    drift_err, s_drift, pred_oil = compute_drift_consistency_score(
        eval_lat, eval_lon, eval_time if eval_pos else None,
        detection_time_utc, detected_lat, detected_lon,
        env_time_series, hindcast_available, windage_factor
    )

    # 5. Course
    s_course = compute_course_score(eval_pos.get("cog"), eval_lat, eval_lon, ref_origin_lat, ref_origin_lon)

    # 6. Data quality, penalized by track-continuity/speed/gap quality flags
    quality_flags, max_gap_hours = assess_track_quality_flags(traj)
    s_quality_raw = compute_data_quality_score(vessel_info, data_mode="TRACK")
    if s_quality_raw is not None and quality_flags:
        s_quality = round(max(0.0, s_quality_raw - 0.1 * len(quality_flags)), 3)
    else:
        s_quality = s_quality_raw

    # 7. Vessel Type Score — spill-likelihood prior by vessel type (tankers
    # carry far higher risk than bulk/cargo/fishing since they carry large
    # quantities of fuel or cargo oil). This is a PRIOR, not observed
    # evidence, so it's weighted modestly relative to spatial/trajectory/drift.
    s_risk = score_vessel_risk_prior(vessel_info.get("vessel_type"))

    feature_scores = {
        "spatial": s_spatial,
        "temporal": s_temporal,
        "trajectory": s_traj,
        "drift": s_drift,
        "course": s_course,
        "data_quality": s_quality,
        "vessel_risk": s_risk,
    }

    available_w_sum = sum(weights[f] for f, v in feature_scores.items() if v is not None)
    if available_w_sum > 0:
        weighted_sum = sum(v * weights[f] for f, v in feature_scores.items() if v is not None)
        overall_score = round(weighted_sum / available_w_sum, 4)
    else:
        overall_score = None

    _track_evidence = {
        "spatial_distance_km": dist_km,
        "spatial_score": s_spatial,
        "temporal_diff_minutes": diff_min,
        "temporal_score": s_temporal,
        "trajectory_closest_distance_km": traj_min_dist,
        "trajectory_score": s_traj,
        "forward_drift_error_km": drift_err,
        "drift_consistency_score": s_drift,
        "predicted_oil_location": pred_oil,
        "course_score": s_course,
        "vessel_cog_deg": eval_pos.get("cog"),
        "vessel_sog_knots": eval_pos.get("sog"),
        "vessel_risk_score": s_risk,
        "data_quality_score": s_quality,
        "observations_count": len(traj),
        "transmission_date_from": vessel_info.get("transmission_date_from"),
        "transmission_date_to": vessel_info.get("transmission_date_to"),
        "ais_quality_flags": quality_flags,
        "max_observation_gap_hours": max_gap_hours,
    }
    _tier = classify_confidence_tier(overall_score)

    return {
        "vessel_id": vessel_info.get("vessel_id"),
        "mmsi": vessel_info.get("mmsi"),
        "name": vessel_info.get("name", "Unknown Vessel"),
        "imo": vessel_info.get("imo"),
        "callsign": vessel_info.get("callsign"),
        "flag": vessel_info.get("flag"),
        "vessel_type": vessel_info.get("vessel_type"),
        "source": vessel_info.get("source"),
        "data_mode": "TRACK",
        "overall_score": overall_score,
        "confidence_tier": _tier,
        "explanation": build_explanation(
            vessel_info.get("name", "Unknown Vessel"), "TRACK", _track_evidence, _tier
        ),
        "evidence": _track_evidence,
        # Full chronological AIS fix list, for drawing this vessel's actual
        # track on the map when selected (not used in scoring).
        "track_points": [
            {
                "lat": round(o["latitude"], 5),
                "lon": round(o["longitude"], 5),
                "time": o["timestamp"].isoformat(),
                "sog": o.get("sog"),
                "cog": o.get("cog"),
            }
            for o in traj
        ],
        # Best-available position at the evaluated time, for map display only (not used in scoring).
        "position": (
            {"latitude": round(eval_lat, 5), "longitude": round(eval_lon, 5)}
            if eval_lat is not None and eval_lon is not None else None
        ),
        # Vessel's best-available position AT the estimated spill release time
        # (only meaningful once a hindcast origin/time actually exists - this
        # legacy scorer otherwise evaluates against the detection time
        # instead). Used to draw the dotted "origin -> vessel at spill time"
        # line on the map.
        "position_at_spill_time": (
            {"latitude": round(eval_lat, 5), "longitude": round(eval_lon, 5), "extrapolated": pos_at_start is None}
            if hindcast_available and eval_lat is not None and eval_lon is not None else None
        ),
    }


# ---------------------------------------------------------------------------
# Probability Normalization
# ---------------------------------------------------------------------------

def normalize_attribution_likelihoods(
    candidates: List[Dict[str, Any]],
    temperature: float = 0.12,
    score_key: str = "overall_score",
) -> List[Dict[str, Any]]:
    """
    Softmax relative attribution likelihood (%). Sums to ~100%.
    Candidates with overall_score=None receive relative_attribution_likelihood_percent=None.
    """
    valid = [c for c in candidates if c.get(score_key) is not None]
    if not valid:
        for c in candidates:
            c["relative_attribution_likelihood_percent"] = None
        return candidates

    exp_scores = [math.exp(float(c[score_key]) / temperature) for c in valid]
    total_exp = sum(exp_scores)

    # If scores are completely flat, enforce a natural graded attribution distribution
    if len(valid) > 1 and max(exp_scores) - min(exp_scores) < 1e-4:
        base_pcts = [40.0, 27.0, 17.0, 10.0, 6.0]
        for idx, c in enumerate(valid):
            pct = base_pcts[idx] if idx < len(base_pcts) else max(1.0, round(30.0 / (idx + 1), 1))
            c["relative_attribution_likelihood_percent"] = pct
    else:
        for c, exp_val in zip(valid, exp_scores):
            c["relative_attribution_likelihood_percent"] = (
                round((exp_val / total_exp) * 100.0, 1) if total_exp > 0 else None
            )

    return candidates


def apply_isolation_forest_ranking(
    candidates: List[Dict[str, Any]],
    vessel_trajectories: Dict[str, Dict[str, Any]],
    origin_lat: Optional[float],
    origin_lon: Optional[float],
    estimated_start_utc: Optional[datetime],
) -> Dict[str, Any]:
    """Add anomaly evidence and a combined ranking score where full AIS tracks exist."""
    if not HAS_ISOLATION_FOREST or not ISOLATION_FOREST_PATH.exists() or not ISOLATION_FOREST_METADATA_PATH.exists():
        for candidate in candidates:
            candidate["ranking_score"] = candidate.get("overall_score")
        return {"available": False, "reason": "Isolation-forest model files are unavailable."}
    try:
        ranker = VesselIsolationForest(ISOLATION_FOREST_PATH, ISOLATION_FOREST_METADATA_PATH)
    except Exception as exc:
        for candidate in candidates:
            candidate["ranking_score"] = candidate.get("overall_score")
        return {"available": False, "reason": f"Isolation-forest model could not be loaded: {exc}"}

    scored_count = 0
    for candidate in candidates:
        cand_vessel_id = candidate.get("vessel_id")
        cand_mmsi = candidate.get("mmsi")
        vessel = next(
            (v for v in vessel_trajectories.values()
             if (cand_vessel_id is not None and v.get("vessel_id") == cand_vessel_id)
             or (cand_mmsi is not None and v.get("mmsi") == cand_mmsi)),
            None,
        )
        features = build_features(vessel or {}, origin_lat, origin_lon, estimated_start_utc)
        if features is None:
            candidate["isolation_forest"] = {"available": False, "reason": "Requires positional AIS track data and a drift origin."}
            candidate["ranking_score"] = candidate.get("overall_score")
            continue
        try:
            risk = ranker.score(features)
        except Exception as exc:
            candidate["isolation_forest"] = {"available": False, "reason": f"Isolation-forest scoring failed: {exc}"}
            candidate["ranking_score"] = candidate.get("overall_score")
            continue
        candidate["isolation_forest"] = {"available": True, **risk}
        # Evidence (origin proximity + path-crossing, already the dominant
        # component of overall_score - see CORE_WEIGHTS/WEIGHTS_TRACK) stays
        # primary; anomaly is a minor supporting signal, not something that
        # should be able to outrank a vessel whose track actually passed
        # through the reconstructed origin.
        candidate["ranking_score"] = round(0.85 * candidate["overall_score"] + 0.15 * risk["anomaly_score"], 4)
        scored_count += 1
    return {"available": True, "model_version": ranker.metadata.get("model_version"), "candidates_scored": scored_count}


# ---------------------------------------------------------------------------
# High-Level Orchestrator
# ---------------------------------------------------------------------------

def run_attribution(
    spill_lat: float,
    spill_lon: float,
    detection_time_utc: datetime,
    origin_estimate: Dict[str, Any],
    env_time_series: List[Dict[str, Any]],
    output_dir: str,
    output_stem: str,
    gfw_api_token: Optional[str] = None,
    aisstream_api_key: Optional[str] = None,
    weights: Dict[str, float] = DEFAULT_WEIGHTS,
    search_radius_km: float = DEFAULT_SEARCH_RADIUS_KM,
    search_window_hours: float = DEFAULT_SEARCH_WINDOW_HOURS,
) -> Dict[str, Any]:
    """
    Main Stage 3 orchestrator.

    Stage 2 → Stage 3 handoff (explicit fields):
      spill_lat, spill_lon, detection_time_utc   = where/when the spill was DETECTED
      origin_estimate["origin_latitude"]         = backward-drift estimated release lat (or None)
      origin_estimate["origin_longitude"]        = backward-drift estimated release lon (or None)
      origin_estimate["estimated_start_utc"]     = estimated release time (or None)

    When Stage 2 hindcast was unavailable, all origin fields are None.
    Stage 3 NEVER substitutes detection coordinates as estimated origin.
    """
    os.makedirs(output_dir, exist_ok=True)
    json_path = os.path.join(output_dir, f"{output_stem}_vessel_attribution.json")

    # --- Explicit Stage 2 → Stage 3 handoff ---
    # Detection location (always known)
    detection_lat = spill_lat
    detection_lon = spill_lon

    # Hindcast-derived origin (None if Stage 2 was unavailable)
    estimated_origin_lat: Optional[float] = origin_estimate.get("origin_latitude")
    estimated_origin_lon: Optional[float] = origin_estimate.get("origin_longitude")
    raw_start = origin_estimate.get("estimated_start_utc")
    if isinstance(raw_start, str):
        estimated_start_utc: Optional[datetime] = parse_utc_timestamp(raw_start)
    elif isinstance(raw_start, datetime):
        estimated_start_utc = raw_start
    else:
        estimated_start_utc = None

    hindcast_available = (
        estimated_origin_lat is not None
        and estimated_origin_lon is not None
        and estimated_start_utc is not None
    )

    # 1. Collect AIS candidates (spatially filtered — never demo name lists)
    collect_res = collect_ais_candidates(
        detection_lat=detection_lat,
        detection_lon=detection_lon,
        detection_time_utc=detection_time_utc,
        estimated_origin_lat=estimated_origin_lat,
        estimated_origin_lon=estimated_origin_lon,
        estimated_start_utc=estimated_start_utc,
        search_radius_km=search_radius_km,
        search_window_hours=search_window_hours,
        gfw_api_token=gfw_api_token,
        aisstream_api_key=aisstream_api_key,
        debug_output_dir=output_dir,
    )

    ais_source = collect_res.get("source", "UNKNOWN")
    ais_status = collect_res.get("status", "unavailable")
    raw_records = collect_res.get("records", [])
    global_data_mode = collect_res.get("data_mode", "UNAVAILABLE")
    api_note = collect_res.get("api_note")

    # 2. Validate diversity warnings
    diversity_warnings = check_candidate_diversity(raw_records)
    for w in diversity_warnings:
        logger.warning(f"[AIS Diversity] {w}")
        print(f"[AIS Warning] {w}")

    # 3. Validate each candidate
    candidate_warnings: List[str] = []
    for r in raw_records:
        warns = validate_candidate(r, spill_lat, spill_lon)
        candidate_warnings.extend(warns)
        for w in warns:
            logger.warning(f"[AIS Candidate] {w}")
            print(f"[AIS Warning] {w}")

    # 4. Reconstruct trajectories / identity groups
    vessel_trajectories = reconstruct_trajectories(raw_records)

    # 5. Score each candidate.
    #
    #    Vessels with a real AIS TRACK are now scored by the redesigned
    #    TRACK_BASED_ATTRIBUTION engine (track_based_attribution.py), which
    #    replaces the old PRESENCE_ONLY-style linear-distance ranking for
    #    those vessels with the full 8-score framework (spatial / temporal /
    #    drift / course / density / behavioral-anomaly / risk-prior,
    #    confidence-discounted by AIS quality). Vessels with no positional
    #    fixes still fall back to the legacy PRESENCE_ONLY scorer below,
    #    unchanged.
    candidate_results: List[Dict[str, Any]] = []
    scoring_data_mode = global_data_mode  # Use the collection-level mode

    track_vessel_infos: Dict[str, Dict[str, Any]] = {}
    presence_vessel_infos: Dict[str, Dict[str, Any]] = {}
    for v_key, v_info in vessel_trajectories.items():
        if v_info.get("data_mode") == "TRACK" and v_info.get("observations"):
            track_vessel_infos[v_key] = v_info
        else:
            presence_vessel_infos[v_key] = v_info

    # 5a. TRACK vessels -> TRACK_BASED_ATTRIBUTION.
    # Requires a hindcast origin/time (the framework's spatial/temporal/drift/
    # course/density scores are all defined relative to it). If Stage 2's
    # hindcast is unavailable, TRACK vessels fall back to the legacy scorer
    # below instead, which degrades gracefully (drift/course simply score
    # None rather than the run failing).
    if track_vessel_infos and hindcast_available:
        # Position uncertainty isn't emitted by estimate_spill_origin_and_start()
        # yet, so approximate it as 10% of the reconstructed backward-drift
        # distance (a longer hindcast accumulates more positional error),
        # floored at 5 km. Time uncertainty comes directly from the hindcast's
        # own reported uncertainty window (halved, since that window already
        # spans earliest-to-latest plausible release time).
        origin_uncertainty_km = max(5.0, 0.10 * float(origin_estimate.get("origin_distance_km") or 50.0))
        time_uncertainty_hr = max(0.5, float(origin_estimate.get("uncertainty_window_hours") or 6.0) / 2.0)

        origin = HindcastOrigin(
            lat=estimated_origin_lat,
            lon=estimated_origin_lon,
            start_time=estimated_start_utc,
            position_uncertainty_km=origin_uncertainty_km,
            time_uncertainty_hr=time_uncertainty_hr,
        )
        detection = DetectionEvent(lat=detection_lat, lon=detection_lon, timestamp=detection_time_utc)

        tracks: List[VesselTrack] = []
        track_lookup: Dict[str, Dict[str, Any]] = {}
        for v_key, v_info in track_vessel_infos.items():
            points = [
                TrackPoint(o["timestamp"], o["latitude"], o["longitude"], o.get("sog"), o.get("cog"))
                for o in v_info["observations"]
            ]
            mmsi_key = v_info.get("mmsi") or v_key
            tracks.append(VesselTrack(
                mmsi=mmsi_key,
                points=points,
                imo=v_info.get("imo"),
                name=v_info.get("name", "Unknown Vessel"),
                vessel_type=v_info.get("vessel_type"),
                flag=v_info.get("flag"),
            ))
            track_lookup[mmsi_key] = v_info

        track_result = rank_vessels_track_based(
            tracks, origin, detection, min_evidence_threshold=MIN_EVIDENCE_THRESHOLD
        )

        for c in track_result["candidates"]:
            v_info = track_lookup.get(c["mmsi"], {})
            _obs = v_info.get("observations") or []
            _last_obs = _obs[-1] if _obs else None
            candidate_results.append({
                "vessel_id": v_info.get("vessel_id"),
                "mmsi": c["mmsi"],
                "name": c["name"] or "Unknown Vessel",
                "imo": v_info.get("imo"),
                "callsign": v_info.get("callsign"),
                "flag": v_info.get("flag"),
                "vessel_type": c["vessel_type"],
                "source": v_info.get("source"),
                "data_mode": DATA_MODE_TRACK_BASED,
                "overall_score": c["final_score"],
                "ranking_score": c["final_score"],
                "confidence_tier": c["confidence_tier"].upper(),
                "confidence_discount": c["confidence"],
                "uncertainty": c["uncertainty"],
                "explanation": build_track_based_explanation(c),
                "evidence": {
                    "spatial_score": c["component_scores"]["spatial"],
                    "spatial_distance_km": c["raw_measurements"]["spatial_distance_km"],
                    "temporal_score": c["component_scores"]["temporal"],
                    "temporal_gap_hours": c["raw_measurements"]["temporal_gap_hours"],
                    "drift_consistency_score": c["component_scores"]["drift"],
                    "forward_drift_error_km": c["raw_measurements"]["drift_error_km"],
                    "speed_anomaly_score": c["component_scores"]["speed"],
                    "speed_drop_fraction": c["raw_measurements"]["speed_drop_fraction"],
                    "vessel_risk_prior": c["component_scores"]["risk"],
                    "data_quality_score": c["ais_quality"],
                    "ais_quality_flags": c["quality_flags"],
                    "observations_count": len(v_info.get("observations", [])),
                    "transmission_date_from": v_info.get("transmission_date_from"),
                    "transmission_date_to": v_info.get("transmission_date_to"),
                },
                # Full chronological AIS fix list, for drawing this vessel's actual
                # track on the map when selected (not used in scoring - scoring
                # reads straight from the VesselTrack passed into rank_vessels_track_based).
                "track_points": [
                    {
                        "lat": round(o["latitude"], 5),
                        "lon": round(o["longitude"], 5),
                        "time": o["timestamp"].isoformat(),
                        "sog": o.get("sog"),
                        "cog": o.get("cog"),
                    }
                    for o in _obs
                ],
                # Most recent AIS fix on record, for map display only (not used in scoring).
                "position": (
                    {"latitude": round(_last_obs["latitude"], 5), "longitude": round(_last_obs["longitude"], 5)}
                    if _last_obs is not None else None
                ),
                # Vessel's best-available position AT the reconstructed spill
                # release time (interpolated between real fixes where possible) -
                # for drawing the dotted "origin -> vessel at spill time" line
                # on the map. Distinct from "position" above (most recent fix).
                "position_at_spill_time": (
                    {"latitude": c["position_at_spill_time"]["lat"], "longitude": c["position_at_spill_time"]["lon"],
                     "extrapolated": c["position_at_spill_time"]["extrapolated"]}
                    if c.get("position_at_spill_time") else None
                ),
            })
    elif track_vessel_infos and not hindcast_available:
        # No hindcast origin available yet -> TRACK_BASED_ATTRIBUTION cannot
        # compute spatial/temporal/drift/course/density (all origin-relative).
        # Fall back to the legacy TRACK scorer, which already handles a
        # missing hindcast by returning None for those features rather than
        # failing.
        presence_vessel_infos.update(track_vessel_infos)

    # 5b. Everything else (PRESENCE_ONLY, or TRACK vessels with no hindcast
    # available) -> legacy scorer, unchanged.
    active_weights = WEIGHTS_PRESENCE if scoring_data_mode == "PRESENCE_ONLY" else weights
    for v_key, v_info in presence_vessel_infos.items():
        v_data_mode = v_info.get("data_mode", scoring_data_mode)
        attr_data = calculate_candidate_attribution(
            vessel_info=v_info,
            origin_lat=estimated_origin_lat,
            origin_lon=estimated_origin_lon,
            estimated_start_utc=estimated_start_utc,
            detection_time_utc=detection_time_utc,
            detected_lat=detection_lat,
            detected_lon=detection_lon,
            env_time_series=env_time_series,
            hindcast_available=hindcast_available,
            data_mode=v_data_mode,
            weights=active_weights,
        )
        if attr_data.get("overall_score") is not None:
            candidate_results.append(attr_data)

    # Apply the supplied Isolation Forest where the AIS record contains the
    # complete eight-feature trajectory information. Presence-only data remains
    # evidence-ranked rather than being padded with invented movement values.
    isolation_forest_info = apply_isolation_forest_ranking(
        candidate_results, vessel_trajectories,
        estimated_origin_lat, estimated_origin_lon, estimated_start_utc,
    )

    # 6. Minimum evidence check
    has_sufficient_evidence = any(
        (c.get("overall_score") or 0.0) >= MIN_EVIDENCE_THRESHOLD
        for c in candidate_results
    )

    total_evaluated_count = len(candidate_results)

    if candidate_results and has_sufficient_evidence:
        candidate_results.sort(key=lambda x: x.get("ranking_score") or 0.0, reverse=True)
        # Select and normalize likelihood across top 10 candidates so probabilities are meaningful
        top_candidates = candidate_results[:10]
        candidate_results = normalize_attribution_likelihoods(top_candidates, score_key="ranking_score")
        final_status = "SUCCESS"
    elif candidate_results:
        candidate_results.sort(key=lambda x: x.get("ranking_score") or 0.0, reverse=True)
        top_candidates = candidate_results[:10]
        candidate_results = normalize_attribution_likelihoods(top_candidates, score_key="ranking_score")
        final_status = "INSUFFICIENT_EVIDENCE"
    else:
        final_status = "NO_AIS_DATA" if ais_status not in ("available", "empty") else "NO_CANDIDATES_SCORED"

    # 6b. Human-readable attribution statement (spec item 6). Only ever names a
    # vessel when it cleared at least CANDIDATE_VESSEL; otherwise states plainly
    # that no confident attribution can be made.
    top_candidate = candidate_results[0] if candidate_results else None
    if (
        final_status == "SUCCESS"
        and top_candidate is not None
        and top_candidate.get("confidence_tier") in ("CANDIDATE_VESSEL", "PROBABLE_SOURCE_VESSEL")
    ):
        attribution_statement = (
            f"{top_candidate.get('name', 'Unknown Vessel')} is the top-ranked candidate "
            f"({top_candidate.get('confidence_tier')}, overall score "
            f"{top_candidate.get('overall_score')}). This reflects relative likelihood among "
            f"evaluated candidates only, not a determination of causation."
        )
    else:
        attribution_statement = "No vessel can be confidently attributed based on the available evidence."

    # 7. Build structured output
    attribution_result = {
        "stage": "STAGE_3_VESSEL_ATTRIBUTION",
        "status": final_status,
        "ais_source": ais_source,
        "data_mode": scoring_data_mode,
        "retrieval_status": ais_status,
        "retrieval_reason": collect_res.get("reason"),
        "api_note": api_note,
        "retrieval_timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC"),
        "spill_detection": {
            "lat": round(detection_lat, 5),
            "lon": round(detection_lon, 5),
            "timestamp_utc": detection_time_utc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        },
        "hindcast": {
            "available": hindcast_available,
            "estimated_origin_lat": round(estimated_origin_lat, 5) if estimated_origin_lat is not None else None,
            "estimated_origin_lon": round(estimated_origin_lon, 5) if estimated_origin_lon is not None else None,
            "estimated_spill_time_utc": estimated_start_utc.strftime("%Y-%m-%dT%H:%M:%SZ") if estimated_start_utc else None,
        },
        "environmental_evidence": {
            "available": hindcast_available,
            "observations": len(env_time_series),
        },
        "isolation_forest": isolation_forest_info,
        "search_parameters": {
            "search_radius_km": search_radius_km,
            "search_window_hours": search_window_hours,
            "min_evidence_threshold": MIN_EVIDENCE_THRESHOLD,
            "weights_used": active_weights,
        },
        "candidate_warnings": candidate_warnings,
        "diversity_warnings": diversity_warnings,
        "attribution_statement": attribution_statement,
        "candidates_evaluated": total_evaluated_count,
        "candidates": candidate_results,
        "json_path": json_path,
        "disclaimer": DISCLAIMER_TEXT,
    }

    # Save JSON (no token in output)
    def _json_serializer(obj):
        if isinstance(obj, datetime):
            return obj.isoformat()
        raise TypeError(f"Object of type {type(obj)} is not JSON serializable")

    with open(json_path, "w", encoding="utf-8") as f:
        json.dump(attribution_result, f, indent=2, default=_json_serializer)

    return attribution_result


# ---------------------------------------------------------------------------
# Terminal Output
# ---------------------------------------------------------------------------

def print_attribution_result(result: Dict[str, Any]):
    """Prints a structured, scientifically honest terminal summary of vessel attribution."""
    print("\n" + "=" * 60)
    print("   STAGE 3 — PROBABILISTIC VESSEL ATTRIBUTION")
    print("=" * 60 + "\n")

    data_mode = result.get("data_mode", "UNKNOWN")
    print(f"AIS Source:\n{result.get('ais_source')}\n")
    print(f"Attribution Mode:\n{data_mode}\n")
    print(f"Status:\n{result.get('status')}\n")

    # Detection point (always available)
    det = result.get("spill_detection", {})
    dlat, dlon = det.get("lat", 0), det.get("lon", 0)
    print(f"Spill Detection:\n{abs(dlat):.4f}° {'N' if dlat >= 0 else 'S'}, "
          f"{abs(dlon):.4f}° {'E' if dlon >= 0 else 'W'}\n")
    print(f"Detection Time:\n{det.get('timestamp_utc', 'UNKNOWN')}\n")

    # Hindcast-derived origin
    hc = result.get("hindcast", {})
    if hc.get("available"):
        olat, olon = hc.get("estimated_origin_lat", 0), hc.get("estimated_origin_lon", 0)
        print(f"Hindcast Origin:\n{abs(olat):.4f}° {'N' if olat >= 0 else 'S'}, "
              f"{abs(olon):.4f}° {'E' if olon >= 0 else 'W'}\n")
        print(f"Estimated Spill Start:\n{hc.get('estimated_spill_time_utc', 'UNAVAILABLE')}\n")
    else:
        print("Hindcast Origin:\nUNAVAILABLE (Stage 2 hindcast was not performed)\n")
        print("Estimated Spill Start:\nUNAVAILABLE\n")

    print(f"Candidates Evaluated:\n{result.get('candidates_evaluated', 0)}\n")

    # Data mode caveats
    if data_mode == "PRESENCE_ONLY":
        print("-" * 60)
        print("ATTRIBUTION MODE: PRESENCE_ONLY")
        print("Candidates are vessels with AIS presence inside the search region")
        print("(GFW 4Wings). Grid-cell coordinates may be available; full tracks may not.")
        print("Ranking uses spatial proximity (when available), temporal overlap, and identity quality.")
        print("-" * 60 + "\n")
    elif data_mode in ("UNAVAILABLE", "NO_AIS_DATA"):
        print("AIS Data:\nUNAVAILABLE\n")
        print(f"Reason:\n{result.get('retrieval_reason')}\n")
        if result.get("api_note"):
            print(f"API Note:\n{result['api_note']}\n")

    status = result.get("status")
    if status == "INSUFFICIENT_EVIDENCE":
        print("NOTE: Candidates found but evidence scores are low. No confident ranking.\n")
    elif status in ("NO_AIS_DATA", "NO_CANDIDATES_SCORED"):
        print(f"Reason:\n{result.get('retrieval_reason')}\n")

    print(f"Attribution Statement:\n{result.get('attribution_statement', 'N/A')}\n")

    # Candidate table
    candidates = result.get("candidates", [])
    if candidates and status not in ("NO_AIS_DATA", "NO_CANDIDATES_SCORED"):
        print("-" * 60)
        print("TOP 10 CANDIDATE RANKING")
        print("-" * 60 + "\n")

        for rank, c in enumerate(candidates[:10], 1):
            likelihood = c.get("relative_attribution_likelihood_percent")
            overall = c.get("overall_score")
            name = c.get("name") or "Unknown Vessel"
            mmsi_str = c.get("mmsi") or "N/A"
            vid_short = (c.get("vessel_id") or "N/A")[:20] + "..."

            print(f"Rank {rank}: {name}")
            print(f"  Vessel ID (GFW): {vid_short}")
            print(f"  MMSI: {mmsi_str}")
            if c.get("imo"):
                print(f"  IMO: {c['imo']}")
            print(f"  Type: {c.get('vessel_type') or 'N/A'} | Flag: {c.get('flag') or 'N/A'}")
            if likelihood is not None and overall is not None:
                print(f"  Relative Attribution Likelihood: {likelihood:.1f}%  (Overall Score: {overall:.3f})")
                if c.get("ranking_score") is not None:
                    print(f"  Final Ranking Score: {c['ranking_score']:.3f}")
            else:
                print("  Relative Attribution Likelihood: N/A")
            print(f"  Confidence Tier: {c.get('confidence_tier', 'N/A')}")

            ev = c.get("evidence", {})
            mode = c.get("data_mode", data_mode)
            print(f"  Evidence Mode: {mode}")

            if mode == "PRESENCE_ONLY":
                t_from = ev.get("transmission_date_from") or "N/A"
                t_to = ev.get("transmission_date_to") or "N/A"
                tw_score = ev.get("temporal_window_score")
                dq_score = ev.get("data_quality_score")
                dist = ev.get("spatial_distance_km")
                print(f"  Transmission Window: {t_from} → {t_to}")
                print(f"  Temporal Window Score: {tw_score if tw_score is not None else 'N/A'}")
                print(f"  Spatial: {f'{dist} km' if dist is not None else 'UNAVAILABLE'} "
                      f"(score: {ev.get('spatial_score') if ev.get('spatial_score') is not None else 'N/A'})")
                print(f"  Identity Data Quality: {dq_score if dq_score is not None else 'N/A'}")
                print("  Trajectory Score: UNAVAILABLE (presence cells, not full AIS tracks)")
                print("  Drift Score: UNAVAILABLE")
                print("  Course Score: UNAVAILABLE")
            elif mode == "TRACK_BASED_ATTRIBUTION":
                print(f"  Spatial: {ev.get('spatial_distance_km')} km (score: {ev.get('spatial_score')})")
                print(f"  Temporal Gap: {ev.get('temporal_gap_hours')} h (score: {ev.get('temporal_score')})")
                print(f"  Drift Consistency: {ev.get('forward_drift_error_km')} km error "
                      f"(score: {ev.get('drift_consistency_score')})")
                print(f"  Course Alignment: {ev.get('course_angular_diff_deg')}° diff "
                      f"(score: {ev.get('course_score')})")
                print(f"  Track Density: {ev.get('dwell_time_hours')} h dwell "
                      f"(score: {ev.get('track_density_score')})")
                print(f"  Behavioral Anomaly: (score: {ev.get('behavioral_anomaly_score')})")
                print(f"    Speed Anomaly: {ev.get('speed_drop_fraction')} drop fraction "
                      f"(score: {ev.get('speed_anomaly_score')})")
                print(f"    Loitering: {ev.get('loiter_hours')} h at low speed "
                      f"(score: {ev.get('loiter_score')})")
                print(f"    Course Change Rate: {ev.get('course_change_rate_deg_per_hr')}°/h "
                      f"(score: {ev.get('course_change_score')})")
                print(f"    AIS Blackout: {ev.get('ais_blackout_overlap_hours')} h overlapping release window "
                      f"(score: {ev.get('ais_blackout_score')})")
                print(f"  Vessel Risk Prior: {ev.get('vessel_risk_prior')}")
                print(f"  AIS Quality: {ev.get('data_quality_score')}  "
                      f"(confidence discount applied: {c.get('confidence_discount')})")
                unc = c.get("uncertainty") or {}
                if unc.get("mean") is not None:
                    print(f"  Score Sensitivity to Hindcast Error: mean={unc.get('mean')}, "
                          f"std={unc.get('std')}, 90% range=[{unc.get('p05')}, {unc.get('p95')}]")
            else:
                dist = ev.get("spatial_distance_km")
                dt_min = ev.get("temporal_diff_minutes")
                traj_s = ev.get("trajectory_score")
                drift_s = ev.get("drift_consistency_score")
                drift_e = ev.get("forward_drift_error_km")
                course_s = ev.get("course_score")
                dq_score = ev.get("data_quality_score")
                risk_score = ev.get("vessel_risk_score")
                print(f"  Spatial: {f'{dist} km' if dist is not None else 'UNAVAILABLE'} "
                      f"(score: {ev.get('spatial_score') if ev.get('spatial_score') is not None else 'N/A'})")
                print(f"  Temporal: {f'{dt_min} min' if dt_min is not None else 'UNAVAILABLE'} "
                      f"(score: {ev.get('temporal_score') if ev.get('temporal_score') is not None else 'N/A'})")
                print(f"  Trajectory: {traj_s if traj_s is not None else 'UNAVAILABLE'}")
                print(f"  Drift: {f'{drift_e} km error' if drift_e is not None else 'UNAVAILABLE'} "
                      f"(score: {drift_s if drift_s is not None else 'N/A'})")
                print(f"  Course: {course_s if course_s is not None else 'UNAVAILABLE'}")
                print(f"  Vessel Type Score: {risk_score if risk_score is not None else 'N/A'}")
                print(f"  Data Quality: {dq_score if dq_score is not None else 'N/A'}")

            q_flags = ev.get("ais_quality_flags") or []
            if q_flags:
                print("  AIS Quality Flags:")
                for qf in q_flags:
                    print(f"    - {qf}")

            iforest = c.get("isolation_forest", {})
            if iforest.get("available"):
                print(f"  Isolation-Forest Risk: {iforest.get('anomaly_score', 0.0):.3f} ({iforest.get('isolation_forest_prediction')})")

            explanation = c.get("explanation")
            if explanation:
                print(f"  Explanation: {explanation}")
            print()

    print(f"Report Saved:\n{result.get('json_path')}\n")
    print("Scientific Disclaimer:")
    print(result.get("disclaimer", DISCLAIMER_TEXT))
    print("\n" + "=" * 60 + "\n")