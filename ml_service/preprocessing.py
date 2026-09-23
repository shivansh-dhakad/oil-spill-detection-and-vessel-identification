"""preprocessing.py - SAR Image validation, preprocessing, and mask/overlay generation.

Pipeline specifications:
  - Input: dual-polarization Sentinel-1 SAR bands (VV, VH) extracted from SAFE archives
  - Raw float32 read (duplicated to 2-channel if single-band)
  - dB clipping: DB_MIN = -35.0, DB_MAX = 5.0
  - Scaling to uint8: (clipped - DB_MIN) / (DB_MAX - DB_MIN) * 255
  - Resize: IMG_SIZE = (512, 512) with cv2.INTER_AREA
  - Normalization: mean=(0.5, 0.5), std=(0.5, 0.5) -> (pixel/255.0 - 0.5) / 0.5 -> [-1, 1]
  - Tensor shape: (1, 2, 512, 512) float32
  - Ground sampling: PIXEL_SIZE_M = 10.0 (Sentinel-1 GRD)
"""

from __future__ import annotations

import os
from typing import Tuple, Union
import numpy as np
import cv2
import torch

# SAR Preprocessing Parameters matching training
SAR_DB_MIN = -35.0
SAR_DB_MAX = 5.0
TARGET_SIZE = (512, 512)
PIXEL_SIZE_M = 10.0  # Sentinel-1 GRD ground sampling distance in meters

DEFAULT_RESIZE_INTERPOLATION = cv2.INTER_AREA
SAR_RESIZE_INTERPOLATION = cv2.INTER_AREA

def clip_and_scale_sar_bands(
    sar_raw: np.ndarray,
    db_min: float = SAR_DB_MIN,
    db_max: float = SAR_DB_MAX,
) -> np.ndarray:
    """Clips float32 SAR backscatter (in dB) to [db_min, db_max] and scales to uint8 [0, 255]."""
    clipped = np.clip(sar_raw.astype(np.float32), db_min, db_max)
    scaled = (clipped - db_min) / (db_max - db_min) * 255.0
    return np.clip(scaled, 0.0, 255.0).astype(np.uint8)


def sar_bands_to_pseudo_rgb(
    band0_db: np.ndarray,
    band1_db: np.ndarray,
    db_min: float = SAR_DB_MIN,
    db_max: float = SAR_DB_MAX,
) -> np.ndarray:
    """Converts 2 calibrated SAR dB bands into a 3-channel RGB image for visual preview/overlays:

    Channel 0: Band 0 (VV/VH) scaled uint8
    Channel 1: Band 1 (VH/VV) scaled uint8
    Channel 2: Mean of Band 0 and Band 1
    """
    if band0_db.shape != band1_db.shape:
        raise ValueError(f"Band shape mismatch: {band0_db.shape} vs {band1_db.shape}")

    band0_u8 = clip_and_scale_sar_bands(band0_db, db_min, db_max)
    band1_u8 = clip_and_scale_sar_bands(band1_db, db_min, db_max)
    mix_u8 = ((band0_u8.astype(np.float32) + band1_u8.astype(np.float32)) / 2.0).astype(np.uint8)
    return np.stack([band0_u8, band1_u8, mix_u8], axis=-1)


def preprocess_image(
    image_input: Union[np.ndarray, Tuple[np.ndarray, np.ndarray]],
    target_size: Tuple[int, int] = TARGET_SIZE,
    interpolation: int = cv2.INTER_AREA,
) -> torch.Tensor:
    """Preprocesses a 2-band SAR or RGB image for the UNet++ ResNet-50 model.

    Steps:
      1. Extract 2 channels (VV, VH)
      2. Resize to (512, 512) using cv2.INTER_AREA
      3. Normalize: (pixel / 255.0 - 0.5) / 0.5 -> [-1, 1]
      4. To Tensor: (1, 2, 512, 512) float32
    """
    if isinstance(image_input, (tuple, list)):
        # Pair of (band0, band1)
        b0, b1 = image_input[0], image_input[1]
        if b0.dtype != np.uint8:
            b0 = clip_and_scale_sar_bands(b0)
            b1 = clip_and_scale_sar_bands(b1)
        sar_2band = np.stack([b0, b1], axis=-1)
    elif isinstance(image_input, np.ndarray):
        if image_input.ndim == 2:
            sar_2band = np.stack([image_input, image_input], axis=-1)
        elif image_input.ndim == 3:
            if image_input.shape[-1] >= 2:
                sar_2band = image_input[..., :2]
            else:
                sar_2band = np.stack([image_input[..., 0], image_input[..., 0]], axis=-1)
        else:
            raise ValueError(f"Invalid input array shape: {image_input.shape}")
    else:
        raise TypeError(f"Unsupported image_input type: {type(image_input)}")

    # Resize 2-band array to target_size (512, 512) with INTER_AREA
    if sar_2band.shape[:2] != target_size:
        resized = cv2.resize(sar_2band, target_size, interpolation=interpolation)
        if resized.ndim == 2:
            resized = np.stack([resized, resized], axis=-1)
    else:
        resized = sar_2band

    # Normalize: (pixel / 255.0 - 0.5) / 0.5
    normalized = (resized.astype(np.float32) / 255.0 - 0.5) / 0.5

    # Shape: (H, W, 2) -> (2, H, W) -> (1, 2, H, W)
    tensor = torch.from_numpy(normalized.transpose(2, 0, 1)).unsqueeze(0).float()
    return tensor


def generate_mask_and_overlay(
    original_rgb: np.ndarray,
    binary_mask_256: np.ndarray,
    output_dir: str,
    base_name: str,
    overlay_color: Tuple[int, int, int] = (255, 30, 30),  # Red in RGB
    alpha: float = 0.45,
    thumbnail_max_side: int = 900,
) -> Tuple[str, str, str]:
    """Upscales model mask to original image dimensions, creates visual overlay,

    and saves full-resolution and preview thumbnail files.
    """
    os.makedirs(output_dir, exist_ok=True)
    orig_h, orig_w = original_rgb.shape[:2]

    # Resize binary mask to original image dimensions using nearest neighbor interpolation
    full_mask = cv2.resize(
        (binary_mask_256 * 255).astype(np.uint8),
        (orig_w, orig_h),
        interpolation=cv2.INTER_NEAREST,
    )

    mask_filename = f"{base_name}_mask.png"
    mask_path = os.path.join(output_dir, mask_filename)
    cv2.imwrite(mask_path, full_mask)

    has_spill = bool(cv2.countNonZero(full_mask))

    if has_spill:
        color_layer = np.full_like(original_rgb, overlay_color)
        blended = cv2.addWeighted(original_rgb, 1.0 - alpha, color_layer, alpha, 0.0)

        overlay = original_rgb.copy()
        cv2.copyTo(blended, full_mask, overlay)

        # Highlight spill contours in yellow
        contours, _ = cv2.findContours(full_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        overlay_bgr = cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR)
        cv2.drawContours(overlay_bgr, contours, -1, (0, 255, 255), 2)
    else:
        overlay_bgr = cv2.cvtColor(original_rgb, cv2.COLOR_RGB2BGR)

    overlay_filename = f"{base_name}_overlay.png"
    overlay_path = os.path.join(output_dir, overlay_filename)
    cv2.imwrite(overlay_path, overlay_bgr)

    # Downscaled preview thumbnail (JPEG)
    scale = min(1.0, thumbnail_max_side / max(orig_h, orig_w))
    thumb_w, thumb_h = max(1, round(orig_w * scale)), max(1, round(orig_h * scale))
    thumbnail_bgr = cv2.resize(overlay_bgr, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
    thumbnail_filename = f"{base_name}_overlay_thumb.jpg"
    thumbnail_path = os.path.join(output_dir, thumbnail_filename)
    cv2.imwrite(thumbnail_path, thumbnail_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])

    return mask_path, overlay_path, thumbnail_path
