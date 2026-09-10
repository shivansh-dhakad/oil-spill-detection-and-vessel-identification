"""
drift.py - Backward numerical drift simulation (hindcasting), trajectory modeling,
start-time & origin estimation, CSV logging, and visual map plotting.
"""

import os
import csv
import math
import logging
from datetime import datetime, timedelta, timezone
from typing import List, Dict, Any, Tuple, Optional
import numpy as np

logger = logging.getLogger(__name__)

try:
    import matplotlib
    matplotlib.use("Agg")  # Non-interactive backend for headless CLI environments
    import matplotlib.pyplot as plt
    HAS_MATPLOTLIB = True
except ImportError:
    HAS_MATPLOTLIB = False

EARTH_RADIUS_METERS = 6371000.0
DEFAULT_WINDAGE_FACTOR = 0.03  # Standard empirical windage factor (3% of 10m wind)
DEFAULT_LOOKBACK_HOURS = 5 * 24  # Standard 5-day backward hindcast (realistic oil persistence window)
DEFAULT_TIME_STEP_HOURS = 1.0
# Movement below this for several consecutive steps means the particle is coast-locked.
STRANDING_STEP_KM = 0.05
STRANDING_STREAK_HOURS = 6.0


def _as_utc_datetime(value: Any) -> datetime:
    """Convert OpenDrift/Python/NumPy time values to one UTC datetime."""
    if isinstance(value, np.ndarray):
        if value.size == 0:
            raise ValueError("OpenDrift supplied an empty time array.")
        value = value.reshape(-1)[0]
    if hasattr(value, "to_pydatetime"):
        value = value.to_pydatetime()
    if isinstance(value, np.datetime64):
        value = value.astype("datetime64[us]").astype(datetime)
    if not isinstance(value, datetime):
        raise TypeError(f"Unsupported environmental time value: {type(value).__name__}")
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value.astimezone(timezone.utc)


def _as_utc_naive(value: Any) -> datetime:
    """Same conversion as _as_utc_datetime(), but strips tzinfo afterward."""
    return _as_utc_datetime(value).replace(tzinfo=None)


class LandmaskUnavailableError(RuntimeError):
    """Raised when the GSHHS coastline reader can't be loaded."""


_landmask_reader = None
_landmask_load_failed = False


def _get_landmask_reader():
    """Lazy-load OpenDrift's GSHHS landmask (used to keep origins in the ocean)."""
    global _landmask_reader, _landmask_load_failed
    if _landmask_reader is not None:
        return _landmask_reader
    if _landmask_load_failed:
        raise LandmaskUnavailableError("GSHHS landmask reader previously failed to load.")
    try:
        from opendrift.readers import reader_global_landmask
        _landmask_reader = reader_global_landmask.Reader()
        return _landmask_reader
    except Exception as exc:
        _landmask_load_failed = True
        logger.warning(
            "GSHHS landmask reader could not be loaded (%s) - land/water checks "
            "are unavailable, so spill/drift seed coordinates will NOT be "
            "verified or corrected to open water.",
            exc,
        )
        raise LandmaskUnavailableError(str(exc)) from exc


def point_is_on_land(lat: float, lon: float) -> bool:
    """Return True when the GSHHS landmask classifies the point as land."""
    reader = _get_landmask_reader()
    return bool(reader._on_land(np.array([float(lon)]), np.array([float(lat)]))[0])


def points_are_on_land(lats: Any, lons: Any) -> np.ndarray:
    """Vectorized bulk test returning boolean numpy array where True = land."""
    reader = _get_landmask_reader()
    arr_lons = np.asarray(lons, dtype=float)
    arr_lats = np.asarray(lats, dtype=float)
    return reader._on_land(arr_lons, arr_lats)


def is_landmask_available() -> bool:
    """Cheap check callers can use to decide whether landmask is accessible."""
    try:
        _get_landmask_reader()
        return True
    except LandmaskUnavailableError:
        return False


def displace_coordinates_vectorized(
    lat: float, lon: float, delta_east_m: np.ndarray, delta_north_m: np.ndarray
) -> Tuple[np.ndarray, np.ndarray]:
    """Vectorized displacement of a base coordinate by east/north meter offsets."""
    d_lat = (delta_north_m / EARTH_RADIUS_METERS) * (180.0 / math.pi)
    cos_lat = max(0.01, math.cos(math.radians(lat)))
    d_lon = (delta_east_m / (EARTH_RADIUS_METERS * cos_lat)) * (180.0 / math.pi)
    return lat + d_lat, lon + d_lon


def nearest_ocean_point(
    lat: float,
    lon: float,
    search_radius_km: float = 80.0,
    step_km: float = 2.0,
) -> Tuple[float, float, float]:
    """
    Snap a coordinate to the nearest ocean cell within search_radius_km.
    Uses fast vectorized batch ring evaluation (<50ms).
    """
    if not point_is_on_land(lat, lon):
        return float(lat), float(lon), 0.0

    reader = _get_landmask_reader()
    max_steps = max(1, int(search_radius_km / step_km))

    # Evaluate concentric rings in fast vectorized batches
    for ring in range(1, max_steps + 1):
        radius_km = ring * step_km
        n_angles = max(12, int(2 * math.pi * radius_km / step_km))
        angles = np.linspace(0, 2 * math.pi, n_angles, endpoint=False)
        d_north = radius_km * 1000.0 * np.cos(angles)
        d_east = radius_km * 1000.0 * np.sin(angles)

        cand_lats, cand_lons = displace_coordinates_vectorized(lat, lon, d_east, d_north)
        on_land = reader._on_land(cand_lons, cand_lats)
        water_indices = np.where(~on_land)[0]

        if len(water_indices) > 0:
            best_idx = water_indices[0]
            cand_lat = float(cand_lats[best_idx])
            cand_lon = float(cand_lons[best_idx])
            dist = haversine_distance_km(lat, lon, cand_lat, cand_lon)
            return cand_lat, cand_lon, dist

    raise RuntimeError(
        f"No ocean water found within {search_radius_km:.0f} km of "
        f"({lat:.4f}, {lon:.4f}). Check spill geolocation — seed is on land."
    )


def ensure_ocean_seed(lat: float, lon: float) -> Dict[str, Any]:
    """Snap a spill seed to water when the detected centroid falls on land."""
    try:
        ocean_lat, ocean_lon, snap_km = nearest_ocean_point(lat, lon)
        return {
            "latitude": ocean_lat,
            "longitude": ocean_lon,
            "was_on_land": snap_km > 0.0,
            "snap_distance_km": round(snap_km, 2),
            "original_latitude": float(lat),
            "original_longitude": float(lon),
            "method": "centroid_radial_snap",
            "landmask_available": True,
        }
    except LandmaskUnavailableError:
        return {
            "latitude": float(lat),
            "longitude": float(lon),
            "was_on_land": None,
            "snap_distance_km": 0.0,
            "original_latitude": float(lat),
            "original_longitude": float(lon),
            "method": "landmask_unavailable_unverified",
            "landmask_available": False,
        }


def resolve_ocean_seed_from_polygon(
    polygon_patches: List[List[Tuple[float, float]]],
    centroid_lat: float,
    centroid_lon: float,
) -> Dict[str, Any]:
    """
    Pick a drift/AIS-search seed from the spill's own georeferenced polygon
    boundary using fast vectorized landmask checks.
    """
    all_points: List[Tuple[float, float]] = [pt for patch in polygon_patches for pt in patch]

    if not all_points:
        ocean_lat, ocean_lon, snap_km = nearest_ocean_point(centroid_lat, centroid_lon)
        return {
            "latitude": ocean_lat,
            "longitude": ocean_lon,
            "was_on_land": snap_km > 0.0,
            "snap_distance_km": round(snap_km, 2),
            "original_latitude": float(centroid_lat),
            "original_longitude": float(centroid_lon),
            "method": "no_polygon_centroid_radial_fallback",
            "shoreline_vertices_used": 0,
            "total_vertices": 0,
        }

    try:
        p_lats = np.array([p[0] for p in all_points], dtype=float)
        p_lons = np.array([p[1] for p in all_points], dtype=float)
        reader = _get_landmask_reader()
        on_land = reader._on_land(p_lons, p_lats)
        water_points = [p for p, is_land in zip(all_points, on_land) if not is_land]
    except Exception:
        water_points = all_points

    if len(water_points) == len(all_points):
        return {
            "latitude": float(centroid_lat),
            "longitude": float(centroid_lon),
            "was_on_land": False,
            "snap_distance_km": 0.0,
            "original_latitude": float(centroid_lat),
            "original_longitude": float(centroid_lon),
            "method": "polygon_fully_offshore",
            "shoreline_vertices_used": len(water_points),
            "total_vertices": len(all_points),
        }

    if water_points:
        seed_lat = sum(p[0] for p in water_points) / len(water_points)
        seed_lon = sum(p[1] for p in water_points) / len(water_points)
        snap_km = haversine_distance_km(centroid_lat, centroid_lon, seed_lat, seed_lon)
        return {
            "latitude": seed_lat,
            "longitude": seed_lon,
            "was_on_land": True,
            "snap_distance_km": round(snap_km, 2),
            "original_latitude": float(centroid_lat),
            "original_longitude": float(centroid_lon),
            "method": "shoreline_offshore_boundary_points",
            "shoreline_vertices_used": len(water_points),
            "total_vertices": len(all_points),
        }

    ocean_lat, ocean_lon, snap_km = nearest_ocean_point(centroid_lat, centroid_lon)
    return {
        "latitude": ocean_lat,
        "longitude": ocean_lon,
        "was_on_land": True,
        "snap_distance_km": round(snap_km, 2),
        "original_latitude": float(centroid_lat),
        "original_longitude": float(centroid_lon),
        "method": "no_water_on_polygon_radial_fallback",
        "shoreline_vertices_used": 0,
        "total_vertices": len(all_points),
    }
    


def degrees_to_components(speed: float, direction_deg: float, is_wind: bool = False) -> Tuple[float, float]:
    """
    Converts speed and direction into Eastward (u) and Northward (v) velocity components (m/s).
    
    Args:
        speed: Velocity magnitude in m/s.
        direction_deg: Direction in degrees [0, 360).
        is_wind: If True, direction is meteorological 'direction FROM which wind blows'.
                 If False, direction is oceanographic 'direction TOWARDS which current flows'.
    """
    if is_wind:
        # Wind blows towards (dir + 180) degrees
        angle_rad = math.radians((direction_deg + 180.0) % 360.0)
    else:
        angle_rad = math.radians(direction_deg % 360.0)
        
    u = speed * math.sin(angle_rad)  # Eastward
    v = speed * math.cos(angle_rad)  # Northward
    return u, v


def haversine_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Computes Great-Circle distance between two points in kilometers.
    """
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    
    a = math.sin(dphi / 2.0) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2.0) ** 2
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return (EARTH_RADIUS_METERS * c) / 1000.0


def _opendrift_result_to_trajectory(model: Any, detection_time_utc: datetime, windage_factor: float, engine: str) -> List[Dict[str, Any]]:
    """Extract the single-particle backward trajectory from an OpenDrift result."""
    if not hasattr(model, "result") or model.result is None:
        raise RuntimeError("OpenDrift produced no result array.")
    try:
        output_times = list(np.asarray(model.result.time.values).reshape(-1))
        output_lons, output_lats = np.asarray(model.result.lon.values), np.asarray(model.result.lat.values)
    except Exception as exc:
        raise RuntimeError(f"OpenDrift result could not be read: {exc}") from exc
    if output_lons.ndim == 2:
        if output_lons.shape[0] == len(output_times):
            output_lons, output_lats = output_lons[:, 0], output_lats[:, 0]
        else:
            output_lons, output_lats = output_lons[0, :], output_lats[0, :]
    trajectory: List[Dict[str, Any]] = []
    prior_lat, prior_lon, cumulative = None, None, 0.0
    for step, (ts, lat, lon) in enumerate(zip(output_times, output_lats, output_lons)):
        if not np.isfinite(lat) or not np.isfinite(lon):
            continue
        ts = _as_utc_datetime(ts)
        if prior_lat is not None:
            cumulative += haversine_distance_km(prior_lat, prior_lon, float(lat), float(lon))
        prior_lat, prior_lon = float(lat), float(lon)
        trajectory.append({
            "step": step,
            "hours_before_detection": round(abs((detection_time_utc - ts).total_seconds()) / 3600.0, 2),
            "timestamp": ts,
            "iso_time": ts.strftime("%Y-%m-%d %H:%M UTC"),
            "latitude": float(lat), "longitude": float(lon),
            "windage_factor": windage_factor,
            "cumulative_distance_km": round(cumulative, 2),
            "simulation_engine": engine,
        })
    if not trajectory:
        raise RuntimeError("OpenDrift returned no valid ocean trajectory points.")
    return trajectory


def run_backward_hindcast(
    spill_lat: float,
    spill_lon: float,
    detection_time_utc: datetime,
    env_time_series: List[Dict[str, Any]],
    windage_factor: float = DEFAULT_WINDAGE_FACTOR,
    lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
    time_step_hours: float = DEFAULT_TIME_STEP_HOURS,
) -> List[Dict[str, Any]]:
    """Run a 20-day OpenDrift oil-particle hindcast using Open-Meteo data."""
    try:
        from opendrift.models.oceandrift import OceanDrift
        from opendrift.readers.basereader.continuous import ContinuousReader
        import pyproj
    except ImportError as exc:
        raise RuntimeError("OpenDrift and its hydrodynamics dependencies are required.") from exc

    class OpenMeteoReader(ContinuousReader):
        def __init__(self, records: List[Dict[str, Any]]):
            self.name = "Open-Meteo Marine and Weather"
            self.proj4 = "+proj=lonlat +datum=WGS84"
            self.crs = pyproj.CRS(self.proj4)
            self.variables = [
                "x_sea_water_velocity", "y_sea_water_velocity",
                "x_wind", "y_wind",
                "sea_surface_wave_significant_height",
            ]
            self.xmin, self.xmax = -180.0, 180.0
            self.ymin, self.ymax = -90.0, 90.0
            self.delta_x = self.delta_y = 1.0
            # NOTE: these are timezone-naive (UTC) on purpose — see _as_utc_naive().
            self.times = sorted({
                _as_utc_naive(record["timestamp"])
                for record in records
                if isinstance(record.get("timestamp"), datetime)
            })
            if not self.times:
                raise RuntimeError("Open-Meteo returned no usable environmental timestamps.")
            self.start_time = self.times[0]
            self.end_time = self.times[-1]
            self.time_step = timedelta(hours=1)
            self._records = {
                _as_utc_naive(record["timestamp"]): record
                for record in records
                if isinstance(record.get("timestamp"), datetime)
            }
            super().__init__()
            self.start_time = self.times[0]
            self.end_time = self.times[-1]

        def get_variables(self, variables, time=None, x=None, y=None, z=None):
            requested_time = _as_utc_naive(time)
            nearest = min(self.times, key=lambda ts: abs((ts - requested_time).total_seconds()))
            record = self._records[nearest]
            current_speed = record.get("ocean_current_velocity_ms") or 0.0
            current_direction = record.get("ocean_current_direction_deg") or 0.0
            wind_speed = record.get("wind_speed_ms") or 0.0
            wind_direction = record.get("wind_direction_deg") or 0.0
            wave_height = record.get("sea_surface_wave_significant_height_m")
            wave_height = float(wave_height) if wave_height is not None else 0.0
            current_u, current_v = degrees_to_components(current_speed, current_direction)
            wind_u, wind_v = degrees_to_components(wind_speed, wind_direction, is_wind=True)
            count = len(np.atleast_1d(x))
            values = {
                "x_sea_water_velocity": np.full(count, current_u, dtype=float),
                "y_sea_water_velocity": np.full(count, current_v, dtype=float),
                "x_wind": np.full(count, wind_u, dtype=float),
                "y_wind": np.full(count, wind_v, dtype=float),
                "sea_surface_wave_significant_height": np.full(count, wave_height, dtype=float),
            }
            return {variable: values[variable] for variable in variables}

    detection_time_utc = _as_utc_datetime(detection_time_utc)
    records = list(env_time_series)
    if not records:
        raise RuntimeError("Open-Meteo returned no environmental records for the simulation.")
    record_times = [_as_utc_datetime(record["timestamp"]) for record in records]
    nearest_index = min(
        range(len(records)),
        key=lambda index: abs((record_times[index] - detection_time_utc).total_seconds()),
    )
    if detection_time_utc not in record_times:
        detection_record = dict(records[nearest_index])
        detection_record["timestamp"] = detection_time_utc
        records.append(detection_record)

    reader = OpenMeteoReader(records)
    model = OceanDrift(loglevel=20)
    model.add_reader(reader)
    model.set_config("general:coastline_action", "previous")
    model.set_config("drift:vertical_mixing", False)
    # OpenDrift build (1.14.11) uses "seed:wind_drift_factor", not "drift:wind_drift_factor".
    model.set_config("seed:wind_drift_factor", windage_factor)
    model.seed_elements(
        lon=spill_lon, lat=spill_lat, z=0, radius=0, number=1,
        time=_as_utc_naive(detection_time_utc),
    )
    try:
        model.run(
            duration=-timedelta(hours=lookback_hours),
            time_step=-timedelta(hours=time_step_hours),
            time_step_output=-timedelta(hours=time_step_hours),
            stop_on_error=False,
        )
    except ValueError:
        if not hasattr(model, "result") or model.result is None:
            raise
    except Exception as exc:
        raise RuntimeError(f"OpenDrift hydrodynamic simulation failed: {exc}") from exc
    has_insitu = any(r.get("ocean_current_source") == "In-Situ Copernicus CSV" for r in records)
    engine_name = (
        "OpenDrift Hydrodynamics + Copernicus In-Situ Marine Currents (CSV) + Wind"
        if has_insitu
        else "OpenDrift Hydrodynamics + Open-Meteo currents/wind"
    )
    trajectory = _opendrift_result_to_trajectory(
        model, detection_time_utc, windage_factor,
        engine_name,
    )
    trajectory[-1]["final_particle_location"] = {
        "latitude": trajectory[-1]["latitude"],
        "longitude": trajectory[-1]["longitude"],
        "timestamp": trajectory[-1]["iso_time"],
    }
    return trajectory


def _water_points(trajectory: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Keep only trajectory samples that the landmask classifies as ocean using fast vectorized lookup."""
    if not trajectory:
        return []
    try:
        lats = np.array([pt["latitude"] for pt in trajectory], dtype=float)
        lons = np.array([pt["longitude"] for pt in trajectory], dtype=float)
        on_land = points_are_on_land(lats, lons)
        return [pt for pt, is_land in zip(trajectory, on_land) if not is_land]
    except Exception:
        return trajectory


def _select_origin_point(
    trajectory: List[Dict[str, Any]],
    nominal_release_hours_ago: Optional[float],
) -> Tuple[Dict[str, Any], str]:
    """
    Choose a release origin on water.

    Priority:
      1. Explicit release-age target (if provided), snapped to nearest water sample.
      2. First coast-lock / stranding water position when the particle stops moving.
      3. Furthest-back water sample at the multi-day lookback horizon.
    """
    water = _water_points(trajectory)
    if not water:
        # Last resort: snap the farthest trajectory point offshore.
        far = trajectory[-1]
        o_lat, o_lon, _ = nearest_ocean_point(far["latitude"], far["longitude"])
        snapped = dict(far)
        snapped["latitude"] = o_lat
        snapped["longitude"] = o_lon
        return snapped, "lookback_horizon_snapped_offshore"

    def find_closest(points, h_target):
        return min(points, key=lambda pt: abs(pt["hours_before_detection"] - h_target))

    if nominal_release_hours_ago is not None:
        target = min(float(nominal_release_hours_ago), water[-1]["hours_before_detection"])
        return find_closest(water, target), "release_age_provided"

    # Detect coast-lock: several consecutive near-zero steps while time advances.
    streak_hours = 0.0
    stranding_pt = None
    for i in range(1, len(trajectory)):
        prev, curr = trajectory[i - 1], trajectory[i]
        step_km = haversine_distance_km(
            prev["latitude"], prev["longitude"], curr["latitude"], curr["longitude"]
        )
        dt_h = abs(curr["hours_before_detection"] - prev["hours_before_detection"])
        if step_km < STRANDING_STEP_KM:
            streak_hours += dt_h
            if streak_hours >= STRANDING_STREAK_HOURS and not point_is_on_land(
                prev["latitude"], prev["longitude"]
            ):
                stranding_pt = prev
                break
        else:
            streak_hours = 0.0

    if stranding_pt is not None:
        # Prefer the matching water sample closest in time.
        return find_closest(water, stranding_pt["hours_before_detection"]), "coastal_stranding"

    return water[-1], "lookback_horizon"


def estimate_spill_origin_and_start(
    trajectory: List[Dict[str, Any]],
    detection_time_utc: datetime,
    nominal_release_hours_ago: Optional[float] = None,
    uncertainty_hours: float = 12.0,
) -> Dict[str, Any]:
    """
    Estimates the probable release origin and start time window along the backward trajectory.

    Always returns an ocean origin when the trajectory contains water samples.
    Multi-day lookbacks are supported; land positions are rejected.
    """
    if not trajectory:
        return {}

    max_step_hours = trajectory[-1]["hours_before_detection"]
    try:
        nominal_pt, selection_method = _select_origin_point(trajectory, nominal_release_hours_ago)
    except Exception as exc:
        return {
            "status": "UNAVAILABLE",
            "lookback_period_hours": max_step_hours,
            "simulation_engine": trajectory[0].get("simulation_engine", "OpenDrift"),
            "reason": f"Could not select an ocean origin: {exc}",
        }

    # Final land guard — never report an inland origin.
    if point_is_on_land(nominal_pt["latitude"], nominal_pt["longitude"]):
        try:
            o_lat, o_lon, snap_km = nearest_ocean_point(
                nominal_pt["latitude"], nominal_pt["longitude"]
            )
            nominal_pt = dict(nominal_pt)
            nominal_pt["latitude"] = o_lat
            nominal_pt["longitude"] = o_lon
            selection_method = f"{selection_method}_snapped_{snap_km:.1f}km"
        except Exception as exc:
            return {
                "status": "UNAVAILABLE",
                "lookback_period_hours": max_step_hours,
                "reason": f"Origin resolved on land and could not be snapped offshore: {exc}",
            }

    target_hours = float(nominal_pt["hours_before_detection"])
    unc = max(12.0, min(float(uncertainty_hours), max(24.0, target_hours * 0.25)))
    earliest_hours = min(target_hours + unc, max_step_hours)
    latest_hours = max(0.0, target_hours - unc)

    def find_closest(h_target):
        return min(trajectory, key=lambda pt: abs(pt["hours_before_detection"] - h_target))

    earliest_pt = find_closest(earliest_hours)
    latest_pt = find_closest(latest_hours)
    est_start_time = nominal_pt["timestamp"]

    return {
        "status": "ESTIMATED",
        "estimated_start_utc": est_start_time,
        "estimated_start_str": est_start_time.strftime("%Y-%m-%d %H:%M UTC"),
        "earliest_plausible_utc": earliest_pt["timestamp"],
        "earliest_plausible_str": earliest_pt["timestamp"].strftime("%Y-%m-%d %H:%M UTC"),
        "latest_plausible_utc": latest_pt["timestamp"],
        "latest_plausible_str": latest_pt["timestamp"].strftime("%Y-%m-%d %H:%M UTC"),
        "estimated_duration_hours": round(target_hours, 1),
        "uncertainty_window_hours": round(unc * 2, 1),
        "origin_latitude": round(float(nominal_pt["latitude"]), 4),
        "origin_longitude": round(float(nominal_pt["longitude"]), 4),
        "origin_distance_km": nominal_pt.get("cumulative_distance_km", 0.0),
        "origin_on_land": False,
        "origin_selection_method": selection_method,
        "lookback_period_hours": max_step_hours,
        "simulation_engine": trajectory[0].get("simulation_engine", "Open-Meteo current/wind backtracking"),
        "disclaimer": (
            "ESTIMATED: Origin is the modelled ocean position along an Open-Meteo "
            "backward trajectory (multi-day lookback). It is not a surveyed release site."
        ),
    }


def save_trajectory_csv(trajectory: List[Dict[str, Any]], output_filepath: str) -> str:
    """
    Writes the full backward trajectory to a comprehensive CSV file matching requirements.
    """
    os.makedirs(os.path.dirname(output_filepath), exist_ok=True)
    
    headers = [
        "timestamp",
        "hours_before_detection",
        "latitude",
        "longitude",
        "ocean_current_speed_ms",
        "ocean_current_direction_deg",
        "ocean_current_east_ms",
        "ocean_current_north_ms",
        "wind_speed_ms",
        "wind_direction_deg",
        "wind_east_ms",
        "wind_north_ms",
        "windage_factor",
        "combined_east_ms",
        "combined_north_ms",
        "combined_speed_ms",
        "combined_direction_deg",
        "cumulative_distance_km",
    ]
    
    with open(output_filepath, mode="w", newline="", encoding="utf-8") as f:
        writer = csv.writer(f)
        writer.writerow(headers)
        for pt in trajectory:
            def _cell(key: str):
                val = pt.get(key)
                return val if val is not None else "N/A"
            writer.writerow([
                pt.get("iso_time", ""),
                pt.get("hours_before_detection", ""),
                f"{pt['latitude']:.6f}",
                f"{pt['longitude']:.6f}",
                _cell("ocean_current_speed_ms"),
                _cell("ocean_current_direction_deg"),
                _cell("ocean_current_east_ms"),
                _cell("ocean_current_north_ms"),
                _cell("wind_speed_ms"),
                _cell("wind_direction_deg"),
                _cell("wind_east_ms"),
                _cell("wind_north_ms"),
                pt.get("windage_factor", DEFAULT_WINDAGE_FACTOR),
                _cell("combined_east_ms"),
                _cell("combined_north_ms"),
                _cell("combined_speed_ms"),
                _cell("combined_direction_deg"),
                pt.get("cumulative_distance_km", 0.0),
            ])
            
    return output_filepath


def plot_trajectory_map(
    trajectory: List[Dict[str, Any]],
    origin_estimate: Dict[str, Any],
    output_filepath: str,
) -> Optional[str]:
    """
    Generates a clear trajectory map visualization showing:
      - Detection point (Red dot)
      - Backward drift path with direction vectors
      - Estimated origin (Gold star)
      - Plausible release window corridor
    """
    if not HAS_MATPLOTLIB or not trajectory:
        return None
        
    os.makedirs(os.path.dirname(output_filepath), exist_ok=True)
    
    lats = [pt["latitude"] for pt in trajectory]
    lons = [pt["longitude"] for pt in trajectory]
    
    fig, ax = plt.subplots(figsize=(10, 8), dpi=150)
    fig.patch.set_facecolor("#121820")
    ax.set_facecolor("#1a222d")
    
    # Grid styling
    ax.grid(True, linestyle="--", alpha=0.35, color="#60728a")
    
    # Plot trajectory path
    ax.plot(lons, lats, color="#00e5ff", linewidth=2.5, linestyle="-", label="Backward Drift Path", zorder=2)
    
    # Add direction markers along the path
    step_skip = max(1, len(trajectory) // 8)
    for i in range(0, len(trajectory) - 1, step_skip):
        ax.annotate(
            "",
            xy=(lons[i+1], lats[i+1]),
            xytext=(lons[i], lats[i]),
            arrowprops=dict(arrowstyle="->", color="#00e5ff", lw=1.5, mutation_scale=12),
            zorder=3
        )
        
    # Detection location (t=0)
    det_pt = trajectory[0]
    ax.scatter(
        [det_pt["longitude"]], [det_pt["latitude"]],
        color="#ff3344", s=180, edgecolors="white", linewidth=2,
        label=f"Detection ({det_pt['latitude']:.4f}°N, {det_pt['longitude']:.4f}°E)",
        zorder=5
    )
    
    has_selected_origin = origin_estimate.get("status") == "ESTIMATED"
    orig_lat = origin_estimate.get("origin_latitude", lats[-1])
    orig_lon = origin_estimate.get("origin_longitude", lons[-1])
    orig_time_str = origin_estimate.get("estimated_start_str", "No release time selected")
    if has_selected_origin:
        ax.scatter(
            [orig_lon], [orig_lat], color="#ffd700", marker="*", s=300,
            edgecolors="#121820", linewidth=1.5,
            label=f"Modelled origin ({orig_lat:.4f}°N, {orig_lon:.4f}°E)", zorder=6,
        )
    else:
        ax.scatter(
            [orig_lon], [orig_lat], color="#94a3b8", marker="o", s=100,
            edgecolors="white", linewidth=1.2,
            label="Look-back horizon (not a claimed origin)", zorder=6,
        )
    
    # Annotations
    ax.text(
        det_pt["longitude"], det_pt["latitude"],
        f"  Detection\n  {det_pt['iso_time']}",
        color="#ffffff", fontsize=9, fontweight="bold", va="bottom", zorder=7
    )
    
    end_label = (
        f"  Modelled origin (~{origin_estimate.get('estimated_duration_hours', 0)}h prior)\n  {orig_time_str}"
        if has_selected_origin else
        "  Look-back horizon\n  Release age required to select an origin"
    )
    ax.text(orig_lon, orig_lat, end_label, color="#ffd700" if has_selected_origin else "#cbd5e1",
            fontsize=9, fontweight="bold", va="top", zorder=7)
    
    # Labels & Title
    engine = trajectory[0].get("simulation_engine", "OpenDrift") if trajectory else "OpenDrift"
    ax.set_title(f"Oil Spill Backward Drift Hindcast\n({engine})", color="#ffffff", fontsize=13, fontweight="bold", pad=15)
    ax.set_xlabel("Longitude (°E)", color="#cfd8dc", fontsize=11, labelpad=8)
    ax.set_ylabel("Latitude (°N)", color="#cfd8dc", fontsize=11, labelpad=8)
    ax.tick_params(colors="#cfd8dc", labelsize=9)
    
    # Information Box
    info_text = (
        f"Hindcast Period: {origin_estimate.get('lookback_period_hours', DEFAULT_LOOKBACK_HOURS):.0f} hours "
        f"({origin_estimate.get('lookback_period_hours', DEFAULT_LOOKBACK_HOURS) / 24.0:.1f} days)\n"
        f"Release: {origin_estimate.get('estimated_start_str', 'not selected')}\n"
        f"Origin method: {origin_estimate.get('origin_selection_method', 'n/a')}\n"
        f"Status: {origin_estimate.get('status', 'UNKNOWN')}\n"
        f"Est. Drift Distance: {origin_estimate.get('origin_distance_km', 0.0):.1f} km\n"
        f"Model: Open-Meteo currents/wind ({DEFAULT_WINDAGE_FACTOR*100:.1f}% windage)"
    )
    props = dict(boxstyle="round,pad=0.6", facecolor="#1e293b", alpha=0.9, edgecolor="#38bdf8")
    ax.text(0.02, 0.03, info_text, transform=ax.transAxes, fontsize=8.5, color="#f1f5f9", verticalalignment="bottom", bbox=props, zorder=8)
    
    legend = ax.legend(loc="upper right", facecolor="#1e293b", edgecolor="#38bdf8", labelcolor="#f1f5f9", fontsize=9)
    legend.get_frame().set_alpha(0.85)
    
    plt.tight_layout()
    plt.savefig(output_filepath, facecolor=fig.get_facecolor(), edgecolor="none", dpi=150)
    plt.close(fig)
    
    return output_filepath