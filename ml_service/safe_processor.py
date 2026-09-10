"""
safe_processor.py - Sentinel-1 SAR .SAFE.zip archive discovery, validation,
metadata extraction, SAR measurement reading, preprocessing, and geospatial localization.

Supports:
  - Secure extraction preventing Zip-Slip path traversal attacks
  - Automatic discovery of .SAFE product structures
  - Extraction of acquisition metadata, satellite platform, orbit, and bounds
  - Reading of SAR GRD measurement GeoTIFFs (VV and VH polarizations)
  - Conversion of 16-bit SAR backscatter DNs to 8-bit RGB format matching training
  - Exact geospatial coordinate mapping from segmentation mask to (lat, lon)
  - Automatic cleanup of temporary extracted files
"""

import os
import shutil
import tempfile
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path
from typing import Tuple, List, Dict, Any, Optional
import numpy as np
import cv2
import math

from preprocessing import sar_bands_to_pseudo_rgb

try:
    import rasterio
    HAS_RASTERIO = True
except ImportError:
    HAS_RASTERIO = False


def is_safe_input(file_path: str) -> bool:
    """
    Determines if the given path is a Sentinel-1 .SAFE.zip archive or .SAFE directory.
    """
    path_str = str(file_path).lower()
    if path_str.endswith(".safe.zip") or path_str.endswith(".safe"):
        return True
    
    # Check if a regular .zip contains a .SAFE folder
    if path_str.endswith(".zip") and os.path.isfile(file_path):
        try:
            with zipfile.ZipFile(file_path, 'r') as zf:
                for name in zf.namelist()[:20]:
                    if ".safe" in name.lower():
                        return True
        except Exception:
            return False
            
    return False


def safe_extract_zip(zip_path: str, extract_to: str) -> Path:
    """
    Extracts a zip archive safely, preventing zip-slip path traversal vulnerabilities.
    """
    target_dir = Path(extract_to).resolve()
    target_dir.mkdir(parents=True, exist_ok=True)
    
    with zipfile.ZipFile(zip_path, 'r') as zf:
        for member in zf.infolist():
            # Resolve the target path for each file
            member_path = (target_dir / member.filename).resolve()
            
            # Ensure the resolved path is strictly inside the target directory
            if not str(member_path).startswith(str(target_dir)):
                raise ValueError(f"Security error: Archive member '{member.filename}' attempts path traversal.")
        
        zf.extractall(target_dir)
        
    return target_dir


def find_safe_directory(base_dir: Path) -> Path:
    """
    Finds the root .SAFE directory inside an extracted folder.
    """
    if base_dir.suffix.upper() == ".SAFE" and base_dir.is_dir():
        return base_dir
        
    for p in base_dir.glob("**/*.SAFE"):
        if p.is_dir():
            return p
            
    for p in base_dir.glob("**/*.safe"):
        if p.is_dir():
            return p
            
    raise FileNotFoundError("No valid Sentinel-1 '.SAFE' product directory found in archive.")


def _find_elem(parent: ET.Element, tag_name: str) -> Optional[ET.Element]:
    """Find child element matching tag_name ignoring XML namespaces."""
    res = parent.find(f".//{tag_name}")
    if res is not None:
        return res
    res = parent.find(f".//{{*}}{tag_name}")
    if res is not None:
        return res
    for elem in parent.iter():
        if elem.tag.split("}")[-1] == tag_name:
            return elem
    return None


def _findall_elems(parent: ET.Element, tag_name: str) -> List[ET.Element]:
    """Find all child elements matching tag_name ignoring XML namespaces."""
    res = parent.findall(f".//{{*}}{tag_name}")
    if res:
        return res
    res = parent.findall(f".//{tag_name}")
    if res:
        return res
    return [elem for elem in parent.iter() if elem.tag.split("}")[-1] == tag_name]


def _find_text(elem: ET.Element, tag_name: str, default: str = "") -> str:
    target = _find_elem(elem, tag_name)
    if target is not None and target.text:
        return target.text.strip()
    return default


def parse_safe_metadata(safe_dir: Path) -> dict:
    """
    Extracts acquisition and satellite metadata from manifest.safe and annotation XMLs.
    """
    metadata: Dict[str, Any] = {
        "satellite": "Sentinel-1",
        "product_type": "Unknown",
        "acquisition_start": None,
        "acquisition_stop": None,
        "orbit_number": None,
        "orbit_direction": None,
        "polarizations": [],
        "coordinates": None,
        "gcps": [],
        "parsed_coords": [],
        "range_pixel_spacing_m": None,
        "azimuth_pixel_spacing_m": None,
        "pixel_spacing_source": None,
    }
    
    # 1. Parse manifest.safe
    manifest_path = safe_dir / "manifest.safe"
    if manifest_path.exists():
        try:
            tree = ET.parse(manifest_path)
            root = tree.getroot()
            
            # Extract platform
            platform_elem = _find_elem(root, "familyName")
            number_elem = _find_elem(root, "number")
            if platform_elem is not None and platform_elem.text:
                num = number_elem.text if number_elem is not None else "1"
                metadata["satellite"] = f"{platform_elem.text}-{num}"
            
            # Extract start/stop times
            start_elem = _find_elem(root, "startTime")
            stop_elem = _find_elem(root, "stopTime")
            if start_elem is not None and start_elem.text: metadata["acquisition_start"] = start_elem.text
            if stop_elem is not None and stop_elem.text: metadata["acquisition_stop"] = stop_elem.text
            
            # Extract orbit
            orbit_elem = _find_elem(root, "orbitNumber")
            if orbit_elem is not None and orbit_elem.text: metadata["orbit_number"] = orbit_elem.text
            
            pass_elem = _find_elem(root, "pass")
            if pass_elem is not None and pass_elem.text: metadata["orbit_direction"] = pass_elem.text
            
            # Extract footprint / coordinates
            coords_elem = _find_elem(root, "coordinates")
            if coords_elem is not None and coords_elem.text:
                metadata["coordinates"] = coords_elem.text.strip()
                # Parse coordinate pairs "lat1,lon1 lat2,lon2 ..."
                parsed = []
                for pair in coords_elem.text.strip().split():
                    parts = pair.split(",")
                    if len(parts) >= 2:
                        try:
                            parsed.append((float(parts[0]), float(parts[1])))
                        except ValueError:
                            pass
                metadata["parsed_coords"] = parsed
                
        except Exception as e:
            metadata["manifest_parse_warning"] = str(e)
            
    # 2. Check measurement directory for polarizations and product type
    measurement_dir = safe_dir / "measurement"
    if measurement_dir.exists():
        pols = set()
        for tiff in measurement_dir.glob("*.tiff"):
            stem_lower = tiff.stem.lower()
            if "-vv-" in stem_lower: pols.add("VV")
            elif "-vh-" in stem_lower: pols.add("VH")
            elif "-hh-" in stem_lower: pols.add("HH")
            elif "-hv-" in stem_lower: pols.add("HV")
            if "-grd-" in stem_lower: metadata["product_type"] = "GRD"
            elif "-slc-" in stem_lower: metadata["product_type"] = "SLC"
        metadata["polarizations"] = sorted(list(pols))
        
    # 3. Parse annotation XML for Geolocation Grid Points (GCPs)
    annotation_dir = safe_dir / "annotation"
    if annotation_dir.exists():
        xml_files = list(annotation_dir.glob("*.xml"))
        for xml_file in xml_files:
            try:
                tree = ET.parse(xml_file)
                root = tree.getroot()

                # Native ground pixel spacing straight from the instrument metadata.
                if metadata.get("range_pixel_spacing_m") is None:
                    rng_elem = _find_elem(root, "rangePixelSpacing")
                    azi_elem = _find_elem(root, "azimuthPixelSpacing")
                    if rng_elem is not None and azi_elem is not None and rng_elem.text and azi_elem.text:
                        try:
                            metadata["range_pixel_spacing_m"] = float(rng_elem.text)
                            metadata["azimuth_pixel_spacing_m"] = float(azi_elem.text)
                            metadata["pixel_spacing_source"] = f"annotation XML ({xml_file.name})"
                        except (ValueError, TypeError):
                            pass

                grid_points = _findall_elems(root, "geolocationGridPoint")
                if grid_points:
                    gcps = []
                    for gp in grid_points:
                        try:
                            line = float(_find_text(gp, "line", "0"))
                            pixel = float(_find_text(gp, "pixel", "0"))
                            lat = float(_find_text(gp, "latitude", "0"))
                            lon = float(_find_text(gp, "longitude", "0"))
                            gcps.append({"line": line, "pixel": pixel, "lat": lat, "lon": lon})
                        except (ValueError, TypeError):
                            continue
                    if gcps:
                        metadata["gcps"] = gcps
                        if metadata.get("range_pixel_spacing_m") is not None:
                            break
            except Exception:
                pass
                
    return metadata


def map_pixel_to_geolocation(
    pixel_col: float,
    pixel_line: float,
    image_width: int,
    image_height: int,
    metadata: Dict[str, Any],
) -> Tuple[float, float]:
    """
    Transforms a pixel position (col, line) into geographic (latitude, longitude).
    
    Prefers Annotation XML Geolocation Grid Points (GCPs); falls back to GML polygon interpolation.
    """
    gcps = metadata.get("gcps", [])
    
    # 1. High-precision mapping using Annotation Grid GCPs
    if gcps and len(gcps) >= 4:
        # Inverse-distance weighting (IDW) interpolation using 8 nearest GCPs
        distances = []
        for g in gcps:
            d = math.hypot(g["pixel"] - pixel_col, g["line"] - pixel_line)
            distances.append((d, g["lat"], g["lon"]))
            
        distances.sort(key=lambda x: x[0])
        
        # Exact match check
        if distances[0][0] < 1e-3:
            return distances[0][1], distances[0][2]
            
        # Top-8 nearest grid points
        nearest = distances[:8]
        weights = [1.0 / (d[0] ** 2) for d in nearest]
        total_w = sum(weights)
        
        interp_lat = sum(w * d[1] for w, d in zip(weights, nearest)) / total_w
        interp_lon = sum(w * d[2] for w, d in zip(weights, nearest)) / total_w
        return round(interp_lat, 5), round(interp_lon, 5)

    # 2. Footprint-based bilinear interpolation fallback
    parsed_coords = metadata.get("parsed_coords", [])
    if len(parsed_coords) >= 4:
        # GML footprint vertices: usually Top-Left, Top-Right, Bottom-Right, Bottom-Left
        u = min(1.0, max(0.0, pixel_col / max(1, image_width)))
        v = min(1.0, max(0.0, pixel_line / max(1, image_height)))
        
        p0, p1, p2, p3 = parsed_coords[0], parsed_coords[1], parsed_coords[2], parsed_coords[3]
        
        # Bilinear interpolation
        top_lat = (1.0 - u) * p0[0] + u * p1[0]
        top_lon = (1.0 - u) * p0[1] + u * p1[1]
        bot_lat = (1.0 - u) * p3[0] + u * p2[0]
        bot_lon = (1.0 - u) * p3[1] + u * p2[1]
        
        interp_lat = (1.0 - v) * top_lat + v * bot_lat
        interp_lon = (1.0 - v) * top_lon + v * bot_lon
        return round(interp_lat, 5), round(interp_lon, 5)

    # 3. Center point fallback
    if parsed_coords:
        avg_lat = sum(p[0] for p in parsed_coords) / len(parsed_coords)
        avg_lon = sum(p[1] for p in parsed_coords) / len(parsed_coords)
        return round(avg_lat, 5), round(avg_lon, 5)
        
    return 0.0, 0.0


def extract_spill_centroid_geo(
    binary_mask_256: np.ndarray,
    image_width: int,
    image_height: int,
    metadata: Dict[str, Any],
) -> Dict[str, Any]:
    """
    Computes the spatial centroid and geographic coordinates of the segmented spill.
    """
    # Find positive pixels at the segmentation model's native resolution.
    y_indices, x_indices = np.where(binary_mask_256 > 0)
    mask_height, mask_width = binary_mask_256.shape[:2]
    
    if len(y_indices) == 0:
        # Default to scene center if no spill pixels
        c_x, c_y = image_width / 2.0, image_height / 2.0
    else:
        # Mask centroid in the actual model-output coordinate system.
        mean_y = float(np.mean(y_indices))
        mean_x = float(np.mean(x_indices))
        
        # Scale to original image full resolution
        c_x = (mean_x / max(1, mask_width)) * image_width
        c_y = (mean_y / max(1, mask_height)) * image_height
        
    lat, lon = map_pixel_to_geolocation(c_x, c_y, image_width, image_height, metadata)
    
    return {
        "centroid_pixel_x": round(c_x, 1),
        "centroid_pixel_y": round(c_y, 1),
        "latitude": lat,
        "longitude": lon,
        "formatted_lat": f"{abs(lat):.4f}° {'N' if lat >= 0 else 'S'}",
        "formatted_lon": f"{abs(lon):.4f}° {'E' if lon >= 0 else 'W'}",
    }


def _project_local_km(lat: float, lon: float, ref_lat: float) -> tuple[float, float]:
    """Equirectangular projection, accurate enough for a Sentinel scene footprint."""
    north_km = lat * 110.574
    east_km = lon * 111.320 * math.cos(math.radians(ref_lat))
    return east_km, north_km


def _polygon_area_perimeter_km(points_km: List[Tuple[float, float]]) -> Tuple[float, float]:
    """Shoelace area (km², always non-negative) and perimeter (km) of a closed polygon
    whose vertices are already in local flat (east_km, north_km) coordinates."""
    n = len(points_km)
    if n < 3:
        return 0.0, 0.0
    area = 0.0
    perimeter = 0.0
    for i in range(n):
        x1, y1 = points_km[i]
        x2, y2 = points_km[(i + 1) % n]
        area += x1 * y2 - x2 * y1
        perimeter += math.hypot(x2 - x1, y2 - y1)
    return abs(area) / 2.0, perimeter


def _full_res_contours(
    binary_mask_256: np.ndarray,
    image_width: int,
    image_height: int,
    min_patch_pixels: float = 15.0,
) -> List[np.ndarray]:
    """Upscale the model-resolution mask to full resolution (nearest neighbor,
    matching generate_mask_and_overlay) and extract one external contour per
    contiguous spill patch, dropping speckle-sized fragments.

    Shared by compute_spill_geometry() and extract_spill_polygon_points_geo()
    so area/length stats and the polygon-based ocean seed are always computed
    from the identical patch boundaries -- never two independently-drifting
    notions of "the spill's shape".
    """
    full_mask = cv2.resize(
        (binary_mask_256 * 255).astype(np.uint8),
        (image_width, image_height),
        interpolation=cv2.INTER_NEAREST,
    )
    if not np.any(full_mask):
        return []
    contours, _ = cv2.findContours(full_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    return [c for c in contours if cv2.contourArea(c) >= min_patch_pixels and len(c) >= 3]


def extract_spill_polygon_points_geo(
    binary_mask_256: np.ndarray,
    image_width: int,
    image_height: int,
    metadata: Dict[str, Any],
    min_patch_pixels: float = 15.0,
    vertex_stride: int = 1,
) -> Dict[str, Any]:
    """
    Georeference the spill's own polygon boundary, patch by patch, instead of
    collapsing the whole footprint to one averaged centroid.

    extract_spill_centroid_geo() answers "where is the middle of the spill
    pixels", which is misleading the moment a slick straddles a coastline --
    the centroid can land on dry ground even though most of the oil is on
    water, or vice versa. This function instead returns every contour vertex
    of every spill patch as a real (lat, lon), so a caller can classify each
    one against a landmask and tell exactly which parts of the detected
    footprint are actually over water.

    vertex_stride > 1 subsamples contour vertices (keeps every Nth point) for
    scenes with very dense/noisy contours; it never changes the geometry used
    for area/length elsewhere.

    Returns a dict with:
      - "patches": List[List[Tuple[lat, lon]]] -- polygon vertices per patch.
        Patch order matches cv2.findContours() output, NOT sorted by size --
        use "patch_areas_px" (same order) if the dominant patch matters.
      - "patch_areas_px": List[float] -- pixel-space contour area per patch.
      - "geolocation_source": provenance string, same convention as
        compute_spill_geometry() ("annotation_grid_gcps",
        "footprint_bilinear_interpolation", or "unavailable").
    Empty "patches" means either no oil pixels or no usable geolocation
    source in the metadata -- never a fabricated fallback point.
    """
    result: Dict[str, Any] = {
        "patches": [],
        "patch_areas_px": [],
        "geolocation_source": "unavailable",
    }

    if metadata.get("gcps") and len(metadata["gcps"]) >= 4:
        result["geolocation_source"] = "annotation_grid_gcps"
    elif metadata.get("parsed_coords") and len(metadata["parsed_coords"]) >= 4:
        result["geolocation_source"] = "footprint_bilinear_interpolation"
    else:
        return result  # map_pixel_to_geolocation() would just return (0, 0)

    contours = _full_res_contours(binary_mask_256, image_width, image_height, min_patch_pixels)
    for contour in contours:
        pts_px = contour.reshape(-1, 2)
        if vertex_stride > 1:
            pts_px = pts_px[::vertex_stride]
        patch_points = [
            map_pixel_to_geolocation(float(px), float(py), image_width, image_height, metadata)
            for px, py in pts_px
        ]
        if patch_points:
            result["patches"].append(patch_points)
            result["patch_areas_px"].append(float(cv2.contourArea(contour)))

    return result


def compute_spill_geometry(
    binary_mask_256: np.ndarray,
    image_width: int,
    image_height: int,
    metadata: Dict[str, Any],
    min_patch_pixels: float = 15.0,
) -> Dict[str, Any]:
    """
    Converts the segmentation mask into precisely georeferenced spill geometry
    for reporting to authorities: total area, length, width, perimeter, and an
    area confidence interval.

    Rather than approximating from whole-scene footprint x coverage %, this
    georeferences the spill's *own* boundary pixel-by-pixel using the same
    Annotation-XML Geolocation Grid Points (GCPs) that extract_spill_centroid_geo()
    already uses for the centroid — the standard high-precision Sentinel-1
    geolocation source — falling back to the coarser footprint interpolation only
    if a scene has no GCPs, exactly like map_pixel_to_geolocation() does.

    Method:
      1. Upscale the model-resolution mask to full image resolution (nearest
         neighbor, matching generate_mask_and_overlay) and extract one external
         contour per contiguous spill patch, dropping speckle-sized fragments.
      2. Georeference every contour vertex to (lat, lon) and project it onto a
         local flat East-North plane in km (equirectangular, centered on the
         mask's own centroid) — accurate for a single Sentinel-1 scene footprint.
      3. Sum each patch's shoelace area/perimeter for the totals; take the
         minimum-area rotated bounding rectangle of the *largest* patch — measured
         in the projected km plane, not raw pixels, so real-world distortion and
         rotation are respected — for length/width.
      4. Estimate the area confidence interval with the "perimeter x boundary
         uncertainty" buffer method commonly used for classified-polygon area
         uncertainty in remote sensing (e.g. glacier-outline uncertainty per
         Bolch et al. 2010): the boundary position is uncertain by about one
         *effective* ground pixel, taken as the larger of the native SAR ground
         sampling distance and the upscaled segmentation cell size — whichever
         actually limits how precisely the boundary is known.
      5. Cross-check the polygon area against a second, independent estimate:
         full-resolution oil pixel count x ground area of one native pixel
         (from the Sentinel-1 product's own rangePixelSpacing/azimuthPixelSpacing
         when available, so this figure needs no geolocation projection at all).
         A large gap between the two flags that the polygon figure — and the
         geolocation it depends on — should be treated with suspicion rather
         than reported at face value.

    Returns a dict; every geometry field is None (never fabricated) if the scene
    has no oil pixels or no usable geolocation at all (metadata has neither GCPs
    nor a parsed footprint polygon). Pixel counts and resolutions are populated
    unconditionally since they require no geolocation.
    """
    mask_h, mask_w = binary_mask_256.shape[:2]

    # Pixel counts are computed up front and always reported, even when no
    # geolocation is available — they're the one number in this whole report
    # that requires no projection, no metadata, nothing that can be wrong.
    pixel_count_mask = int(np.count_nonzero(binary_mask_256))

    result: Dict[str, Any] = {
        "area_km2": None,
        "area_confidence_interval_km2": None,
        "length_km": None,
        "width_km": None,
        "perimeter_km": None,
        "num_spill_patches": 0,
        "pixel_ground_size_m": None,
        "geolocation_source": "unavailable",
        # --- pixel-count accounting (always populated) ---
        "pixel_count_mask": pixel_count_mask,
        "mask_resolution": f"{mask_w} x {mask_h}",
        "pixel_count_full_res": 0,
        "full_res_resolution": f"{image_width} x {image_height}",
        # --- independent raster cross-check on the polygon area below ---
        "native_pixel_spacing_m": None,
        "pixel_spacing_source": None,
        "pixel_count_area_km2": None,
        "area_discrepancy_pct": None,
        "area_estimates_consistent": None,
    }

    full_mask = cv2.resize(
        (binary_mask_256 * 255).astype(np.uint8),
        (image_width, image_height),
        interpolation=cv2.INTER_NEAREST,
    )
    pixel_count_full = int(np.count_nonzero(full_mask))
    result["pixel_count_full_res"] = pixel_count_full
    if not np.any(full_mask):
        return result

    contours = _full_res_contours(binary_mask_256, image_width, image_height, min_patch_pixels)
    if not contours:
        return result

    # Be honest about which geolocation source will actually be used — GCPs are
    # much more precise than the whole-scene footprint fallback.
    if metadata.get("gcps") and len(metadata["gcps"]) >= 4:
        result["geolocation_source"] = "annotation_grid_gcps"
    elif metadata.get("parsed_coords") and len(metadata["parsed_coords"]) >= 4:
        result["geolocation_source"] = "footprint_bilinear_interpolation"
    else:
        return result  # map_pixel_to_geolocation() would just return (0, 0) — nothing usable

    def _pixel_to_local_km(px: float, py: float, ref_lat: float) -> Tuple[float, float]:
        lat, lon = map_pixel_to_geolocation(px, py, image_width, image_height, metadata)
        return _project_local_km(lat, lon, ref_lat)

    # Reference point for the local East-North projection: centroid of every
    # spill pixel found (keeps distortion minimal across all patches at once).
    all_pts = np.vstack([c.reshape(-1, 2) for c in contours]).astype(np.float64)
    centroid_px, centroid_py = float(np.mean(all_pts[:, 0])), float(np.mean(all_pts[:, 1]))
    ref_lat, _ = map_pixel_to_geolocation(centroid_px, centroid_py, image_width, image_height, metadata)

    total_area_km2 = 0.0
    total_perimeter_km = 0.0
    largest_area_km2 = -1.0
    largest_contour_px = None
    for contour in contours:
        pts_px = contour.reshape(-1, 2)
        pts_km = [_pixel_to_local_km(float(px), float(py), ref_lat) for px, py in pts_px]
        area_km2, perimeter_km = _polygon_area_perimeter_km(pts_km)
        total_area_km2 += area_km2
        total_perimeter_km += perimeter_km
        if area_km2 > largest_area_km2:
            largest_area_km2 = area_km2
            largest_contour_px = contour

    # Length/width: minimum-area rotated bounding rectangle of the largest
    # patch, measured after projection so it reflects real ground distances.
    rect = cv2.minAreaRect(largest_contour_px)
    box_px = cv2.boxPoints(rect)
    box_km = [_pixel_to_local_km(float(px), float(py), ref_lat) for px, py in box_px]
    side_a = math.hypot(box_km[1][0] - box_km[0][0], box_km[1][1] - box_km[0][1])
    side_b = math.hypot(box_km[2][0] - box_km[1][0], box_km[2][1] - box_km[1][1])
    length_km, width_km = max(side_a, side_b), min(side_a, side_b)

    # Effective ground pixel size at the spill's own location — the larger of
    # the native SAR ground sampling distance and the upscaled segmentation
    # cell size, since the coarser one is what actually limits how precisely
    # the boundary is known.
    center_km = _pixel_to_local_km(centroid_px, centroid_py, ref_lat)
    dx_km = _pixel_to_local_km(centroid_px + 1.0, centroid_py, ref_lat)
    dy_km = _pixel_to_local_km(centroid_px, centroid_py + 1.0, ref_lat)
    native_pixel_km = (
        math.hypot(dx_km[0] - center_km[0], dx_km[1] - center_km[1])
        + math.hypot(dy_km[0] - center_km[0], dy_km[1] - center_km[1])
    ) / 2.0
    upscale_factor = max(image_width / max(1, mask_w), image_height / max(1, mask_h))
    segmentation_cell_km = native_pixel_km * upscale_factor
    effective_pixel_km = max(native_pixel_km, segmentation_cell_km)

    # Standard "buffer method" area uncertainty: perimeter x boundary
    # positional uncertainty (~1 effective pixel), clamped at zero below.
    area_uncertainty_km2 = total_perimeter_km * effective_pixel_km
    ci_low = max(0.0, total_area_km2 - area_uncertainty_km2)
    ci_high = total_area_km2 + area_uncertainty_km2

    # ---- Independent pixel-count cross-check on the polygon area ----
    # The polygon area above depends on every contour vertex being projected
    # through the GCP interpolation — a bug there (bad GCP weighting, a
    # line/pixel axis swap, etc.) inflates *every* vertex and the shoelace
    # total right along with it. Multiplying the raw full-resolution pixel
    # count by the ground area of a single pixel is a completely different,
    # much harder-to-get-wrong calculation, so a large gap between the two
    # is the signal to distrust the polygon figure rather than report it.
    range_sp = metadata.get("range_pixel_spacing_m")
    azimuth_sp = metadata.get("azimuth_pixel_spacing_m")
    if range_sp and azimuth_sp:
        # Straight from the Sentinel-1 product metadata — no projection involved.
        native_pixel_area_km2 = (range_sp / 1000.0) * (azimuth_sp / 1000.0)
        pixel_spacing_source = metadata.get("pixel_spacing_source") or "product metadata"
        native_pixel_spacing_m = [round(range_sp, 3), round(azimuth_sp, 3)]
    else:
        # No instrument metadata found — fall back to the parallelogram area of
        # the same 1-pixel east/north step vectors used for the CI term above.
        # (This shares the GCP projection with the polygon area, so it's a
        # weaker cross-check than the metadata-based one.)
        vx = (dx_km[0] - center_km[0], dx_km[1] - center_km[1])
        vy = (dy_km[0] - center_km[0], dy_km[1] - center_km[1])
        native_pixel_area_km2 = abs(vx[0] * vy[1] - vx[1] * vy[0])
        pixel_spacing_source = "derived from geolocation grid (no instrument pixel spacing found)"
        native_pixel_spacing_m = [round(native_pixel_km * 1000.0, 3)] * 2

    pixel_count_area_km2 = pixel_count_full * native_pixel_area_km2
    area_discrepancy_pct = None
    area_estimates_consistent = None
    if pixel_count_area_km2 > 0:
        area_discrepancy_pct = abs(total_area_km2 - pixel_count_area_km2) / pixel_count_area_km2 * 100.0
        area_estimates_consistent = bool(area_discrepancy_pct <= 25.0)

    result.update({
        "area_km2": round(total_area_km2, 5),
        "area_confidence_interval_km2": [round(ci_low, 5), round(ci_high, 5)],
        "length_km": round(length_km, 4),
        "width_km": round(width_km, 4),
        "perimeter_km": round(total_perimeter_km, 4),
        "num_spill_patches": len(contours),
        "pixel_ground_size_m": round(effective_pixel_km * 1000.0, 2),
        "native_pixel_spacing_m": native_pixel_spacing_m,
        "pixel_spacing_source": pixel_spacing_source,
        "pixel_count_area_km2": round(pixel_count_area_km2, 5),
        "area_discrepancy_pct": round(area_discrepancy_pct, 1) if area_discrepancy_pct is not None else None,
        "area_estimates_consistent": area_estimates_consistent,
    })
    return result


def _find_calibration_file(safe_dir: Path, polarization: str) -> Optional[Path]:
    """Locates the calibration annotation XML for a given polarization,
    e.g. annotation/calibration/calibration-s1a-iw-grd-vv-....xml."""
    cal_dir = safe_dir / "annotation" / "calibration"
    if not cal_dir.exists():
        return None
    pol_tag = f"-{polarization.lower()}-"
    for cand in cal_dir.glob("calibration-*.xml"):
        if pol_tag in cand.stem.lower():
            return cand
    return None


def _parse_calibration_lut(cal_xml_path: Path) -> tuple[np.ndarray, np.ndarray]:
    """
    Parses a Sentinel-1 calibration annotation XML's <calibrationVectorList>
    into a coarse (line x pixel) grid of sigmaNought calibration constants.

    Each <calibrationVector> gives one azimuth "line" plus a row of
    sigmaNought values sampled at the *same* range-pixel positions across
    every vector (standard for S1 GRD products) - so stacking those rows
    gives a regular 2D grid we can upsample to full resolution.

    Returns:
        lines (np.ndarray, shape (N,)): unused directly (kept for clarity/
            debugging) - the grid is treated as regularly spaced when
            resizing, which matches how these vectors are actually sampled.
        sigma_grid (np.ndarray, shape (N, M), float32): sigmaNought LUT.
    """
    tree = ET.parse(cal_xml_path)
    root = tree.getroot()
    vectors = root.findall(".//calibrationVector")
    if not vectors:
        raise ValueError(f"No calibrationVector entries found in {cal_xml_path}")

    lines: List[float] = []
    rows: List[np.ndarray] = []
    for vec in vectors:
        line_val = float(vec.findtext("line", "0"))
        sigma_text = vec.findtext("sigmaNought", "")
        sigma_vals = np.array([float(x) for x in sigma_text.split()], dtype=np.float32)
        lines.append(line_val)
        rows.append(sigma_vals)

    # All rows should be the same length (same pixel sampling per vector);
    # if a product ever varies, trim to the shortest row rather than fail.
    min_len = min(len(r) for r in rows)
    sigma_grid = np.vstack([r[:min_len] for r in rows])
    return np.array(lines, dtype=np.float32), sigma_grid


def calibrate_to_sigma0_db(
    raw_dn: np.ndarray,
    safe_dir: Path,
    polarization: str,
) -> tuple[np.ndarray, bool]:
    """
    Converts raw Sentinel-1 GRD digital numbers (DN) to calibrated sigma0
    backscatter in decibels - the ESA-standard formula:

        sigma0 = (DN / A)^2   =>   sigma0_dB = 20*log10(DN) - 20*log10(A)

    where A is the sigmaNought calibration constant, bilinearly upsampled
    from the coarse calibration-annotation LUT grid to every pixel of the
    full-resolution measurement raster (bilinear interpolation of these
    LUTs is the standard/ESA-recommended approach, e.g. as implemented in
    SNAP's Sigma0 calibration).

    This step is what makes a live-uploaded, raw .SAFE product comparable
    to the Zenodo training tiffs, which already store calibrated sigma0-dB
    values - without it, raw DN values (unbounded integers, not dB) would
    be clipped against [DB_MIN, DB_MAX] meaninglessly.

    Returns:
        sigma0_db (np.ndarray, float32, same shape as raw_dn)
        calibrated (bool): False if no calibration annotation file could be
            found for this polarization, in which case sigma0_db falls back
            to an uncalibrated dB-like proxy (20*log10(DN)) so the pipeline
            doesn't crash - but this will NOT match the training
            distribution, so callers must record this in their metadata/
            result rather than silently reporting it as calibrated.
    """
    h, w = raw_dn.shape[:2]
    dn_safe = np.clip(raw_dn.astype(np.float64), 1e-6, None)

    cal_path = _find_calibration_file(safe_dir, polarization)
    if cal_path is None:
        return (20.0 * np.log10(dn_safe)).astype(np.float32), False

    try:
        _, sigma_grid = _parse_calibration_lut(cal_path)
        sigma_full = cv2.resize(sigma_grid, (w, h), interpolation=cv2.INTER_LINEAR)
        sigma_full = np.clip(sigma_full.astype(np.float64), 1e-6, None)
        sigma0_db = 20.0 * np.log10(dn_safe) - 20.0 * np.log10(sigma_full)
        return sigma0_db.astype(np.float32), True
    except Exception:
        # Malformed/unexpected calibration XML - degrade the same way as
        # "no calibration file found" rather than raise mid-pipeline.
        return (20.0 * np.log10(dn_safe)).astype(np.float32), False


def _read_raw_measurement(path: Path) -> np.ndarray:
    """Reads a single-band SAR measurement GeoTIFF as raw digital numbers."""
    raw = None
    if HAS_RASTERIO:
        try:
            with rasterio.open(str(path)) as src:
                raw = src.read(1)
        except Exception:
            raw = None
    if raw is None:
        raw = cv2.imread(str(path), cv2.IMREAD_UNCHANGED)
    if raw is None:
        raise ValueError(f"Unable to read SAR measurement file: {path}")
    return raw.astype(np.float32)


def read_dual_pol_measurements(safe_dir: Path) -> tuple[np.ndarray, np.ndarray, dict]:
    """
    Reads and radiometrically calibrates BOTH the VV and VH measurement
    rasters from a Sentinel-1 GRD SAFE product - matching the two-band
    input the UNet++ model was trained on. Note the training tiffs' band
    order is VH (channel 0), VV (channel 1) - confirmed from a real
    training sample's embedded DIMAP metadata, and the opposite of what
    the training notebook's "vv"/"vh" variable names suggest. This
    function returns (vv_db, vh_db) by physical polarization regardless -
    callers (see process_safe_archive) are responsible for passing them to
    sar_bands_to_pseudo_rgb in the matching band0=VH, band1=VV order.

    If a product is single-polarization (no separate VH file, e.g. some
    HH-only acquisitions), the one available band is duplicated into both
    channels rather than failing - this is noted in the returned info dict
    so it's visible in the final result rather than silently assumed.

    Returns:
        vv_db, vh_db (np.ndarray, float32, HxW): calibrated sigma0 in dB.
        info (dict): calibration/polarization provenance for the metadata.
    """
    measurement_dir = safe_dir / "measurement"
    if not measurement_dir.exists():
        raise FileNotFoundError(f"Missing 'measurement' directory in: {safe_dir}")

    tiff_files = list(measurement_dir.glob("*.tiff")) + list(measurement_dir.glob("*.tif"))
    if not tiff_files:
        raise FileNotFoundError(f"No SAR measurement GeoTIFF files found in {measurement_dir}")

    vv_file = next((t for t in tiff_files if "-vv-" in t.stem.lower()), None)
    vh_file = next((t for t in tiff_files if "-vh-" in t.stem.lower()), None)

    info: Dict[str, Any] = {}

    if vv_file is None and vh_file is None:
        # No VV/VH-labeled files at all (e.g. HH-only product) - use
        # whichever single band exists for both channels.
        fallback_pol = "hh" if any("-hh-" in t.stem.lower() for t in tiff_files) else "vv"
        raw = _read_raw_measurement(tiff_files[0])
        db, calibrated = calibrate_to_sigma0_db(raw, safe_dir, fallback_pol)
        info.update({
            "vv_calibrated": calibrated, "vh_calibrated": calibrated,
            "vh_source": "single_polarization_duplicated",
            "polarizations_found": [fallback_pol.upper()],
        })
        return db, db.copy(), info

    vv_db = vh_db = None
    vv_cal = vh_cal = False
    if vv_file is not None:
        vv_db, vv_cal = calibrate_to_sigma0_db(_read_raw_measurement(vv_file), safe_dir, "vv")
    if vh_file is not None:
        vh_db, vh_cal = calibrate_to_sigma0_db(_read_raw_measurement(vh_file), safe_dir, "vh")

    if vv_db is None:
        vv_db, vv_cal = vh_db.copy(), vh_cal
        info["vh_source"] = "vv_missing_duplicated_from_vh"
    elif vh_db is None:
        vh_db, vh_cal = vv_db.copy(), vv_cal
        info["vh_source"] = "vh_missing_duplicated_from_vv"
    else:
        info["vh_source"] = "vh"

    info["vv_calibrated"] = vv_cal
    info["vh_calibrated"] = vh_cal
    info["polarizations_found"] = sorted(
        p for p, f in (("VV", vv_file), ("VH", vh_file)) if f is not None
    )
    return vv_db, vh_db, info


def process_safe_archive(
    safe_path: str,
    target_polarization: str = "VV",
) -> tuple[np.ndarray, tuple[int, int], dict]:
    """
    Full pipeline to unpack a Sentinel-1 .SAFE.zip archive, extract metadata,
    radiometrically calibrate the VV and VH SAR measurements to sigma0 dB,
    and build the exact 2-band-SAR pseudo-RGB representation the UNet++
    model was trained on (see sar_bands_to_pseudo_rgb / sar_tiff_to_array
    in the training notebook) - R=VV, G=VH, B=mean(VV, VH), each dB-clipped
    and rescaled to [0, 255].

    `target_polarization` is kept for backward-compatible call signatures
    but is no longer used to pick a single band - both VV and VH are always
    read now, matching training.

    Returns:
        rgb_image (np.ndarray): HxWx3 uint8 array, full input resolution
            (resize to the model's input size happens later in the
            pipeline via preprocessing.preprocess_image, using
            preprocessing.SAR_RESIZE_INTERPOLATION to match training).
        original_shape (tuple): (height, width)
        metadata (dict): extracted metadata, plus calibration/polarization
            provenance (vv_calibrated, vh_calibrated, vh_source,
            polarizations_found) so an uncalibrated fallback is visible
            in the result rather than silently passed off as a real match.
    """
    if not os.path.exists(safe_path):
        raise FileNotFoundError(f"SAFE archive file not found: {safe_path}")
        
    temp_dir = tempfile.mkdtemp(prefix="s1_safe_")
    try:
        if os.path.isfile(safe_path) and (safe_path.lower().endswith(".zip") or safe_path.lower().endswith(".safe.zip")):
            extracted_path = safe_extract_zip(safe_path, temp_dir)
            safe_dir = find_safe_directory(extracted_path)
        elif os.path.isdir(safe_path):
            safe_dir = find_safe_directory(Path(safe_path))
        else:
            raise ValueError(f"Provided path is not a valid SAFE archive or folder: {safe_path}")
            
        metadata = parse_safe_metadata(safe_dir)
        vv_db, vh_db, cal_info = read_dual_pol_measurements(safe_dir)
        metadata.update(cal_info)
        pols_found = cal_info.get("polarizations_found", [])
        metadata["polarization_used"] = "+".join(pols_found) if pols_found else "unknown"

        orig_h, orig_w = vv_db.shape[:2]
        metadata["dimensions"] = f"{orig_w} x {orig_h}"
        metadata["width"] = orig_w
        metadata["height"] = orig_h

        rgb_image = sar_bands_to_pseudo_rgb(vh_db, vv_db)  # band order matches
        # training tiff channel 0/1 (confirmed VH/VV from DIMAP metadata on
        # a real training sample) - NOT vv_db/vh_db despite the training
        # notebook's variable names; see sar_bands_to_pseudo_rgb's docstring.

        return rgb_image, (orig_h, orig_w), metadata
        
    finally:
        # Secure cleanup of temporary extraction directory
        if os.path.exists(temp_dir):
            try:
                shutil.rmtree(temp_dir, ignore_errors=True)
            except Exception:
                pass