"""
preprocessing.py - Image validation, preprocessing, and mask/overlay generation.

Preprocessing:
  - Input: 3-channel RGB image
  - Resize: to the loaded model's trained resolution (512x512 for the
    SegFormer-B2 .safetensors model, 256x256 for the legacy UNet++ .pth
    model) - see model.py's `_oil_spill_input_size` on the loaded model.
  - Normalization: ImageNet mean=(0.485, 0.456, 0.406), std=(0.229, 0.224, 0.225)
"""

import os
from pathlib import Path
import numpy as np
import cv2
import torch
from PIL import Image

try:
    import albumentations as A
    from albumentations.pytorch import ToTensorV2
    HAS_ALBUMENTATIONS = True
except ImportError:
    HAS_ALBUMENTATIONS = False

# Exact normalization values from training config
IMAGENET_MEAN = (0.485, 0.456, 0.406)
IMAGENET_STD = (0.229, 0.224, 0.225)
# Default kept for backward compatibility (SegFormer-B2's 512px convention).
# Always pass the loaded model's actual input size explicitly where possible -
# see `_oil_spill_input_size` set on the model object in model.py.
TARGET_SIZE = (512, 512)
SUPPORTED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}

# --- SAR (Sentinel-1 VV/VH) preprocessing, matching the legacy UNet++ training ---
#
# Pulled directly from unetpp_best.pth's saved "config" dict (the training
# notebook writes CFG.__dict__ into every checkpoint) - not guessed:
#   IMG_SIZE=256, DB_MIN=-35.0, DB_MAX=5.0
# See sar_tiff_to_array() in the training notebook for the exact reference
# implementation this mirrors.
SAR_DB_MIN = -35.0
SAR_DB_MAX = 5.0

# Training resized the already dB-normalized pseudo-RGB image with
# cv2.resize(..., interpolation=cv2.INTER_AREA). Plain (non-SAR) images use
# the pre-existing INTER_LINEAR default so that path is unaffected.
DEFAULT_RESIZE_INTERPOLATION = cv2.INTER_LINEAR
SAR_RESIZE_INTERPOLATION = cv2.INTER_AREA


def sar_bands_to_pseudo_rgb(
    band0_db: np.ndarray,
    band1_db: np.ndarray,
    db_min: float = SAR_DB_MIN,
    db_max: float = SAR_DB_MAX,
) -> np.ndarray:
    """
    Reproduces sar_tiff_to_array() from the training notebook exactly:
    each band (calibrated sigma0 backscatter, in decibels) is clipped to
    [db_min, db_max] and linearly rescaled to [0, 255]; a third pseudo-
    channel is the mean of the two normalized bands - giving the same
    3-channel "RGB" representation the UNet++ checkpoint was trained on.

    IMPORTANT - band0/band1 are POSITIONAL, matching the Zenodo training
    tiff's channel order, not physical polarization labels. The training
    code names these "vv"/"vh" (arr[...,0]/arr[...,1]) but inspecting an
    actual training tiff's embedded DIMAP metadata shows:
        BAND_INDEX 0 -> Sigma0_VH_db
        BAND_INDEX 1 -> Sigma0_VV_db
    i.e. the training code's variable names are swapped from the real
    polarization - band0 is actually VH, band1 is actually VV. Since the
    model was trained consistently on that (mislabeled but consistent)
    order, callers building this from a real Sentinel-1 SAFE product must
    pass VH first and VV second to match, not the "obvious" VV-then-VH
    order the variable names would suggest. See safe_processor.py's
    process_safe_archive for the corresponding call.

    Args:
        band0_db, band1_db: HxW float arrays of calibrated sigma0
            backscatter in decibels (same convention as the Zenodo
            training tiffs) - band0 corresponds to channel 0 of those
            tiffs (VH), band1 to channel 1 (VV).

    Returns:
        HxWx3 uint8 array at the SAME resolution as the input bands (NOT
        yet resized to the model's 256x256 input). Callers should resize
        this later with SAR_RESIZE_INTERPOLATION (see preprocess_image) so
        the identical rgb_image can also drive the full-resolution overlay.
    """
    if band0_db.shape != band1_db.shape:
        raise ValueError(f"Band shape mismatch: {band0_db.shape} vs {band1_db.shape}")

    def _norm(band: np.ndarray) -> np.ndarray:
        clipped = np.clip(band, db_min, db_max)
        return ((clipped - db_min) / (db_max - db_min) * 255.0).astype(np.uint8)

    band0_n = _norm(band0_db)
    band1_n = _norm(band1_db)
    mix = ((band0_n.astype(np.float32) + band1_n.astype(np.float32)) / 2).astype(np.uint8)
    return np.stack([band0_n, band1_n, mix], axis=-1)


def get_inference_transforms(
    target_size: tuple[int, int] = TARGET_SIZE,
    interpolation: int = DEFAULT_RESIZE_INTERPOLATION,
):
    """
    Returns the albumentations validation transform matching training.

    `interpolation` matters for exact reproduction: the SAR/UNet++ training
    path resized with cv2.INTER_AREA (see SAR_RESIZE_INTERPOLATION), which
    differs from this function's default. Pass SAR_RESIZE_INTERPOLATION
    whenever rgb_image came from sar_bands_to_pseudo_rgb.
    """
    if HAS_ALBUMENTATIONS:
        return A.Compose([
            A.Resize(target_size[0], target_size[1], interpolation=interpolation),
            A.Normalize(mean=IMAGENET_MEAN, std=IMAGENET_STD),
            ToTensorV2(),
        ])
    return None


def load_and_validate_image(image_path: str) -> tuple[np.ndarray, tuple[int, int]]:
    """
    Loads an image file, validates its format and integrity, and converts it to RGB.
    
    Args:
        image_path: Path to the image file.
        
    Returns:
        rgb_image (np.ndarray): HxWx3 uint8 numpy array in RGB color space.
        original_shape (tuple): (height, width) of the original image.
    """
    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"Image file not found: {image_path}")
    
    if path.suffix.lower() not in SUPPORTED_EXTENSIONS:
        raise ValueError(
            f"Unsupported image extension '{path.suffix}'. "
            f"Supported extensions are: {', '.join(sorted(SUPPORTED_EXTENSIONS))}"
        )
    
    img_bgr = cv2.imread(str(path), cv2.IMREAD_COLOR)
    
    if img_bgr is None:
        # Fallback to PIL (handles multi-page TIFFs or specific colour profiles)
        try:
            with Image.open(str(path)) as pil_img:
                pil_img = pil_img.convert("RGB")
                rgb_image = np.array(pil_img, dtype=np.uint8)
        except Exception as e:
            raise ValueError(f"Failed to read image '{image_path}'. File may be corrupted or invalid: {e}")
    else:
        rgb_image = cv2.cvtColor(img_bgr, cv2.COLOR_BGR2RGB)
    
    if rgb_image.ndim != 3 or rgb_image.shape[2] != 3:
        raise ValueError(f"Expected 3-channel RGB image, got shape {rgb_image.shape}")
    
    orig_h, orig_w = rgb_image.shape[:2]
    return rgb_image, (orig_h, orig_w)


def preprocess_image(
    rgb_image: np.ndarray,
    target_size: tuple[int, int] = TARGET_SIZE,
    interpolation: int = DEFAULT_RESIZE_INTERPOLATION,
) -> torch.Tensor:
    """
    Applies the validation/inference preprocessing to an RGB image.
    
    Args:
        rgb_image: HxWx3 uint8 numpy array in RGB space.
        target_size: (height, width) to resize to before normalizing - MUST
            match the loaded model's trained resolution (see
            `_oil_spill_input_size` set on the model object in model.py),
            otherwise objects appear at the wrong scale and the model's
            output silently degrades (e.g. UNet++/256 fed a 512px image).
        interpolation: cv2 resize flag. Pass SAR_RESIZE_INTERPOLATION
            (INTER_AREA) when rgb_image came from sar_bands_to_pseudo_rgb /
            a .SAFE.zip upload, to exactly match training's resize step.
            Defaults to DEFAULT_RESIZE_INTERPOLATION (INTER_LINEAR) for
            plain-image inputs, unchanged from before.
        
    Returns:
        torch.Tensor of shape (1, 3, target_size[0], target_size[1]), dtype=float32, normalized.
    """
    tfm = get_inference_transforms(target_size, interpolation)
    
    if tfm is not None:
        augmented = tfm(image=rgb_image)
        tensor = augmented["image"].unsqueeze(0).float()
    else:
        # Pure numpy/OpenCV fallback if albumentations is not available
        resized = cv2.resize(rgb_image, target_size, interpolation=interpolation)
        normalized = resized.astype(np.float32) / 255.0
        mean = np.array(IMAGENET_MEAN, dtype=np.float32)
        std = np.array(IMAGENET_STD, dtype=np.float32)
        normalized = (normalized - mean) / std
        tensor = torch.from_numpy(normalized.transpose(2, 0, 1)).unsqueeze(0).float()
    
    return tensor


def generate_mask_and_overlay(
    original_rgb: np.ndarray,
    binary_mask_256: np.ndarray,
    output_dir: str,
    base_name: str,
    overlay_color: tuple[int, int, int] = (255, 30, 30),  # Bright Red in RGB
    alpha: float = 0.45,
    thumbnail_max_side: int = 900,
) -> tuple[str, str, str]:
    """
    Upscales the model-resolution binary mask to the original image dimensions,
    creates a color-blended overlay showing the detected oil spill,
    and saves both files to the output directory - plus a downscaled
    thumbnail of the overlay for fast display in the frontend.
    
    Args:
        original_rgb: HxWx3 uint8 numpy array (original image).
        binary_mask_256: 256x256 uint8 array with values in {0, 1}.
        output_dir: Directory where mask and overlay should be saved.
        base_name: Base stem for output filenames.
        overlay_color: RGB tuple for highlighting oil regions.
        alpha: Transparency factor for overlay blend.
        thumbnail_max_side: Longest edge (px) of the thumbnail. Full Sentinel-1
            scenes can be tens of thousands of pixels per side, which made the
            frontend's small results-page preview download and decode the
            entire full-resolution PNG just to show a ~100px thumbnail. The
            full-resolution overlay is still saved (and still linked for
            "open full-resolution") - this is a small additional file made
            just for fast previewing.
        
    Returns:
        mask_path (str): File path of saved binary mask.
        overlay_path (str): File path of saved full-resolution visual overlay.
        thumbnail_path (str): File path of the downscaled overlay thumbnail.
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
        # Build a solid-color layer the same size as the image and alpha-blend
        # it against the ORIGINAL image using OpenCV's C-level addWeighted.
        # (We deliberately avoid numpy boolean fancy-indexing like
        # `original_rgb[mask > 0]` here: on large images that forces numpy to
        # materialize a full int64 index array over every masked pixel, which
        # is what was causing the multi-GB allocation failure.)
        color_layer = np.full_like(original_rgb, overlay_color)
        blended = cv2.addWeighted(original_rgb, 1.0 - alpha, color_layer, alpha, 0.0)

        # Keep the blended pixels only where the mask is set. cv2.copyTo does
        # this masked copy natively in OpenCV instead of numpy indexing.
        overlay = original_rgb.copy()
        cv2.copyTo(blended, full_mask, overlay)

        # Add contours around spill boundaries for clear visual contrast
        contours, _ = cv2.findContours(full_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        overlay_bgr = cv2.cvtColor(overlay, cv2.COLOR_RGB2BGR)  # cv2.imwrite expects BGR
        cv2.drawContours(overlay_bgr, contours, -1, (0, 255, 255), 2)  # Yellow border
    else:
        overlay_bgr = cv2.cvtColor(original_rgb, cv2.COLOR_RGB2BGR)
    
    overlay_filename = f"{base_name}_overlay.png"
    overlay_path = os.path.join(output_dir, overlay_filename)
    cv2.imwrite(overlay_path, overlay_bgr)

    # Downscaled thumbnail (JPEG - no need for lossless PNG at preview size,
    # and it's a fraction of the overlay's file size).
    scale = min(1.0, thumbnail_max_side / max(orig_h, orig_w))
    thumb_w, thumb_h = max(1, round(orig_w * scale)), max(1, round(orig_h * scale))
    thumbnail_bgr = cv2.resize(overlay_bgr, (thumb_w, thumb_h), interpolation=cv2.INTER_AREA)
    thumbnail_filename = f"{base_name}_overlay_thumb.jpg"
    thumbnail_path = os.path.join(output_dir, thumbnail_filename)
    cv2.imwrite(thumbnail_path, thumbnail_bgr, [cv2.IMWRITE_JPEG_QUALITY, 85])

    return mask_path, overlay_path, thumbnail_path