"""
app.py - Main interactive CLI application for Oil Spill ML inference,
Open-Meteo environmental retrieval, and backward drift start-time estimation.
"""

import argparse
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional, Tuple, Dict, Any

# Ensure the local package modules can be imported
CURRENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CURRENT_DIR))

try:
    from dotenv import load_dotenv
    load_dotenv(CURRENT_DIR / ".env")
    load_dotenv(CURRENT_DIR.parent / ".env")
except ImportError:
    pass

import torch
from model import load_model, predict, interpret_output
from preprocessing import (
    load_and_validate_image,
    preprocess_image,
    SAR_RESIZE_INTERPOLATION,
    DEFAULT_RESIZE_INTERPOLATION,
    generate_mask_and_overlay,
)
from safe_processor import (
    is_safe_input,
    process_safe_archive,
    extract_spill_centroid_geo,
    extract_spill_polygon_points_geo,
    compute_spill_geometry,
)
from environment import fetch_environmental_history
from drift import (
    run_backward_hindcast,
    estimate_spill_origin_and_start,
    save_trajectory_csv,
    plot_trajectory_map,
    ensure_ocean_seed,
    resolve_ocean_seed_from_polygon,
    DEFAULT_LOOKBACK_HOURS,
    DEFAULT_WINDAGE_FACTOR,
)
from ais_attribution import (
    run_attribution,
    print_attribution_result,
)

# Default model path candidates
# unetpp_best.pth (legacy UNet++ checkpoint) is preferred over the
# .safetensors SegFormer model — put it first so it's picked up automatically.
DEFAULT_MODEL_CANDIDATES = [
    CURRENT_DIR / "models" / "unetpp_best.pth",
    CURRENT_DIR.parent / "models" / "unetpp_best.pth",
    CURRENT_DIR / "models" / "best.pth",
    CURRENT_DIR / "models" / "model.safetensors",
    CURRENT_DIR / "models" / "final_statedict.pth",
    CURRENT_DIR / "models" / "unetpp_final_statedict.pth",
    CURRENT_DIR.parent / "models" / "unetpp_final_statedict.pth",
]

OUTPUTS_DIR = CURRENT_DIR / "outputs"


def get_default_model_path() -> str:
    for cand in DEFAULT_MODEL_CANDIDATES:
        if cand.exists():
            return str(cand)
    return str(CURRENT_DIR / "models" / "unetpp_best.pth")


def print_banner(device_str: str):
    print("\n" + "=" * 40)
    print("     OIL SPILL ML INFERENCE")
    print("=" * 40)
    print(f"\nDevice: {device_str}\n")


def parse_timestamp_safe(ts_str: Optional[str]) -> datetime:
    """
    Parses an ISO timestamp string into a UTC datetime object.
    Falls back to current UTC time if string is missing or invalid.
    """
    if not ts_str:
        return datetime.now(timezone.utc)
    try:
        clean_ts = ts_str.strip()
        if clean_ts.endswith("Z"):
            clean_ts = clean_ts[:-1]
        dt = datetime.fromisoformat(clean_ts)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc)
    except Exception:
        return datetime.now(timezone.utc)


def print_validation_debug_summary(env_data: Dict[str, Any]):
    """
    Prints a detailed validation summary of the retrieved Open-Meteo observations.
    """
    stats = env_data.get("validation_stats", {})
    ts_list = env_data.get("time_series", [])
    
    print("\n" + "-" * 40)
    print("Open-Meteo Environmental Validation")
    print("-" * 40)
    print(f"Latitude:  {stats.get('latitude', 0.0):.4f}° N")
    print(f"Longitude: {stats.get('longitude', 0.0):.4f}° E")
    print(f"Period:    {stats.get('period_start_utc')} -> {stats.get('period_end_utc')}")
    print(f"Total observations:   {stats.get('total_observations', 0)}")
    print(f"Valid current records: {stats.get('valid_current_count', 0)}")
    print(f"Missing current data:  {stats.get('missing_current_count', 0)}")
    
    if stats.get("valid_current_count", 0) > 0:
        min_v = stats.get("min_current_speed_ms")
        max_v = stats.get("max_current_speed_ms")
        mean_v = stats.get("mean_current_speed_ms")
        print(f"Min current speed:  {min_v:.3f} m/s ({min_v*3.6:.2f} km/h)" if min_v is not None else "Min: N/A")
        print(f"Max current speed:  {max_v:.3f} m/s ({max_v*3.6:.2f} km/h)" if max_v is not None else "Max: N/A")
        print(f"Mean current speed: {mean_v:.3f} m/s ({mean_v*3.6:.2f} km/h)" if mean_v is not None else "Mean: N/A")
        
        print("\nSample observations (latest 3 hours):")
        for sample in ts_list[-3:]:
            c_v = sample.get("ocean_current_velocity_ms")
            c_d = sample.get("ocean_current_direction_deg")
            w_s = sample.get("wind_speed_ms")
            w_d = sample.get("wind_direction_deg")
            c_str = f"{c_v:.3f} m/s at {c_d:.0f}°" if c_v is not None else "N/A"
            w_str = f"{w_s:.2f} m/s at {w_d:.0f}°" if w_s is not None else "N/A"
            print(f"  {sample.get('iso_time')}: Current=[{c_str}], Wind=[{w_str}]")
    else:
        print("\nWARNING: No valid ocean current observations available for this date/location.")
        if env_data.get("warnings"):
            for w in env_data["warnings"]:
                print(f"  Note: {w}")
    print("-" * 40 + "\n")


def _fmt(value: Optional[float], spec: str, unit: str = "") -> str:
    """
    Formats a numeric value that may be None (e.g. a field the API could not
    retrieve) without crashing. Never fabricates a 0.0 for missing data —
    shows 'N/A' instead so the operator knows the reading is unavailable.
    """
    if value is None:
        return "N/A"
    return f"{value:{spec}}{unit}"


def print_oil_spill_full_result(
    input_path: str,
    input_type: str,
    confidence: float,
    spill_area_km2: Optional[float],
    spill_coverage_percentage: float,
    spill_lat: float,
    spill_lon: float,
    detection_dt_utc: datetime,
    env_data: dict,
    origin_estimate: dict,
    mask_path: str,
    overlay_path: str,
    csv_path: Optional[str],
    map_path: Optional[str],
    elapsed_time: float,
    safe_metadata: Optional[dict] = None,
    spill_geometry: Optional[dict] = None,
):
    print("\n" + "=" * 40)
    print("          OIL SPILL DETECTED")
    print("=" * 40 + "\n")
    print("Classification:\nOIL SPILL\n")
    print(f"Confidence:\n{confidence:.2f}%\n")
    print("Segmentation:\nSUCCESS\n")
    
    lat_dir = "N" if spill_lat >= 0 else "S"
    lon_dir = "E" if spill_lon >= 0 else "W"
    print(f"Spill Location:\n{abs(spill_lat):.4f}° {lat_dir}\n{abs(spill_lon):.4f}° {lon_dir}\n")
    if spill_geometry and spill_geometry.get("area_km2") is not None:
        ci = spill_geometry.get("area_confidence_interval_km2")
        source_label = {
            "annotation_grid_gcps": "Sentinel-1 annotation-grid GCPs",
            "footprint_bilinear_interpolation": "scene-footprint interpolation (no GCPs available)",
        }.get(spill_geometry.get("geolocation_source"), "georeferenced")
        print(f"Estimated Oil-covered Area:\n{spill_geometry['area_km2']:.4f} km² ({source_label})\n")

        # How this number was derived — always shown, not taken on faith.
        print("How this was derived:")
        print(f"  Pixel count (model output, {spill_geometry.get('mask_resolution', 'N/A')}):     "
              f"{spill_geometry.get('pixel_count_mask', 0):,} px")
        print(f"  Pixel count (full res, {spill_geometry.get('full_res_resolution', 'N/A')}):  "
              f"{spill_geometry.get('pixel_count_full_res', 0):,} px")
        gsd = spill_geometry.get("native_pixel_spacing_m")
        if gsd:
            print(f"  Ground sampling distance ({spill_geometry.get('pixel_spacing_source', 'N/A')}): "
                  f"{gsd[0]:.2f} m x {gsd[1]:.2f} m")
        print(f"  Polygon area (shoelace formula over {spill_geometry.get('num_spill_patches', 0)} "
              f"georeferenced patch outline{'s' if spill_geometry.get('num_spill_patches', 0) != 1 else ''}): "
              f"{spill_geometry['area_km2']:.4f} km²")
        pca = spill_geometry.get("pixel_count_area_km2")
        if pca is not None:
            print(f"  Cross-check (pixel count x native pixel area, independent of the polygon math): "
                  f"{pca:.4f} km²")
        disc = spill_geometry.get("area_discrepancy_pct")
        if disc is not None:
            consistent = spill_geometry.get("area_estimates_consistent")
            flag = "OK" if consistent else "WARNING — investigate before reporting this figure"
            print(f"  Discrepancy between the two methods: {disc:.1f}% [{flag}]")
        print()

        if ci is not None:
            print(f"Area Confidence Interval:\n{ci[0]:.4f} - {ci[1]:.4f} km² (± {spill_geometry.get('pixel_ground_size_m', 0):.1f} m boundary uncertainty x perimeter)\n")
        if spill_geometry.get("length_km") is not None:
            print(f"Spill Length:\n{spill_geometry['length_km']:.3f} km\n")
        if spill_geometry.get("width_km") is not None:
            print(f"Spill Width:\n{spill_geometry['width_km']:.3f} km\n")
        if spill_geometry.get("perimeter_km") is not None:
            print(f"Spill Perimeter:\n{spill_geometry['perimeter_km']:.3f} km\n")
        if spill_geometry.get("num_spill_patches", 0) > 1:
            print(f"Distinct Spill Patches:\n{spill_geometry['num_spill_patches']}\n")
    elif spill_area_km2 is not None:
        print(f"Estimated Oil-covered Area:\n{spill_area_km2:.4f} km² (SAFE footprint estimate)\n")
    else:
        pc = spill_geometry.get("pixel_count_mask") if spill_geometry else None
        pc_note = f" ({pc:,} px in the model-resolution mask)" if pc is not None else ""
        print(f"Oil Pixel Coverage:\n{spill_coverage_percentage:.3f}% of the analysed scene{pc_note}\n")
        if spill_geometry and spill_geometry.get("geolocation_source") == "unavailable":
            print("Note: no georeferenced area could be computed — this scene has no usable "
                  "GCPs or footprint polygon, so no area/CI is reported (a whole-scene x "
                  "coverage% fallback would only manufacture false precision).\n")
    
    det_time_str = detection_dt_utc.strftime("%Y-%m-%d %H:%M UTC")
    print(f"Detection Time:\n{det_time_str}\n")
    
    # ---------------- Environmental Conditions ----------------
    print("=" * 40)
    print("      ENVIRONMENTAL CONDITIONS")
    print("=" * 40 + "\n")
    
    if env_data.get("has_valid_currents") and env_data.get("detection_conditions"):
        cond = env_data["detection_conditions"]
        print(f"Ocean Current:\n{_fmt(cond.get('current_velocity_ms'), '.2f', ' m/s')}\nDirection: {_fmt(cond.get('current_direction_deg'), '.0f', '°')}\n")
        wind_kmh = _fmt(cond.get('wind_speed_kmh'), '.1f', ' km/h')
        wind_ms = _fmt(cond.get('wind_speed_ms'), '.1f', ' m/s')
        print(f"Wind:\n{wind_kmh} ({wind_ms})\nDirection: {_fmt(cond.get('wind_direction_deg'), '.0f', '°')}\n")
        if cond.get('wind_speed_ms') is None:
            print("Note: Wind data unavailable for this location/time — drift hindcast used ocean currents only.\n")
        print(f"Windage:\n{DEFAULT_WINDAGE_FACTOR * 100:.1f}%\n")
        print("Data Source:\nOpen-Meteo Marine (SMOC) & Weather (ERA5)\n")
    else:
        print("Environmental Analysis:\nUNAVAILABLE\n")
        print("Reason:\nValid historical ocean-current data could not be retrieved for the requested location/time.")
        if env_data.get("warnings"):
            for w in env_data["warnings"]:
                print(f"Note: {w}")
        print()
            
    # ---------------- Backward Hindcast ----------------
    print("=" * 40)
    print("      BACKWARD HINDCAST")
    print("=" * 40 + "\n")
    
    if origin_estimate.get("status") == "ESTIMATED":
        orig_lat = origin_estimate["origin_latitude"]
        orig_lon = origin_estimate["origin_longitude"]
        o_lat_dir = "N" if orig_lat >= 0 else "S"
        o_lon_dir = "E" if orig_lon >= 0 else "W"
        
        print(f"Look-back period:\n{origin_estimate['lookback_period_hours']:.0f} hours "
              f"({origin_estimate['lookback_period_hours'] / 24.0:.1f} days)\n")
        print(f"Trajectory:\nGenerated successfully ({origin_estimate.get('simulation_engine', 'hindcast')})\n")
        print(f"Estimated Origin (ocean):\n{abs(orig_lat):.4f}° {o_lat_dir}\n{abs(orig_lon):.4f}° {o_lon_dir}\n"
              f"(Drift distance: ~{origin_estimate['origin_distance_km']:.1f} km)\n")
        print(f"Origin selection:\n{origin_estimate.get('origin_selection_method', 'n/a')}\n")
        print(f"Estimated Spill Start:\n{origin_estimate['estimated_start_str']}\n")
        print(f"Approximate Uncertainty Window:\n{origin_estimate['earliest_plausible_str']}\nto\n{origin_estimate['latest_plausible_str']}\n")
        if origin_estimate.get("final_particle_latitude") is not None:
            final_lat = origin_estimate["final_particle_latitude"]
            final_lon = origin_estimate["final_particle_longitude"]
            print(
                f"Final Particle Location (20-day simulation):\n"
                f"{abs(final_lat):.4f}° {'N' if final_lat >= 0 else 'S'}, "
                f"{abs(final_lon):.4f}° {'E' if final_lon >= 0 else 'W'}\n"
                f"Time: {origin_estimate['final_particle_time_utc']}\n"
            )
    elif origin_estimate.get("status") == "RELEASE_AGE_REQUIRED":
        print("Backward Hindcast:\nTRAJECTORY GENERATED — RELEASE AGE REQUIRED\n")
        print(f"Look-back period:\n{origin_estimate.get('lookback_period_hours', 0) / 24:.1f} days\n")
        print(f"Model:\n{origin_estimate.get('simulation_engine', 'OpenDrift')}\n")
        print(f"Origin statement:\n{origin_estimate.get('reason')}\n")
    else:
        print("Backward Hindcast:\nUNAVAILABLE (Open-Meteo current or wind data could not be used)\n")
        if origin_estimate.get("reason"):
            print(f"Reason:\n{origin_estimate['reason']}\n")
        
    # ---------------- Output Files ----------------
    print("=" * 40)
    print("      OUTPUT FILES")
    print("=" * 40 + "\n")
    
    def format_rel(p):
        if not p: return "N/A"
        try: return os.path.relpath(p, CURRENT_DIR)
        except Exception: return p

    print(f"Segmentation:\n{format_rel(mask_path)}\n")
    print(f"Overlay:\n{format_rel(overlay_path)}\n")
    if csv_path:
        print(f"Trajectory:\n{format_rel(csv_path)}\n")
    if map_path:
        print(f"Trajectory Map:\n{format_rel(map_path)}\n")
        
    print(f"Processing time:\n{elapsed_time:.2f} seconds\n")
    print("=" * 40 + "\n")


def print_no_oil_result(
    input_path: str,
    input_type: str,
    confidence: float,
    mask_path: str,
    overlay_path: str,
    elapsed_time: float,
    safe_metadata: Optional[dict] = None,
):
    print("\n" + "=" * 40)
    print("        INFERENCE RESULT")
    print("=" * 40 + "\n")
    print(f"Input:\n{input_path}\n")
    print(f"Input type:\n{input_type}\n")
    
    if safe_metadata:
        if safe_metadata.get("satellite"):
            print(f"Satellite:\n{safe_metadata['satellite']}\n")
        if safe_metadata.get("acquisition_start"):
            print(f"Acquisition Timestamp:\n{safe_metadata['acquisition_start']}\n")
        if safe_metadata.get("polarization_used"):
            print(f"Polarization Used:\n{safe_metadata['polarization_used']}\n")
            
    print("Prediction:\nNO OIL SPILL\n")
    print(f"Confidence:\n{confidence:.2f}%\n")
    print("Segmentation:\nSUCCESS\n")
    
    def format_rel(p):
        try: return os.path.relpath(p, CURRENT_DIR)
        except Exception: return p

    print(f"Mask:\n{format_rel(mask_path)}\n")
    print(f"Overlay:\n{format_rel(overlay_path)}\n")
    print(f"Processing time:\n{elapsed_time:.2f} seconds\n")
    print("=" * 40 + "\n")


def prompt_for_image_metadata() -> Tuple[float, float, datetime]:
    """
    Prompts the user for latitude, longitude, and UTC timestamp for standard images.
    Requires real coordinates — no demo ocean defaults.
    """
    print("\n--- Geographic & Temporal Metadata for Drift Estimation ---")
    print("Enter the real spill location (no demo defaults).")

    while True:
        lat_input = input("Enter reference latitude [-90 to 90]: ").strip()
        try:
            lat = float(lat_input)
            if -90.0 <= lat <= 90.0:
                break
        except ValueError:
            pass
        print("Please enter a valid latitude.")

    while True:
        lon_input = input("Enter reference longitude [-180 to 180]: ").strip()
        try:
            lon = float(lon_input)
            if -180.0 <= lon <= 180.0:
                break
        except ValueError:
            pass
        print("Please enter a valid longitude.")

    ts_input = input("Enter acquisition timestamp in UTC [YYYY-MM-DD HH:MM] (or press Enter for now): ").strip()
    dt_utc = parse_timestamp_safe(ts_input) if ts_input else datetime.now(timezone.utc)

    return lat, lon, dt_utc


def process_single_input(
    file_path_str: str,
    model: torch.nn.Module,
    device: torch.device,
    skip_ais: bool = False,
    lookback_hours: int = DEFAULT_LOOKBACK_HOURS,
    release_hours_ago: Optional[float] = None,
):
    clean_path = file_path_str.strip().strip('"').strip("'")
    
    if not os.path.exists(clean_path):
        print(f"\nERROR: File not found: '{clean_path}'\n")
        return

    start_time = time.time()
    stem = Path(clean_path).stem
    if stem.lower().endswith(".safe"):
        stem = Path(stem).stem  # strip .safe if present
        
    is_safe = is_safe_input(clean_path)
    safe_metadata = None

    try:
        # 1. Load and read input
        if is_safe:
            print("\nDetecting Sentinel-1 SAFE archive...")
            print("Extracting...")
            print("Reading SAR data & metadata...")
            rgb_image, original_shape, safe_metadata = process_safe_archive(clean_path)
            input_type_label = "Sentinel-1 SAFE"
        else:
            print("\nReading image...")
            rgb_image, original_shape = load_and_validate_image(clean_path)
            input_type_label = "Satellite Image"

        # 2. Run Model Inference & Segmentation
        print("Preprocessing...")
        model_input_size = getattr(model, "_oil_spill_input_size", 512)
        # .SAFE.zip inputs use sar_bands_to_pseudo_rgb (training-matching dB
        # normalization) and so must resize with the same INTER_AREA method
        # training used; plain images keep the previous INTER_LINEAR default.
        resize_interp = SAR_RESIZE_INTERPOLATION if is_safe else DEFAULT_RESIZE_INTERPOLATION
        input_tensor = preprocess_image(
            rgb_image, target_size=(model_input_size, model_input_size), interpolation=resize_interp
        )

        print("Running model...")
        prob_map = predict(model, input_tensor, device)
        interpretation = interpret_output(prob_map, threshold=0.5)

        print("\nGenerating segmentation...")
        mask_path, overlay_path, _overlay_thumb_path = generate_mask_and_overlay(
            original_rgb=rgb_image,
            binary_mask_256=interpretation["binary_mask_256"],
            output_dir=str(OUTPUTS_DIR),
            base_name=stem,
        )

        is_oil = interpretation["is_oil"]
        confidence = interpretation["confidence"]
        orig_h, orig_w = original_shape[0], original_shape[1]
        spill_geometry = (
            compute_spill_geometry(interpretation["binary_mask_256"], orig_w, orig_h, safe_metadata)
            if safe_metadata else None
        )
        spill_area_km2 = spill_geometry["area_km2"] if spill_geometry else None

        # 3. IF NO OIL SPILL -> Finish immediately without querying Open-Meteo
        if not is_oil:
            elapsed = time.time() - start_time
            print_no_oil_result(
                input_path=clean_path,
                input_type=input_type_label,
                confidence=confidence,
                mask_path=mask_path,
                overlay_path=overlay_path,
                elapsed_time=elapsed,
                safe_metadata=safe_metadata,
            )
            return

        # 4. IF OIL SPILL DETECTED -> Run Stage 2 (Geolocation + Open-Meteo + Backward Drift)
        print("\n" + ">" * 40)
        print(">>> OIL SPILL DETECTED - Initializing Environmental & Drift Analysis...")
        print(">" * 40)

        # Geolocation & Timestamp extraction
        if is_safe and safe_metadata:
            orig_w, orig_h = original_shape[1], original_shape[0]
            geo_info = extract_spill_centroid_geo(
                binary_mask_256=interpretation["binary_mask_256"],
                image_width=orig_w,
                image_height=orig_h,
                metadata=safe_metadata,
            )
            spill_lat = geo_info["latitude"]
            spill_lon = geo_info["longitude"]
            detection_dt = parse_timestamp_safe(safe_metadata.get("acquisition_start"))
            print(f"Extracted Spill Geolocation: {geo_info['formatted_lat']}, {geo_info['formatted_lon']}")
            print(f"Acquisition Timestamp: {detection_dt.strftime('%Y-%m-%d %H:%M:%S UTC')}")

            # A single averaged centroid can land on dry ground even when most of
            # the spill is on water, so georeference the polygon boundary instead
            # and classify each vertex against the landmask.
            try:
                polygon_geo = extract_spill_polygon_points_geo(
                    binary_mask_256=interpretation["binary_mask_256"],
                    image_width=orig_w,
                    image_height=orig_h,
                    metadata=safe_metadata,
                )
                seed = resolve_ocean_seed_from_polygon(
                    polygon_geo["patches"], spill_lat, spill_lon
                )
            except Exception as seed_err:
                print(f"[Geolocation] WARNING: polygon-based ocean seed failed ({seed_err}); "
                      f"falling back to centroid radial snap.")
                try:
                    seed = ensure_ocean_seed(spill_lat, spill_lon)
                except Exception as fallback_err:
                    print(f"[Geolocation] WARNING: could not snap to ocean: {fallback_err}")
                    seed = None
        else:
            # Standard image: require real coordinates (no demo defaults)
            spill_lat, spill_lon, detection_dt = prompt_for_image_metadata()
            print(f"Reference Location: {spill_lat:.4f}°N, {spill_lon:.4f}°E")
            print(f"Detection Timestamp: {detection_dt.strftime('%Y-%m-%d %H:%M:%S UTC')}")

            # No SAR footprint for a plain image, so only a single-point radial snap is possible.
            try:
                seed = ensure_ocean_seed(spill_lat, spill_lon)
            except Exception as seed_err:
                print(f"[Geolocation] WARNING: could not snap to ocean: {seed_err}")
                seed = None

        # Keep environmental queries and drift seeds in the ocean — land centroids
        # produced bogus inland "origins" with Open-Meteo point currents.
        if seed is not None and seed["was_on_land"]:
            if seed.get("total_vertices", 0) > 0:
                print(
                    f"[Geolocation] Spill polygon crosses the coastline "
                    f"({seed['shoreline_vertices_used']}/{seed['total_vertices']} boundary "
                    f"points on water); using their mean, {seed['latitude']:.4f}, "
                    f"{seed['longitude']:.4f}, as the offshore seed for drift & AIS search "
                    f"[{seed['method']}]."
                )
            else:
                print(
                    f"[Geolocation] Spill centroid was on land "
                    f"({seed['original_latitude']:.4f}, {seed['original_longitude']:.4f}); "
                    f"using nearest ocean point {seed['latitude']:.4f}, {seed['longitude']:.4f} "
                    f"({seed['snap_distance_km']:.1f} km offshore) for drift & AIS search "
                    f"[{seed['method']}]."
                )
            spill_lat, spill_lon = seed["latitude"], seed["longitude"]

        print("\nQuerying Open-Meteo Marine & Weather APIs...")
        env_data = fetch_environmental_history(
            latitude=spill_lat,
            longitude=spill_lon,
            detection_time_utc=detection_dt,
            lookback_hours=lookback_hours,
        )

        print_validation_debug_summary(env_data)

        csv_path = None
        map_path = None
        origin_estimate = {}

        # Open-Meteo Marine and Weather data drive the backward trajectory.
        if isinstance(env_data, dict):
            print(f"Running backward drift with Open-Meteo currents and wind (Lookback: {lookback_hours / 24:.1f} days)...")
            try:
                trajectory = run_backward_hindcast(
                    spill_lat=spill_lat,
                    spill_lon=spill_lon,
                    detection_time_utc=detection_dt,
                    env_time_series=env_data["time_series"],
                    windage_factor=DEFAULT_WINDAGE_FACTOR,
                    lookback_hours=lookback_hours,
                )
                # Always select an ocean origin: explicit release age if given,
                # otherwise coastal stranding or multi-day lookback horizon.
                origin_estimate = estimate_spill_origin_and_start(
                    trajectory=trajectory,
                    detection_time_utc=detection_dt,
                    nominal_release_hours_ago=release_hours_ago,
                    uncertainty_hours=(
                        max(12.0, min(48.0, (release_hours_ago or lookback_hours) * 0.25))
                    ),
                )
                final_particle = trajectory[-1]
                origin_estimate["final_particle_latitude"] = final_particle["latitude"]
                origin_estimate["final_particle_longitude"] = final_particle["longitude"]
                origin_estimate["final_particle_time_utc"] = final_particle["iso_time"]
                csv_path = os.path.join(str(OUTPUTS_DIR), f"{stem}_trajectory.csv")
                save_trajectory_csv(trajectory, csv_path)
                map_path = os.path.join(str(OUTPUTS_DIR), f"{stem}_trajectory.png")
                plot_trajectory_map(trajectory, origin_estimate, map_path)
            except Exception as drift_error:
                origin_estimate = {"status": "UNAVAILABLE", "reason": str(drift_error)}
                print(f"[Hindcast] Not run: {drift_error}")

        elapsed = time.time() - start_time
        
        print_oil_spill_full_result(
            input_path=clean_path,
            input_type=input_type_label,
            confidence=confidence,
            spill_area_km2=spill_area_km2,
            spill_geometry=spill_geometry,
            spill_coverage_percentage=interpretation["spill_coverage_percentage"],
            spill_lat=spill_lat,
            spill_lon=spill_lon,
            detection_dt_utc=detection_dt,
            env_data=env_data,
            origin_estimate=origin_estimate,
            mask_path=mask_path,
            overlay_path=overlay_path,
            csv_path=csv_path,
            map_path=map_path,
            elapsed_time=elapsed,
            safe_metadata=safe_metadata,
        )

        # ── Stage 3: Vessel Attribution ──────────────────────────────────────
        if not skip_ais:
            print("\n" + ">" * 40)
            print(">>> STAGE 3 — Vessel Attribution Analysis...")
            print(">" * 40)

            gfw_token    = os.environ.get("GFW_API_TOKEN", "").strip()
            aisstream_key = os.environ.get("AISSTREAM_API_KEY", "").strip()

            attr_res = run_attribution(
                spill_lat=spill_lat,
                spill_lon=spill_lon,
                detection_time_utc=detection_dt,
                origin_estimate=origin_estimate,
                env_time_series=env_data.get("time_series", []),
                output_dir=str(OUTPUTS_DIR),
                output_stem=stem,
                gfw_api_token=gfw_token,
                aisstream_api_key=aisstream_key,
                search_window_hours=float(lookback_hours),
            )
            print_attribution_result(attr_res)
        else:
            print("\n[Attribution] Skipped (--skip-ais flag set).")

    except Exception as e:
        import traceback
        print(f"\nERROR: Processing failed: {e}")
        traceback.print_exc()
        print()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Oil Spill ML — interactive CLI inference.")
    parser.add_argument("file", nargs="?", help="Path to a .SAFE.zip or image file. Omit to enter interactive mode.")
    parser.add_argument("--model", dest="model_path", default=None, help="Override the model checkpoint path (defaults to OIL_SPILL_MODEL_PATH env var, then the first found in models/).")
    parser.add_argument("--skip-ais", action="store_true", help="Skip Stage 3 vessel attribution.")
    parser.add_argument("--lookback-days", type=float, default=DEFAULT_LOOKBACK_HOURS / 24.0, help="Days of current/wind history to backtrack (default: %(default)s).")
    parser.add_argument("--release-hours-ago", type=float, default=None, help="Evidence-based release age in hours, if known.")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    OUTPUTS_DIR.mkdir(exist_ok=True)

    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    print_banner(str(device))

    model_path = args.model_path or os.environ.get("OIL_SPILL_MODEL_PATH", get_default_model_path())
    print(f"Loading model from {model_path}...")
    try:
        model, model_metadata = load_model(model_path, device=device)
    except Exception as e:
        print(f"ERROR: failed to load model from '{model_path}': {e}")
        sys.exit(1)
    print(f"Model loaded: {model_metadata.get('type', 'unknown')}\n")

    lookback_hours = int(args.lookback_days * 24)

    if args.file:
        process_single_input(
            args.file, model, device,
            skip_ais=args.skip_ais,
            lookback_hours=lookback_hours,
            release_hours_ago=args.release_hours_ago,
        )
        return

    print("Enter a file path to analyze (or 'quit' to exit).")
    while True:
        file_input = input("\nFile path: ").strip()
        if file_input.lower() in ("quit", "exit", "q"):
            break
        if not file_input:
            continue
        process_single_input(
            file_input, model, device,
            skip_ais=args.skip_ais,
            lookback_hours=lookback_hours,
            release_hours_ago=args.release_hours_ago,
        )


if __name__ == "__main__":
    main()