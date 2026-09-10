"""
pipeline.py - Stage-emitting version of the Oil Spill ML inference pipeline.

This module contains the SAME processing logic as the original app.py CLI
(process_single_input), but instead of printing to a terminal and prompting
with input(), it:

  1. Takes all inputs as plain function arguments (no interactive prompts).
  2. Reports progress through an `on_stage(name, status, message, data)`
     callback so a web frontend can show live processing steps.
  3. Returns one fully JSON-serializable dict with every piece of output
     (detection, geometry, environment, drift, vessel attribution, and
     paths to generated files).

It does not change any of the existing detection / geolocation / drift /
attribution logic - it only reuses the functions from model.py,
preprocessing.py, safe_processor.py, environment.py, drift.py and
ais_attribution.py exactly as app.py did.
"""

from __future__ import annotations

import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Dict, Optional

import torch

from model import predict, interpret_output
from preprocessing import (
    load_and_validate_image,
    preprocess_image,
    generate_mask_and_overlay,
    SAR_RESIZE_INTERPOLATION,
    DEFAULT_RESIZE_INTERPOLATION,
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
    DEFAULT_WINDAGE_FACTOR,
)
from ais_attribution import run_attribution


# Stage names, in pipeline order. Used by the API layer to pre-populate a
# "pending" checklist the frontend can render immediately after upload.
STAGE_NAMES = [
    "extraction",
    "preprocessing",
    "model_inference",
    "segmentation",
    "geolocation",
    "environmental_data",
    "drift_hindcast",
    "vessel_attribution",
]

OnStage = Callable[[str, str, str, Optional[Dict[str, Any]]], None]


class PipelineInputError(ValueError):
    """Raised for problems with the caller-supplied input (bad file, missing
    coordinates, etc). The API layer turns this into a 400 response instead
    of a generic 500."""


def _noop_stage(name: str, status: str, message: str, data: Optional[Dict[str, Any]] = None) -> None:
    pass


def parse_timestamp_safe(ts_str: Optional[str]) -> datetime:
    """Parses an ISO timestamp string into a UTC datetime. Falls back to now."""
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


def _fmt_latlon(lat: float, lon: float) -> Dict[str, Any]:
    return {
        "latitude": round(lat, 5),
        "longitude": round(lon, 5),
        "formatted": (
            f"{abs(lat):.4f}°{'N' if lat >= 0 else 'S'}, "
            f"{abs(lon):.4f}°{'E' if lon >= 0 else 'W'}"
        ),
    }


def run_pipeline(
    job_id: str,
    input_path: str,
    model: torch.nn.Module,
    device: torch.device,
    outputs_dir: str,
    *,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    timestamp: Optional[str] = None,
    lookback_days: float = 5.0,
    release_hours_ago: Optional[float] = None,
    skip_ais: bool = False,
    on_stage: Optional[OnStage] = None,
) -> Dict[str, Any]:
    """
    Runs the full detection -> geolocation -> environment -> drift ->
    attribution pipeline for one input file and returns a single JSON-ready
    result dict. Raises PipelineInputError for bad caller input, or lets
    unexpected exceptions propagate (the API layer records those as a
    failed job).
    """
    on_stage = on_stage or _noop_stage
    lookback_hours = int(lookback_days * 24)

    clean_path = str(input_path).strip()
    if not os.path.exists(clean_path):
        raise PipelineInputError(f"File not found: {clean_path}")

    start_time = time.time()
    stem = Path(clean_path).stem
    if stem.lower().endswith(".safe"):
        stem = Path(stem).stem

    job_outputs_dir = os.path.join(outputs_dir, job_id)
    os.makedirs(job_outputs_dir, exist_ok=True)

    is_safe = is_safe_input(clean_path)

    result: Dict[str, Any] = {
        "job_id": job_id,
        "input_type": "Sentinel-1 SAFE" if is_safe else "Satellite Image",
    }

    # ---------------------------------------------------------------- #
    # Stage 1: extraction / load
    # ---------------------------------------------------------------- #
    on_stage("extraction", "running", "Reading input file...")
    try:
        if is_safe:
            rgb_image, original_shape, safe_metadata = process_safe_archive(clean_path)
        else:
            if latitude is None or longitude is None:
                raise PipelineInputError(
                    "latitude and longitude are required when uploading a plain image "
                    "(only .SAFE / .SAFE.zip archives carry their own geolocation)."
                )
            if not (-90.0 <= float(latitude) <= 90.0):
                raise PipelineInputError("latitude must be between -90 and 90.")
            if not (-180.0 <= float(longitude) <= 180.0):
                raise PipelineInputError("longitude must be between -180 and 180.")
            rgb_image, original_shape = load_and_validate_image(clean_path)
            safe_metadata = None
    except PipelineInputError:
        on_stage("extraction", "error", "Invalid input.")
        raise
    except Exception as e:
        on_stage("extraction", "error", f"Failed to read input: {e}")
        raise
    on_stage("extraction", "success", "Input read successfully.", {
        "input_type": result["input_type"],
        "original_shape": {"height": int(original_shape[0]), "width": int(original_shape[1])},
    })
    if safe_metadata:
        result["safe_metadata"] = {
            k: v for k, v in safe_metadata.items()
            if isinstance(v, (str, int, float, bool)) or v is None
        }

    # ---------------------------------------------------------------- #
    # Stage 2: preprocessing
    # ---------------------------------------------------------------- #
    on_stage("preprocessing", "running", "Resizing and normalizing image for the model...")
    try:
        model_input_size = getattr(model, "_oil_spill_input_size", 512)
        # .SAFE.zip uploads now go through sar_bands_to_pseudo_rgb (see
        # safe_processor.process_safe_archive), which matches training's
        # pre-resize dB normalization - so the resize step here must also
        # use training's INTER_AREA to be a faithful match. Plain-image
        # uploads are unaffected (still INTER_LINEAR, as before).
        resize_interp = SAR_RESIZE_INTERPOLATION if is_safe else DEFAULT_RESIZE_INTERPOLATION
        input_tensor = preprocess_image(
            rgb_image, target_size=(model_input_size, model_input_size), interpolation=resize_interp
        )
    except Exception as e:
        on_stage("preprocessing", "error", f"Preprocessing failed: {e}")
        raise
    on_stage("preprocessing", "success", "Image preprocessed.")

    # ---------------------------------------------------------------- #
    # Stage 3: model inference
    # ---------------------------------------------------------------- #
    on_stage("model_inference", "running", "Running segmentation model...")
    try:
        prob_map = predict(model, input_tensor, device)
        interpretation = interpret_output(prob_map, threshold=0.5)
    except Exception as e:
        on_stage("model_inference", "error", f"Model inference failed: {e}")
        raise
    on_stage("model_inference", "success", interpretation["prediction"], {
        "prediction": interpretation["prediction"],
        "confidence": interpretation["confidence"],
        "spill_coverage_percentage": interpretation["spill_coverage_percentage"],
    })

    # ---------------------------------------------------------------- #
    # Stage 4: segmentation mask / overlay
    # ---------------------------------------------------------------- #
    on_stage("segmentation", "running", "Generating mask and overlay images...")
    try:
        mask_path, overlay_path, overlay_thumb_path = generate_mask_and_overlay(
            original_rgb=rgb_image,
            binary_mask_256=interpretation["binary_mask_256"],
            output_dir=job_outputs_dir,
            base_name=stem,
        )
    except Exception as e:
        on_stage("segmentation", "error", f"Mask/overlay generation failed: {e}")
        raise
    on_stage("segmentation", "success", "Segmentation complete.", {
        "mask_file": os.path.basename(mask_path),
        "overlay_file": os.path.basename(overlay_path),
    })

    is_oil = interpretation["is_oil"]
    orig_h, orig_w = original_shape[0], original_shape[1]
    spill_geometry = (
        compute_spill_geometry(interpretation["binary_mask_256"], orig_w, orig_h, safe_metadata)
        if safe_metadata else None
    )

    result["detection"] = {
        "prediction": interpretation["prediction"],
        "is_oil_spill": is_oil,
        "confidence_percent": interpretation["confidence"],
        "spill_coverage_percentage": interpretation["spill_coverage_percentage"],
        "oil_pixel_count": interpretation["oil_pixel_count"],
        "total_pixels": interpretation["total_pixels"],
    }
    result["files"] = {
        "mask": os.path.basename(mask_path),
        "overlay": os.path.basename(overlay_path),
        # Small downscaled JPEG for fast previewing (see preprocessing.py) -
        # the frontend results page should use this instead of the
        # full-resolution overlay for its inline thumbnail.
        "overlay_thumbnail": os.path.basename(overlay_thumb_path),
        "quick_look": os.path.basename(overlay_thumb_path),
    }
    if spill_geometry:
        result["spill_geometry"] = {
            k: v for k, v in spill_geometry.items()
            if isinstance(v, (str, int, float, bool, list)) or v is None
        }

    # ---------------------------------------------------------------- #
    # No spill detected -> stop here, mark remaining stages skipped.
    # ---------------------------------------------------------------- #
    if not is_oil:
        for name in ("geolocation", "environmental_data", "drift_hindcast", "vessel_attribution"):
            on_stage(name, "skipped", "No oil spill detected - stage not required.")
        result["classification_status"] = "No Spill"
        result["processing_time_seconds"] = round(time.time() - start_time, 2)
        result["elapsed_seconds"] = result["processing_time_seconds"]
        return result

    # ---------------------------------------------------------------- #
    # Stage 5: geolocation
    # ---------------------------------------------------------------- #
    on_stage("geolocation", "running", "Determining spill coordinates...")
    polygon_geo = None
    try:
        if is_safe and safe_metadata:
            geo_info = extract_spill_centroid_geo(
                binary_mask_256=interpretation["binary_mask_256"],
                image_width=orig_w,
                image_height=orig_h,
                metadata=safe_metadata,
            )
            spill_lat = geo_info["latitude"]
            spill_lon = geo_info["longitude"]
            detection_dt = parse_timestamp_safe(safe_metadata.get("acquisition_start"))

            try:
                # Kept even if resolve_ocean_seed_from_polygon() below fails -
                # this is the real per-vertex spill boundary, exposed on
                # result["spill_geometry"]["polygon_patches"] further down so
                # the frontend can draw the actual detected slick shape
                # instead of approximating it as a circle.
                polygon_geo = extract_spill_polygon_points_geo(
                    binary_mask_256=interpretation["binary_mask_256"],
                    image_width=orig_w,
                    image_height=orig_h,
                    metadata=safe_metadata,
                )
                seed = resolve_ocean_seed_from_polygon(polygon_geo["patches"], spill_lat, spill_lon)
            except Exception:
                try:
                    seed = ensure_ocean_seed(spill_lat, spill_lon)
                except Exception:
                    seed = None
        else:
            spill_lat, spill_lon = float(latitude), float(longitude)
            detection_dt = parse_timestamp_safe(timestamp)
            try:
                seed = ensure_ocean_seed(spill_lat, spill_lon)
            except Exception:
                seed = None

        geolocation_note = None
        if seed is not None and seed.get("was_on_land"):
            geolocation_note = (
                f"Detected centroid was on land; using nearest ocean point "
                f"({seed['latitude']:.4f}, {seed['longitude']:.4f}) for drift & AIS search "
                f"[{seed.get('method')}]."
            )
            spill_lat, spill_lon = seed["latitude"], seed["longitude"]
        elif seed is not None and seed.get("landmask_available") is False:
            # Don't silently pretend the point was checked and is fine - the
            # coastline dataset itself failed to load, so land/water status
            # for this coordinate was never actually verified.
            geolocation_note = (
                "Coastline/land-water check unavailable in this environment "
                "(GSHHS landmask data failed to load) - using the provided "
                "coordinates as-is; they have NOT been verified to be in open "
                "water and may need manual correction."
            )
        elif seed is None:
            geolocation_note = (
                "Ocean-seed verification failed unexpectedly - using the "
                "provided coordinates as-is; they have NOT been verified to "
                "be in open water."
            )
    except Exception as e:
        on_stage("geolocation", "error", f"Geolocation failed: {e}")
        raise

    result["geolocation"] = {
        **_fmt_latlon(spill_lat, spill_lon),
        "detection_timestamp_utc": detection_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "note": geolocation_note,
    }
    on_stage("geolocation", "success", "Spill location resolved.", result["geolocation"])

    # Expose the real per-vertex spill boundary (only available for SAFE
    # archives, which carry the GCPs needed to georeference each mask pixel -
    # a plain SAR image only has a single user-supplied centroid, so it
    # keeps the circle-radius approximation on the frontend). One ring per
    # contiguous spill patch, ordered [lat, lon].
    if polygon_geo and polygon_geo.get("patches"):
        result.setdefault("spill_geometry", {})["polygon_patches"] = [
            [[round(float(lat), 6), round(float(lon), 6)] for lat, lon in patch]
            for patch in polygon_geo["patches"]
            if len(patch) >= 3
        ]

    # ---------------------------------------------------------------- #
    # Stage 6: environmental data (Open-Meteo)
    # ---------------------------------------------------------------- #
    on_stage("environmental_data", "running", "Fetching ocean current and wind history...")
    try:
        env_data = fetch_environmental_history(
            latitude=spill_lat,
            longitude=spill_lon,
            detection_time_utc=detection_dt,
            lookback_hours=lookback_hours,
        )
    except Exception as e:
        env_data = {"available": False, "has_valid_currents": False, "warnings": [str(e)], "time_series": []}

    has_valid_currents = bool(env_data.get("has_valid_currents"))
    has_valid_wind = bool(env_data.get("has_valid_wind"))
    env_summary: Dict[str, Any] = {
        "has_valid_currents": has_valid_currents,
        "has_valid_wind": has_valid_wind,
        "warnings": env_data.get("warnings", []),
    }
    # Wind (ERA5 archive) and ocean current (Open-Meteo SMOC, coverage from
    # Jan 2022 only) come from independent sources with independent
    # availability. Surface whichever of the two actually came back instead
    # of dropping BOTH just because currents alone were missing.
    if env_data.get("detection_conditions") and (has_valid_currents or has_valid_wind):
        env_summary["detection_conditions"] = env_data["detection_conditions"]
    result["environmental_conditions"] = env_summary

    if has_valid_currents and has_valid_wind:
        stage_status, stage_message = "success", "Environmental data retrieved."
    elif has_valid_wind:
        stage_status, stage_message = "warning", "Wind data retrieved; no valid ocean current data for this location/time."
    elif has_valid_currents:
        stage_status, stage_message = "warning", "Ocean current data retrieved; no valid wind data for this location/time."
    else:
        stage_status, stage_message = "warning", "No valid current or wind data for this location/time."
    on_stage("environmental_data", stage_status, stage_message, env_summary)

    # ---------------------------------------------------------------- #
    # Stage 7: backward drift hindcast
    # ---------------------------------------------------------------- #
    on_stage("drift_hindcast", "running", "Running backward drift simulation...")
    csv_path = None
    map_path = None
    origin_estimate: Dict[str, Any] = {}
    trajectory = None
    try:
        if isinstance(env_data, dict) and env_data.get("time_series"):
            trajectory = run_backward_hindcast(
                spill_lat=spill_lat,
                spill_lon=spill_lon,
                detection_time_utc=detection_dt,
                env_time_series=env_data["time_series"],
                windage_factor=DEFAULT_WINDAGE_FACTOR,
                lookback_hours=lookback_hours,
            )

        if trajectory:
            origin_estimate = estimate_spill_origin_and_start(
                trajectory=trajectory,
                detection_time_utc=detection_dt,
                nominal_release_hours_ago=release_hours_ago,
                uncertainty_hours=max(12.0, min(48.0, (release_hours_ago or lookback_hours) * 0.25)),
            )
            final_particle = trajectory[-1]
            origin_estimate["final_particle_latitude"] = final_particle["latitude"]
            origin_estimate["final_particle_longitude"] = final_particle["longitude"]
            origin_estimate["final_particle_time_utc"] = final_particle["iso_time"]

            csv_path = os.path.join(job_outputs_dir, f"{stem}_trajectory.csv")
            save_trajectory_csv(trajectory, csv_path)
            map_path = os.path.join(job_outputs_dir, f"{stem}_trajectory.png")
            plot_trajectory_map(trajectory, origin_estimate, map_path)

            # Thin the trajectory down to a map-friendly point list (lat/lon/time
            # only) so the frontend can draw the drift path directly on a
            # Leaflet/OSM map without having to fetch and parse the CSV.
            _max_points = 60
            _step = max(1, len(trajectory) // _max_points)
            result["drift_trajectory_points"] = [
                {
                    "latitude": round(p["latitude"], 5),
                    "longitude": round(p["longitude"], 5),
                    "time_utc": p.get("iso_time"),
                }
                for p in trajectory[::_step]
            ]
        else:
            origin_estimate = {"status": "UNAVAILABLE", "reason": "No environmental time series available."}
    except Exception as drift_error:
        origin_estimate = {"status": "UNAVAILABLE", "reason": str(drift_error)}

    drift_summary = {
        k: v for k, v in origin_estimate.items()
        if isinstance(v, (str, int, float, bool)) or v is None
    }
    insitu_meta = env_data.get("insitu_current_fallback") if isinstance(env_data, dict) else None
    if insitu_meta and insitu_meta.get("used"):
        drift_summary["insitu_current_used"] = True
        drift_summary["insitu_platform_id"] = str(insitu_meta.get("nearest_platform_id", ""))
        drift_summary["insitu_distance_km"] = insitu_meta.get("nearest_distance_km")
    if csv_path:
        result["files"]["trajectory_csv"] = os.path.basename(csv_path)
    if map_path:
        result["files"]["trajectory_map"] = os.path.basename(map_path)
    result["drift_hindcast"] = drift_summary
    on_stage(
        "drift_hindcast",
        "success" if origin_estimate.get("status") == "ESTIMATED" else "warning",
        "Backward drift trajectory computed." if origin_estimate.get("status") == "ESTIMATED"
        else "Drift hindcast unavailable or incomplete.",
        drift_summary,
    )

    # ---------------------------------------------------------------- #
    # Stage 8: vessel attribution (AIS)
    # ---------------------------------------------------------------- #
    if skip_ais:
        on_stage("vessel_attribution", "skipped", "Vessel attribution skipped by request.")
    else:
        on_stage("vessel_attribution", "running", "Cross-referencing AIS vessel traffic...")
        try:
            gfw_token = os.environ.get("GFW_API_TOKEN", "").strip()
            aisstream_key = os.environ.get("AISSTREAM_API_KEY", "").strip()
            attr_res = run_attribution(
                spill_lat=spill_lat,
                spill_lon=spill_lon,
                detection_time_utc=detection_dt,
                origin_estimate=origin_estimate,
                env_time_series=env_data.get("time_series", []),
                output_dir=job_outputs_dir,
                output_stem=stem,
                gfw_api_token=gfw_token,
                aisstream_api_key=aisstream_key,
                search_window_hours=float(lookback_hours),
            )
            # attr_res is already a JSON-serializable dict (see ais_attribution.py).
            attr_res.pop("json_path", None)
            result["vessel_attribution"] = attr_res
            on_stage(
                "vessel_attribution",
                "success" if attr_res.get("status") == "SUCCESS" else "warning",
                attr_res.get("attribution_statement", "Vessel attribution complete."),
                {
                    "status": attr_res.get("status"),
                    "candidates_evaluated": attr_res.get("candidates_evaluated"),
                    "top_candidate": (attr_res.get("candidates") or [None])[0],
                },
            )
        except Exception as e:
            result["vessel_attribution"] = {"status": "ERROR", "error": str(e)}
            on_stage("vessel_attribution", "error", f"Vessel attribution failed: {e}")

    result["classification_status"] = "Spill Detected"
    result["processing_time_seconds"] = round(time.time() - start_time, 2)
    result["elapsed_seconds"] = result["processing_time_seconds"]
    return result