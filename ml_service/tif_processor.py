"""
tif_processor.py - Extracts embedded geolocation (and acquisition timestamp,
where available) directly from a GeoTIFF file, so a plain .tif/.tiff upload
does not require the user to manually type in latitude/longitude/timestamp
the way a non-georeferenced image (.png/.jpg/.bmp) still does.

Only used for the plain-image (non-SAFE) upload path in pipeline.py. SAFE
archives already carry their own, much richer, geolocation via
safe_processor.py and are unaffected by this module.

Handles two distinct georeferencing styles found in the wild:
  1. Standard GeoTIFFs - a regular affine geotransform + CRS
     (src.transform / src.crs).
  2. GCP-referenced GeoTIFFs - no regular transform, instead a sparse set
     of Ground Control Points mapping pixel positions to real-world
     coordinates (src.gcps). This is how Sentinel-1 SAFE archives store
     their measurement/*.tiff rasters, so .tif files produced by simply
     copying those files out of a .SAFE.zip (rather than reprojecting/
     warping them) will only have GCPs, not a normal transform.

Timestamps: a small number of GeoTIFFs carry an acquisition time in a
standard TIFF/EXIF DateTime tag, which is checked first. Sentinel-1
measurement/*.tiff files do NOT carry this - their acquisition time only
lives in the SAFE product's manifest/annotation XML (which a bare copied-
out .tiff no longer has access to) or in the file's own name (Sentinel-1's
naming convention embeds the sensing start/stop time, e.g.
"s1a-iw-grd-vv-20230114t002031-20230114t002056-...tiff"). As a last
resort, the filename is parsed for that pattern.

Never fabricates a coordinate or a time - if none of the above yields a
usable value, the corresponding field simply stays None and the caller
falls back to whatever (if anything) the user supplied manually.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, Optional

logger = logging.getLogger(__name__)

try:
    import rasterio
    from rasterio.warp import transform_bounds
    HAS_RASTERIO = True
except ImportError:
    HAS_RASTERIO = False

try:
    from PIL import Image
    from PIL.ExifTags import TAGS
    HAS_PIL = True
except ImportError:
    HAS_PIL = False


def is_tif_input(file_path: str) -> bool:
    """True for .tif/.tiff file extensions (case-insensitive)."""
    return Path(str(file_path)).suffix.lower() in (".tif", ".tiff")


# Common GDAL/TIFF tag names that carry an acquisition/capture timestamp,
# checked in priority order. Values show up in a variety of formats -
# _parse_any_datetime() below tries a couple of shapes before giving up.
_DATETIME_TAG_CANDIDATES = (
    "TIFFTAG_DATETIME",
    "TIFFTAG_DATETIME_ORIGINAL",
    "ACQUISITIONDATETIME",
    "AcquisitionDateTime",
    "DATETIME",
    "DateTime",
    "DATE_ACQUIRED",
)

# Sentinel-1 (and similarly-named Sentinel product) filenames embed a
# sensing start time as "YYYYMMDDTHHMMSS", e.g.
# "s1a-iw-grd-vv-20230114t002031-20230114t002056-047123-05a72e-001.tiff".
# Matched case-insensitively; the FIRST occurrence in the filename is used,
# which corresponds to the sensing *start* time in the standard naming
# convention (the second is the stop time).
_FILENAME_DATETIME_RE = re.compile(r"(\d{8})t(\d{6})", re.IGNORECASE)


def _parse_any_datetime(raw: str) -> Optional[datetime]:
    if not raw:
        return None
    raw = raw.strip()
    candidates = [raw]
    # TIFF's native DateTime format is "YYYY:MM:DD HH:MM:SS" - normalize the
    # date portion's colons to dashes so fromisoformat() can read it too.
    if len(raw) >= 10 and raw[4] == ":" and raw[7] == ":":
        candidates.append(raw[:4] + "-" + raw[5:7] + "-" + raw[8:])
    for cand in candidates:
        cleaned = cand.strip()
        if cleaned.endswith("Z"):
            cleaned = cleaned[:-1]
        if "T" not in cleaned and " " in cleaned:
            cleaned = cleaned.replace(" ", "T", 1)
        try:
            dt = datetime.fromisoformat(cleaned)
            return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)
        except ValueError:
            continue
    return None


def _extract_timestamp_from_tags(all_tags: Dict[str, Any]) -> Optional[datetime]:
    for key in _DATETIME_TAG_CANDIDATES:
        val = all_tags.get(key)
        if val:
            dt = _parse_any_datetime(str(val))
            if dt:
                return dt
    return None


def _extract_timestamp_via_pil(file_path: str) -> Optional[datetime]:
    """Fallback for EXIF DateTime tags rasterio's driver-level tags() misses
    (rare for GeoTIFFs, but some tif exports carry EXIF instead of/alongside
    GDAL metadata)."""
    if not HAS_PIL:
        return None
    try:
        with Image.open(file_path) as img:
            exif = img.getexif()
            if not exif:
                return None
            for tag_id, value in exif.items():
                tag_name = TAGS.get(tag_id, tag_id)
                if tag_name in ("DateTime", "DateTimeOriginal", "DateTimeDigitized"):
                    dt = _parse_any_datetime(str(value))
                    if dt:
                        return dt
    except Exception as exc:
        logger.info(f"[tif_processor] PIL EXIF read failed: {exc}")
    return None


def _extract_timestamp_from_filename(file_path: str) -> Optional[datetime]:
    """Last-resort fallback: parse a Sentinel-style 'YYYYMMDDTHHMMSS' stamp
    out of the filename itself. Used for measurement/*.tiff files copied
    directly out of a .SAFE archive, which carry no acquisition-time tag of
    their own - only the manifest/annotation XML (not present once the file
    is extracted standalone) or the filename has it."""
    name = Path(str(file_path)).name
    match = _FILENAME_DATETIME_RE.search(name)
    if not match:
        return None
    date_part, time_part = match.group(1), match.group(2)
    try:
        dt = datetime.strptime(date_part + time_part, "%Y%m%d%H%M%S")
        return dt.replace(tzinfo=timezone.utc)
    except ValueError:
        return None


def _centroid_from_gcps(src) -> Optional[Dict[str, Any]]:
    """
    Derives a footprint center + bounds from a GeoTIFF's Ground Control
    Points, for files (like Sentinel-1 SAFE measurement/*.tiff rasters)
    that have no regular affine geotransform and are georeferenced via GCPs
    instead. Returns None if the file has no GCPs.
    """
    try:
        gcps, gcp_crs = src.gcps
    except Exception:
        return None

    if not gcps or gcp_crs is None:
        return None

    xs = [gcp.x for gcp in gcps]
    ys = [gcp.y for gcp in gcps]
    west, east = min(xs), max(xs)
    south, north = min(ys), max(ys)

    try:
        if str(gcp_crs) != "EPSG:4326":
            west, south, east, north = transform_bounds(gcp_crs, "EPSG:4326", west, south, east, north)
    except Exception as exc:
        logger.info(f"[tif_processor] GCP bounds reprojection failed, using raw GCP coords: {exc}")

    center_lat = (south + north) / 2.0
    center_lon = (west + east) / 2.0
    if not (-90.0 <= center_lat <= 90.0 and -180.0 <= center_lon <= 180.0):
        return None

    return {
        "latitude": round(float(center_lat), 6),
        "longitude": round(float(center_lon), 6),
        "bounds_wgs84": (round(west, 6), round(south, 6), round(east, 6), round(north, 6)),
        "crs": str(gcp_crs),
        "num_gcps": len(gcps),
    }


def extract_tif_geo_metadata(file_path: str) -> Dict[str, Any]:
    """
    Reads a .tif/.tiff file's own embedded metadata and returns whatever
    geolocation/timestamp information is actually present.

    Returns:
        {
          "latitude": float | None,
          "longitude": float | None,
          "timestamp": datetime | None,
          "has_geotransform": bool,
          "crs": str | None,
          "bounds_wgs84": (west, south, east, north) | None,
          "georeferencing_method": "transform" | "gcp" | None,
          "note": str,
        }

    latitude/longitude, when present, are the center of the raster's
    footprint in WGS84 - the same "single representative point" convention
    the rest of the pipeline already uses for plain-image uploads (SAFE
    archives get a much richer per-pixel mapping instead, via
    safe_processor.py).
    """
    result: Dict[str, Any] = {
        "latitude": None,
        "longitude": None,
        "timestamp": None,
        "has_geotransform": False,
        "crs": None,
        "bounds_wgs84": None,
        "georeferencing_method": None,
        "note": "No embedded GeoTIFF geolocation found in this file.",
    }

    if not HAS_RASTERIO:
        result["note"] = "rasterio is not installed - cannot read embedded GeoTIFF metadata."
        return result

    try:
        with rasterio.open(file_path) as src:
            has_transform = src.transform is not None and not src.transform.is_identity
            result["has_geotransform"] = bool(has_transform and src.crs is not None)

            if result["has_geotransform"]:
                bounds = src.bounds
                try:
                    west, south, east, north = transform_bounds(
                        src.crs, "EPSG:4326", bounds.left, bounds.bottom, bounds.right, bounds.top
                    )
                except Exception:
                    # Already geographic, or an unusual/unsupported transform - use as-is.
                    west, south, east, north = bounds.left, bounds.bottom, bounds.right, bounds.top

                center_lat = (south + north) / 2.0
                center_lon = (west + east) / 2.0
                if -90.0 <= center_lat <= 90.0 and -180.0 <= center_lon <= 180.0:
                    result["latitude"] = round(float(center_lat), 6)
                    result["longitude"] = round(float(center_lon), 6)
                    result["bounds_wgs84"] = (round(west, 6), round(south, 6), round(east, 6), round(north, 6))
                    result["crs"] = str(src.crs)
                    result["georeferencing_method"] = "transform"
                    result["note"] = (
                        f"Latitude/longitude extracted from the file's embedded GeoTIFF "
                        f"georeferencing (CRS: {src.crs}), using the scene's footprint center."
                    )

            # No regular transform (or it didn't yield a usable center) -
            # fall back to Ground Control Points. This is the normal case
            # for Sentinel-1 SAFE measurement/*.tiff rasters, which are
            # georeferenced via a sparse GCP grid rather than a regular
            # affine transform.
            if result["latitude"] is None:
                gcp_info = _centroid_from_gcps(src)
                if gcp_info:
                    result["latitude"] = gcp_info["latitude"]
                    result["longitude"] = gcp_info["longitude"]
                    result["bounds_wgs84"] = gcp_info["bounds_wgs84"]
                    result["crs"] = gcp_info["crs"]
                    result["has_geotransform"] = True
                    result["georeferencing_method"] = "gcp"
                    result["note"] = (
                        f"Latitude/longitude extracted from {gcp_info['num_gcps']} embedded "
                        f"Ground Control Points (CRS: {gcp_info['crs']}), using the scene's "
                        f"footprint center. This file has no regular geotransform (typical of "
                        f"Sentinel-1 SAFE measurement rasters), so GCPs were used instead."
                    )

            all_tags: Dict[str, Any] = {}
            try:
                all_tags.update(src.tags())
            except Exception:
                pass
            try:
                all_tags.update(src.tags(ns="EXIF"))
            except Exception:
                pass

            ts = _extract_timestamp_from_tags(all_tags)
            if ts is None:
                ts = _extract_timestamp_via_pil(file_path)
            if ts is None:
                ts = _extract_timestamp_from_filename(file_path)
                ts_from_filename = ts is not None
            else:
                ts_from_filename = False

            if ts is not None:
                result["timestamp"] = ts
                ts_note = (
                    "Acquisition timestamp parsed from the filename (Sentinel-style "
                    "YYYYMMDDTHHMMSS pattern)."
                    if ts_from_filename
                    else "Acquisition timestamp read from the file's own metadata."
                )
                if result["latitude"] is not None:
                    result["note"] += f" {ts_note}"
                else:
                    result["note"] = ts_note + " No embedded geolocation found."
    except Exception as exc:
        logger.warning(f"[tif_processor] Failed to read GeoTIFF metadata from {file_path}: {exc}")
        result["note"] = f"Could not read embedded metadata from this file: {exc}"

    return result