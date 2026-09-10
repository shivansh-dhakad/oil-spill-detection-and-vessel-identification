"""
environment.py - Open-Meteo API client for retrieving ocean current and wind data.

Integrates with:
  - Open-Meteo Marine API: ocean_current_velocity (km/h -> m/s), ocean_current_direction
  - Open-Meteo Historical / Forecast Weather API: wind_speed_10m, wind_direction_10m

Features:
  - Robust unit conversions (converts Open-Meteo km/h to SI m/s)
  - Strict missing data handling (never converts null/None into 0.0)
  - Full statistical validation (valid/missing counts, min/max/mean current speeds)
  - In-memory caching and offline error handling
"""

import logging
from datetime import datetime, timedelta, timezone
from typing import Optional, Dict, Any, List, Tuple
import time
import urllib.request
import urllib.parse
import json

logger = logging.getLogger(__name__)

# Open-Meteo API Endpoints
MARINE_API_URL = "https://marine-api.open-meteo.com/v1/marine"
HISTORICAL_WEATHER_URL = "https://archive-api.open-meteo.com/v1/archive"
FORECAST_WEATHER_URL = "https://api.open-meteo.com/v1/forecast"

# The forecast endpoint only serves a recent window (roughly the last ~90 days
# plus a short outlook); requesting older dates reliably returns HTTP 400.
# Skip the fallback call entirely once we know the request is out of range.
FORECAST_API_MAX_PAST_DAYS = 90

# Open-Meteo Marine's ocean-current model (SMOC) has zero coverage before
# this date, at ANY location. This matters because get_ocean_currents_nearest_valid
# fans out to 32 nearby points when the exact coordinates come back null — a
# reasonable strategy for a coastal/land grid cell, but a pure waste of 32
# sequential HTTP round-trips when the null is caused by the requested date
# predating SMOC entirely, since every nearby point will be equally null
# regardless of position. See the early-exit in that function below.
SMOC_COVERAGE_START_DATE = "2022-01-01"


class OpenMeteoClient:
    """
    Client for querying Open-Meteo Marine and Weather APIs with in-memory caching.
    """
    def __init__(self, timeout_seconds: int = 30, max_retries: int = 1):
        self.timeout_seconds = timeout_seconds
        self.max_retries = max_retries
        self._cache: Dict[str, Any] = {}

    def _make_request(self, url: str, params: Dict[str, Any]) -> Optional[Dict[str, Any]]:
        """
        Executes an HTTP GET request with standard urllib and caches the result.
        Retries once on transient failures (timeouts, connection resets) before
        giving up — network blips are common with these public endpoints.
        """
        query_string = urllib.parse.urlencode(params)
        full_url = f"{url}?{query_string}"

        if full_url in self._cache:
            return self._cache[full_url]

        attempts = self.max_retries + 1
        for attempt in range(attempts):
            try:
                req = urllib.request.Request(
                    full_url,
                    headers={"User-Agent": "OilSpillML-DriftEstimation/1.0"}
                )
                with urllib.request.urlopen(req, timeout=self.timeout_seconds) as response:
                    if response.status == 200:
                        data = json.loads(response.read().decode("utf-8"))
                        self._cache[full_url] = data
                        return data
                    else:
                        logger.warning(f"Open-Meteo request returned status {response.status}: {full_url}")
                        return None  # Non-200 (e.g. 400) won't succeed on retry
            except Exception as e:
                if attempt < attempts - 1:
                    logger.info(f"Open-Meteo request failed (attempt {attempt + 1}/{attempts}), retrying: {e}")
                    time.sleep(1.5)
                else:
                    logger.warning(f"Open-Meteo API request failed for {full_url}: {e}")

        return None

    def get_ocean_currents(
        self,
        latitude: float,
        longitude: float,
        start_date: str,
        end_date: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieves ocean current velocity and direction from Open-Meteo Marine API.
        
        Args:
            latitude: Target latitude (-90 to 90)
            longitude: Target longitude (-180 to 180)
            start_date: 'YYYY-MM-DD' in UTC
            end_date: 'YYYY-MM-DD' in UTC
        """
        params = {
            "latitude": round(latitude, 4),
            "longitude": round(longitude, 4),
            "start_date": start_date,
            "end_date": end_date,
            "hourly": "ocean_current_velocity,ocean_current_direction,wave_height,wave_direction,sea_surface_temperature",
            "timezone": "UTC",
        }
        return self._make_request(MARINE_API_URL, params)

    def get_ocean_currents_nearest_valid(
        self,
        latitude: float,
        longitude: float,
        start_date: str,
        end_date: str,
        max_radius_deg: float = 1.5,
    ) -> Tuple[Optional[Dict[str, Any]], float, float, Optional[float]]:
        """
        Same data as get_ocean_currents(), but works around a well-known
        Open-Meteo Marine (SMOC) limitation: the ocean-current model only has
        data over open water. Any grid cell that Open-Meteo classifies as
        land/coastline comes back with ocean_current_velocity/direction as
        null for every hour — even though wind (a global atmospheric model)
        returns fine for that same point. This is why wind "works" while
        ocean current reads as 0/missing for spill points near the coast.

        Strategy: query the exact coordinates first. If every returned
        ocean_current_velocity value is null OR a literal 0.0 (see note
        below), fan out to nearby points at increasing radius (in 8 compass
        directions) until one returns real, non-degenerate current data, and
        use that point's data instead.

        Note on literal-zero values: unlike every other Open-Meteo variable,
        the marine current model returns a bare 0.0 (speed) / ~0-90 (direction)
        instead of null for hours it hasn't actually computed yet — typically
        the most recent 1-6 hours nearest to "now", since the current model
        updates far less often than the weather model wind comes from. A
        constant, bit-exact 0.000 m/s reading is effectively never a real
        ocean current, so it's treated the same as missing data here.

        Returns (data, used_latitude, used_longitude, offset_deg):
          - offset_deg is 0.0 if the original coordinates already had valid data
          - offset_deg is None if no nearby point (within max_radius_deg) had
            valid data either, in which case `data` is the original (all-null/
            all-zero) response so the caller can still report accurate
            missing-data stats.
          - offset_deg is also None immediately, without any fan-out calls,
            when end_date predates SMOC_COVERAGE_START_DATE — a temporal gap
            with no spatial fix, so searching nearby points can't ever find
            valid data and would just waste 32 sequential HTTP requests.
        """
        def _has_valid_current(resp: Optional[Dict[str, Any]]) -> bool:
            if not resp:
                return False
            vels = resp.get("hourly", {}).get("ocean_current_velocity", [])
            return any(v is not None and float(v) != 0.0 for v in vels)

        original = self.get_ocean_currents(latitude, longitude, start_date, end_date)
        if _has_valid_current(original):
            return original, latitude, longitude, 0.0

        if end_date < SMOC_COVERAGE_START_DATE:
            # Temporal gap, not spatial — no nearby point would have data either.
            logger.info(
                f"Skipping nearest-valid-point search for ocean currents: requested "
                f"end_date {end_date} predates Open-Meteo SMOC coverage "
                f"({SMOC_COVERAGE_START_DATE}) — no location would have data for this date."
            )
            return original, latitude, longitude, None

        radii_deg = [0.2, 0.4, 0.8, 1.5]
        directions = [
            (1, 0), (-1, 0), (0, 1), (0, -1),
            (1, 1), (1, -1), (-1, 1), (-1, -1),
        ]
        for radius in radii_deg:
            if radius > max_radius_deg:
                break
            for dlat, dlon in directions:
                cand_lat = max(-90.0, min(90.0, latitude + dlat * radius))
                cand_lon = longitude + dlon * radius
                # Wrap longitude into [-180, 180]
                cand_lon = ((cand_lon + 180.0) % 360.0) - 180.0
                candidate = self.get_ocean_currents(cand_lat, cand_lon, start_date, end_date)
                if _has_valid_current(candidate):
                    logger.info(
                        f"Ocean current data was null at ({latitude:.4f}, {longitude:.4f}) "
                        f"(likely a coastal/land grid cell); using nearest valid open-water "
                        f"point ({cand_lat:.4f}, {cand_lon:.4f}), ~{radius * 111:.0f} km away."
                    )
                    return candidate, cand_lat, cand_lon, radius

        # No nearby point had valid data either — return the original (null) response.
        return original, latitude, longitude, None

    def get_wind_data(
        self,
        latitude: float,
        longitude: float,
        start_date: str,
        end_date: str,
    ) -> Optional[Dict[str, Any]]:
        """
        Retrieves 10m wind speed and direction.
        Tries the archive (historical reanalysis) endpoint first; falls back to the
        forecast endpoint only when the date range is recent enough for it to
        plausibly serve (older ranges reliably 400 there, so we skip that call).
        """
        params = {
            "latitude": round(latitude, 4),
            "longitude": round(longitude, 4),
            "start_date": start_date,
            "end_date": end_date,
            "hourly": "wind_speed_10m,wind_direction_10m",
            "wind_speed_unit": "ms",  # meters per second
            "timezone": "UTC",
        }
        
        # 1. Try Historical Archive API (ERA5 Reanalysis)
        data = self._make_request(HISTORICAL_WEATHER_URL, params)
        if data and "hourly" in data:
            return data

        # 2. Fallback to Forecast API — only meaningful for recent dates.
        try:
            end_dt = datetime.strptime(end_date, "%Y-%m-%d").replace(tzinfo=timezone.utc)
            days_ago = (datetime.now(timezone.utc) - end_dt).days
        except ValueError:
            days_ago = 0
        if days_ago > FORECAST_API_MAX_PAST_DAYS:
            logger.info(
                f"Skipping Open-Meteo forecast-API wind fallback: requested end_date "
                f"{end_date} is {days_ago} days in the past (forecast API window is "
                f"~{FORECAST_API_MAX_PAST_DAYS} days)."
            )
            return None

        data = self._make_request(FORECAST_WEATHER_URL, params)
        return data


def fetch_environmental_history(
    latitude: float,
    longitude: float,
    detection_time_utc: datetime,
    lookback_hours: int = 14 * 24,
) -> Dict[str, Any]:
    """
    Fetches hourly ocean current and wind data for the look-back time window.
    Strictly validates units and does NOT convert null/None into 0.0.
    
    Returns a dictionary containing:
        - available: bool (True if valid ocean current and wind were retrieved)
        - has_valid_currents: bool (True if valid non-null ocean currents exist)
        - validation_stats: detailed statistics on valid/missing counts and min/max/mean
        - detection_conditions: summary at detection time
        - time_series: list of aligned hourly entries
        - warnings: list of diagnostic messages
    """
    client = OpenMeteoClient()
    warnings = []
    
    if detection_time_utc.tzinfo is None:
        detection_time_utc = detection_time_utc.replace(tzinfo=timezone.utc)
    else:
        detection_time_utc = detection_time_utc.astimezone(timezone.utc)
        
    start_time_utc = detection_time_utc - timedelta(hours=lookback_hours)
    
    start_date_str = start_time_utc.strftime("%Y-%m-%d")
    end_date_str = detection_time_utc.strftime("%Y-%m-%d")
    
    # Query Open-Meteo APIs.
    # Ocean currents use a fallback: Open-Meteo's current model returns null
    # for every hour at land/coastal grid cells, which is the usual reason
    # "wind works but ocean current shows 0" — this searches nearby open-water
    # points instead of silently accepting an all-null response.
    marine_res, marine_lat_used, marine_lon_used, marine_offset_deg = (
        client.get_ocean_currents_nearest_valid(latitude, longitude, start_date_str, end_date_str)
    )
    wind_res = client.get_wind_data(latitude, longitude, start_date_str, end_date_str)
    
    if not marine_res:
        warnings.append("Ocean current data request failed (Open-Meteo Marine API unreachable).")
    elif marine_offset_deg is None:
        warnings.append(
            f"No ocean current data found within ~{1.5 * 111:.0f} km of "
            f"({latitude:.4f}, {longitude:.4f}) — this point and its surroundings "
            f"are likely outside the SMOC ocean-current model's open-water coverage."
        )
    elif marine_offset_deg > 0:
        warnings.append(
            f"Ocean current data was null at the exact spill coordinates (coastal/land "
            f"grid cell); used the nearest valid open-water point "
            f"({marine_lat_used:.4f}, {marine_lon_used:.4f}), ~{marine_offset_deg * 111:.0f} km away."
        )
    if not wind_res:
        warnings.append("Wind data request failed (Open-Meteo Weather API unreachable).")

    hourly_marine = (marine_res or {}).get("hourly", {})
    hourly_units_marine = (marine_res or {}).get("hourly_units", {})
    hourly_wind = (wind_res or {}).get("hourly", {})
    
    # Check unit of ocean_current_velocity from API response
    # Open-Meteo Marine API provides 'km/h' by default
    current_unit = hourly_units_marine.get("ocean_current_velocity", "km/h").lower()
    
    marine_times = hourly_marine.get("time", [])
    raw_current_vels = hourly_marine.get("ocean_current_velocity", [])
    raw_current_dirs = hourly_marine.get("ocean_current_direction", [])
    raw_wave_heights = hourly_marine.get("wave_height", [])
    
    wind_times = hourly_wind.get("time", [])
    raw_wind_spds = hourly_wind.get("wind_speed_10m", [])
    raw_wind_dirs = hourly_wind.get("wind_direction_10m", [])
    
    # Build fast lookup maps while preserving None
    marine_vel_map: Dict[str, Optional[float]] = {}
    marine_dir_map: Dict[str, Optional[float]] = {}
    marine_wave_map: Dict[str, Optional[float]] = {}
    
    zero_current_hours = 0
    for index, (t_str, raw_v, raw_d) in enumerate(zip(marine_times, raw_current_vels, raw_current_dirs)):
        raw_wave = raw_wave_heights[index] if index < len(raw_wave_heights) else None
        marine_wave_map[t_str] = float(raw_wave) if raw_wave is not None else None
        if raw_v is not None and float(raw_v) == 0.0:
            # Literal 0.0 means "not computed yet", not a real reading (see get_ocean_currents_nearest_valid docstring).
            raw_v = None
            zero_current_hours += 1
        if raw_v is not None:
            v_float = float(raw_v)
            if current_unit in ("km/h", "kmh"):
                v_ms = v_float / 3.6
            else:
                v_ms = v_float
            marine_vel_map[t_str] = v_ms
            marine_dir_map[t_str] = float(raw_d) if raw_d is not None else None
        else:
            marine_vel_map[t_str] = None
            marine_dir_map[t_str] = None
            
    if zero_current_hours > 0:
        warnings.append(
            f"{zero_current_hours} hour(s) of ocean current data came back as a literal "
            f"0.0 from Open-Meteo (the current model hadn't computed them yet — usually "
            f"the most recent hours nearest to detection time) and were treated as missing "
            f"instead of a real reading."
        )

    wind_spd_map: Dict[str, Optional[float]] = {}
    wind_dir_map: Dict[str, Optional[float]] = {}
    for t_str, raw_w_spd, raw_w_dir in zip(wind_times, raw_wind_spds, raw_wind_dirs):
        wind_spd_map[t_str] = float(raw_w_spd) if raw_w_spd is not None else None
        wind_dir_map[t_str] = float(raw_w_dir) if raw_w_dir is not None else None
        
    all_time_strs = sorted(list(set(marine_times + wind_times)))
    
    time_series: List[Dict[str, Any]] = []
    valid_current_values: List[float] = []
    missing_current_count = 0
    
    for t_str in all_time_strs:
        try:
            dt = datetime.fromisoformat(t_str).replace(tzinfo=timezone.utc)
        except Exception:
            continue
            
        if dt > detection_time_utc or dt < (start_time_utc - timedelta(hours=1)):
            continue
            
        c_vel = marine_vel_map.get(t_str)
        c_dir = marine_dir_map.get(t_str)
        wave_height = marine_wave_map.get(t_str)
        w_spd = wind_spd_map.get(t_str)
        w_dir = wind_dir_map.get(t_str)
        
        if c_vel is not None:
            valid_current_values.append(c_vel)
        else:
            missing_current_count += 1
            
        time_series.append({
            "timestamp": dt,
            "iso_time": dt.strftime("%Y-%m-%d %H:%M UTC"),
            "ocean_current_velocity_ms": c_vel,          # None if missing, float if valid
            "ocean_current_direction_deg": c_dir,        # None if missing, float if valid
            "sea_surface_wave_significant_height_m": wave_height,
            "wind_speed_ms": w_spd,                      # None if missing, float if valid
            "wind_direction_deg": w_dir,                 # None if missing, float if valid
        })
        
    time_series.sort(key=lambda x: x["timestamp"])
    
    total_obs = len(time_series)
    valid_current_count = len(valid_current_values)
    has_valid_currents = valid_current_count > 0 and (valid_current_count >= total_obs * 0.5)
    valid_wind_count = sum(1 for pt in time_series if pt["wind_speed_ms"] is not None)
    has_valid_wind = valid_wind_count > 0 and (valid_wind_count >= total_obs * 0.5)
    
    insitu_fallback_meta = None
    if not has_valid_currents:
        try:
            from insitu_currents import apply_insitu_currents_fallback
            time_series, insitu_fallback_meta = apply_insitu_currents_fallback(
                time_series=time_series,
                target_lat=latitude,
                target_lon=longitude,
                start_time_utc=start_time_utc,
                detection_time_utc=detection_time_utc,
            )
            if insitu_fallback_meta.get("used"):
                valid_current_values = [
                    pt["ocean_current_velocity_ms"]
                    for pt in time_series
                    if pt.get("ocean_current_velocity_ms") is not None
                ]
                valid_current_count = len(valid_current_values)
                missing_current_count = total_obs - valid_current_count
                has_valid_currents = valid_current_count > 0 and (valid_current_count >= total_obs * 0.5)
                warnings.append(
                    f"Applied in-situ Copernicus ocean current observations from data/ CSV "
                    f"(Product INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048, Platform {insitu_fallback_meta.get('nearest_platform_id')}, "
                    f"~{insitu_fallback_meta.get('nearest_distance_km')} km away) as ocean current fallback."
                )
        except Exception as insitu_err:
            logger.warning(f"[Environment] In-situ current fallback query failed: {insitu_err}")

    if not has_valid_currents:
        if detection_time_utc.year < 2022:
            warnings.append(
                f"Historical ocean currents from Open-Meteo (MeteoFrance SMOC model) are available from Jan 2022 onwards. "
                f"Requested detection date ({detection_time_utc.strftime('%Y-%m-%d')}) precedes available coverage."
            )
        else:
            warnings.append(
                f"Open-Meteo returned {missing_current_count}/{total_obs} missing current observations for coordinates "
                f"({latitude:.4f}°N, {longitude:.4f}°E)."
            )

    if not has_valid_wind:
        warnings.append(
            f"Open-Meteo returned {total_obs - valid_wind_count}/{total_obs} missing wind observations for coordinates "
            f"({latitude:.4f}°N, {longitude:.4f}°E)."
        )
            
    validation_stats = {
        "latitude": latitude,
        "longitude": longitude,
        "period_start_utc": start_time_utc.strftime("%Y-%m-%d %H:%M UTC"),
        "period_end_utc": detection_time_utc.strftime("%Y-%m-%d %H:%M UTC"),
        "total_observations": total_obs,
        "valid_current_count": valid_current_count,
        "missing_current_count": missing_current_count,
        "min_current_speed_ms": min(valid_current_values) if valid_current_values else None,
        "max_current_speed_ms": max(valid_current_values) if valid_current_values else None,
        "mean_current_speed_ms": (sum(valid_current_values) / valid_current_count) if valid_current_values else None,
    }
    
    detection_conditions = {}
    if time_series:
        latest = time_series[-1]
        # The ocean-current model lags "now" more than the wind model does, so
        # the very latest hour is often exactly the one that came back
        # 0.0/missing above. Report the most recent hour that actually has a
        # valid current reading for the headline conditions, rather than
        # blanking out a perfectly good recent reading just because an even
        # newer (not-yet-computed) hour has none.
        current_source = latest
        if latest["ocean_current_velocity_ms"] is None:
            for entry in reversed(time_series):
                if entry["ocean_current_velocity_ms"] is not None:
                    current_source = entry
                    break
        c_v = current_source["ocean_current_velocity_ms"]
        c_d = current_source["ocean_current_direction_deg"]
        w_s = latest["wind_speed_ms"]
        w_d = latest["wind_direction_deg"]
        
        detection_conditions = {
            "timestamp_str": latest["iso_time"],
            "current_velocity_ms": round(c_v, 3) if c_v is not None else None,
            "current_direction_deg": round(c_d, 1) if c_d is not None else None,
            "current_timestamp_str": current_source["iso_time"] if current_source is not latest else latest["iso_time"],
            "wind_speed_ms": round(w_s, 2) if w_s is not None else None,
            "wind_speed_kmh": round(w_s * 3.6, 2) if w_s is not None else None,
            "wind_direction_deg": round(w_d, 1) if w_d is not None else None,
            "source": (
                "Open-Meteo Weather (ERA5) & Copernicus In-Situ Marine Currents (CSV)"
                if (insitu_fallback_meta and insitu_fallback_meta.get("used"))
                else "Open-Meteo Marine (SMOC) & Weather (ERA5)"
            ),
        }
        
    return {
        "available": has_valid_currents or has_valid_wind,
        "has_valid_currents": has_valid_currents,
        "has_valid_wind": has_valid_wind,
        "latitude": latitude,
        "longitude": longitude,
        "detection_time_utc": detection_time_utc,
        "lookback_hours": lookback_hours,
        "validation_stats": validation_stats,
        "detection_conditions": detection_conditions,
        "time_series": time_series,
        "warnings": warnings,
        "insitu_current_fallback": insitu_fallback_meta,
    }