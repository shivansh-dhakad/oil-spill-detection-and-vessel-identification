"""Segmentation model loading and inference for oil-spill detection.

Architecture: UNet++ (smp.UnetPlusPlus)
Encoder: resnet50 (native smp encoder)
in_channels: 2 (VV + VH SAR bands)
classes: 1 (binary: oil vs background)
activation: None (raw logits out — sigmoid applied in inference)
encoder_depth: 4
decoder_channels: (256, 128, 64, 32)
Format: .safetensors (or .pth)
TTA: hflip + vflip + rot180 + identity, averaged sigmoid probabilities
Post-processing: remove_small_objects(min_size=64) + binary_closing(footprint=disk(2))
"""

from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Optional, Tuple, Dict, List

# Transformers cache migration settings
os.environ.setdefault("HF_HOME", str(Path(__file__).resolve().parent / ".hf_cache"))
os.environ.setdefault("USE_TF", "0")

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F
import cv2

try:
    from safetensors.torch import load_file as load_safetensors_file
    HAS_SAFETENSORS = True
except ImportError:
    HAS_SAFETENSORS = False

try:
    from transformers import SegformerConfig, SegformerForSemanticSegmentation
    HAS_SEGFORMER = True
except ImportError:
    HAS_SEGFORMER = False

try:
    import segmentation_models_pytorch as smp
    HAS_SMP = True
except ImportError:
    HAS_SMP = False

try:
    from skimage.morphology import remove_small_objects, binary_closing, disk
    HAS_SKIMAGE = True
except ImportError:
    HAS_SKIMAGE = False


def build_unetpp_model(
    encoder_name: str = "resnet50",
    in_channels: int = 2,
    classes: int = 1,
    activation: Optional[str] = None,
    encoder_depth: int = 4,
    decoder_channels: Tuple[int, ...] = (256, 128, 64, 32),
    encoder_weights: Optional[str] = None,
) -> nn.Module:
    """Build UNet++ with ResNet-50 encoder matching the exact model architecture specs."""
    if not HAS_SMP:
        raise ImportError(
            "segmentation-models-pytorch is required for UNet++ architecture. "
            "Please run: pip install segmentation-models-pytorch"
        )
    return smp.UnetPlusPlus(
        encoder_name=encoder_name,
        encoder_weights=encoder_weights,
        in_channels=in_channels,
        classes=classes,
        activation=activation,
        encoder_depth=encoder_depth,
        decoder_channels=decoder_channels,
    )


def load_optimal_threshold(model_path: str) -> float:
    """Reads the optimal threshold from threshold_sweep.json -> best_tta.threshold if present,

    otherwise falls back to 0.5.
    """
    model_dir = Path(model_path).parent if os.path.isfile(model_path) else Path(model_path)
    search_dirs = [
        model_dir,
        model_dir.parent,
        Path(__file__).resolve().parent / "models",
        Path(__file__).resolve().parent,
    ]
    for d in search_dirs:
        sweep_file = d / "threshold_sweep.json"
        if sweep_file.is_file():
            try:
                with open(sweep_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if isinstance(data, dict):
                    if "best_tta" in data and isinstance(data["best_tta"], dict) and "threshold" in data["best_tta"]:
                        th = float(data["best_tta"]["threshold"])
                        return th
                    elif "threshold" in data:
                        return float(data["threshold"])
            except Exception:
                pass
    return 0.5


def _clean_state_dict_keys(state_dict: Dict[str, torch.Tensor]) -> Dict[str, torch.Tensor]:
    """Strips common prefix artifacts like 'model.' or 'module.' from state dict keys."""
    cleaned = {}
    for k, v in state_dict.items():
        key = k
        if key.startswith("model."):
            key = key[6:]
        elif key.startswith("module."):
            key = key[7:]
        cleaned[key] = v
    return cleaned


def _match_tensor_channels(model: nn.Module, tensor: torch.Tensor) -> torch.Tensor:
    """Ensures input tensor channel count matches the model's expected in_channels."""
    expected_channels = getattr(model, "_oil_spill_in_channels", None)
    if expected_channels is None:
        if hasattr(model, "encoder") and hasattr(model.encoder, "conv1") and hasattr(model.encoder.conv1, "weight"):
            expected_channels = model.encoder.conv1.weight.shape[1]
        elif hasattr(model, "conv1") and hasattr(model.conv1, "weight"):
            expected_channels = model.conv1.weight.shape[1]
        else:
            expected_channels = tensor.shape[1]

    current_channels = tensor.shape[1]
    if current_channels == expected_channels:
        return tensor

    if expected_channels == 3 and current_channels == 2:
        # Synthesize 3rd channel as mean of first two (VV, VH, (VV+VH)/2)
        b0 = tensor[:, 0:1, :, :]
        b1 = tensor[:, 1:2, :, :]
        b2 = (b0 + b1) / 2.0
        return torch.cat([b0, b1, b2], dim=1)
    elif expected_channels == 2 and current_channels == 3:
        # Take first 2 channels
        return tensor[:, :2, :, :]
    elif expected_channels == 3 and current_channels == 1:
        return torch.cat([tensor, tensor, tensor], dim=1)
    elif expected_channels == 2 and current_channels == 1:
        return torch.cat([tensor, tensor], dim=1)
    elif expected_channels == 1 and current_channels >= 2:
        return tensor[:, :1, :, :]

    return tensor


def _load_safetensors_model(model_path: str, device: torch.device) -> Tuple[nn.Module, Dict[str, Any]]:
    if not HAS_SAFETENSORS:
        raise ImportError("safetensors package is required to load .safetensors files.")

    state_dict = load_safetensors_file(model_path, device="cpu")
    cleaned_state_dict = _clean_state_dict_keys(state_dict)

    # Detect in_channels from first conv weight if present
    in_channels = 2
    for k, v in cleaned_state_dict.items():
        if "conv1.weight" in k or "encoder.conv1.weight" in k:
            if hasattr(v, "shape") and len(v.shape) == 4:
                in_channels = v.shape[1]
                break

    # 1. First try loading as UNet++ ResNet-50 (depth 4, (256, 128, 64, 32))
    try:
        model = build_unetpp_model(
            encoder_name="resnet50",
            in_channels=in_channels,
            classes=1,
            activation=None,
            encoder_depth=4,
            decoder_channels=(256, 128, 64, 32),
            encoder_weights=None,
        )
        try:
            model.load_state_dict(cleaned_state_dict, strict=True)
        except Exception:
            model.load_state_dict(cleaned_state_dict, strict=False)

        model.to(device).eval()
        threshold = load_optimal_threshold(model_path)
        model._oil_spill_model_type = "unetpp"  # type: ignore[attr-defined]
        model._oil_spill_input_size = 512  # type: ignore[attr-defined]
        model._oil_spill_in_channels = in_channels  # type: ignore[attr-defined]
        model._oil_spill_threshold = threshold  # type: ignore[attr-defined]
        model._oil_spill_model_name = f"UNet++ / ResNet50 ({in_channels}-Channel SAR)"  # type: ignore[attr-defined]

        return model, {
            "type": f"UNet++ ResNet50 Safetensors ({in_channels}-Channel)",
            "path": str(Path(model_path).resolve()),
            "in_channels": in_channels,
            "input_size": 512,
            "threshold": threshold,
        }
    except Exception as unet_err:
        # 2. Fallback: check if it's SegFormer
        if HAS_SEGFORMER and any("decode_head" in k or "segformer" in k for k in cleaned_state_dict):
            from transformers import SegformerConfig, SegformerForSemanticSegmentation
            seg_config = SegformerConfig(
                num_channels=3,
                depths=[3, 4, 6, 3],
                sr_ratios=[8, 4, 2, 1],
                hidden_sizes=[64, 128, 320, 512],
                patch_sizes=[7, 3, 3, 3],
                strides=[4, 2, 2, 2],
                num_attention_heads=[1, 2, 5, 8],
                mlp_ratios=[4, 4, 4, 4],
                decoder_hidden_size=768,
                num_labels=2,
            )
            model = SegformerForSemanticSegmentation(seg_config)
            model.load_state_dict(cleaned_state_dict, strict=False)
            model.to(device).eval()
            model._oil_spill_model_type = "segformer"  # type: ignore[attr-defined]
            model._oil_spill_input_size = 512  # type: ignore[attr-defined]
            model._oil_spill_in_channels = 3  # type: ignore[attr-defined]
            model._oil_spill_threshold = 0.5  # type: ignore[attr-defined]
            model._oil_spill_model_name = "SegFormer-B2 Safetensors"  # type: ignore[attr-defined]
            return model, {
                "type": "SegFormer-B2 Safetensors",
                "path": str(Path(model_path).resolve()),
                "in_channels": 3,
                "input_size": 512,
                "threshold": 0.5,
            }
        raise unet_err


def load_model(model_path: str, device: Optional[torch.device] = None) -> Tuple[nn.Module, Dict[str, Any]]:
    """Loads the UNet++ ResNet-50 .safetensors (or legacy .pth) oil spill segmentation model."""
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if not os.path.isfile(model_path):
        raise FileNotFoundError(f"Model file not found: {model_path}")

    if Path(model_path).suffix.lower() == ".safetensors":
        return _load_safetensors_model(model_path, device)

    checkpoint = torch.load(model_path, map_location=device, weights_only=False)
    if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint:
        state_dict = checkpoint["model_state_dict"]
        metadata: Dict[str, Any] = {
            "epoch": checkpoint.get("epoch"),
            "val_iou": checkpoint.get("val_iou"),
            "config": checkpoint.get("config", {}),
            "type": "UNet++ checkpoint",
        }
    elif isinstance(checkpoint, dict):
        state_dict, metadata = checkpoint, {"type": "UNet++ state dictionary"}
    else:
        raise ValueError(f"Unrecognized checkpoint format in: {model_path}")

    cleaned_state_dict = _clean_state_dict_keys(state_dict)

    # Detect in_channels from first conv weight if present
    in_channels = 2
    for k, v in cleaned_state_dict.items():
        if "conv1.weight" in k or "encoder.conv1.weight" in k:
            if hasattr(v, "shape") and len(v.shape) == 4:
                in_channels = v.shape[1]
                break

    # Build UNet++
    encoder_name = "resnet50"
    encoder_depth = 4
    decoder_channels = (256, 128, 64, 32)
    if in_channels == 3 and any("layer4" in k for k in cleaned_state_dict):
        encoder_name = "resnet34"
        encoder_depth = 5
        decoder_channels = (256, 128, 64, 32, 16)

    try:
        model = build_unetpp_model(
            encoder_name=encoder_name,
            in_channels=in_channels,
            classes=1,
            activation=None,
            encoder_depth=encoder_depth,
            decoder_channels=decoder_channels,
            encoder_weights=None,
        )
        model.load_state_dict(cleaned_state_dict, strict=False)
    except Exception:
        # Fallback to standard 5-depth resnet
        model = smp.UnetPlusPlus(encoder_name="resnet50", in_channels=in_channels, classes=1, activation=None)
        model.load_state_dict(cleaned_state_dict, strict=False)

    threshold = load_optimal_threshold(model_path)
    model.to(device).eval()
    model._oil_spill_model_type = "unetpp"  # type: ignore[attr-defined]
    model._oil_spill_input_size = 512  # type: ignore[attr-defined]
    model._oil_spill_in_channels = in_channels  # type: ignore[attr-defined]
    model._oil_spill_threshold = threshold  # type: ignore[attr-defined]
    model._oil_spill_model_name = f"UNet++ / {encoder_name} ({in_channels}-Channel)"  # type: ignore[attr-defined]

    metadata.update({
        "input_size": 512,
        "in_channels": in_channels,
        "threshold": threshold,
    })
    return model, metadata


@torch.no_grad()
def predict_tta(model: nn.Module, tensor: torch.Tensor, device: torch.device) -> np.ndarray:
    """Test-Time Augmentation (TTA):

    Combines identity, horizontal flip, vertical flip, and 180° rotation,
    averaging the inverted sigmoid probabilities.
    """
    model.eval()
    tensor = _match_tensor_channels(model, tensor)
    tensor = tensor.to(device)

    # 1. Identity
    out_id = model(tensor)
    if isinstance(out_id, dict) and "logits" in out_id:
        out_id = out_id["logits"]
    prob_id = torch.sigmoid(out_id)

    # 2. Horizontal Flip
    x_hflip = torch.flip(tensor, dims=[-1])
    out_hflip = model(x_hflip)
    if isinstance(out_hflip, dict) and "logits" in out_hflip:
        out_hflip = out_hflip["logits"]
    prob_hflip = torch.flip(torch.sigmoid(out_hflip), dims=[-1])

    # 3. Vertical Flip
    x_vflip = torch.flip(tensor, dims=[-2])
    out_vflip = model(x_vflip)
    if isinstance(out_vflip, dict) and "logits" in out_vflip:
        out_vflip = out_vflip["logits"]
    prob_vflip = torch.flip(torch.sigmoid(out_vflip), dims=[-2])

    # 4. Rotation 180°
    x_rot180 = torch.rot90(tensor, k=2, dims=[-2, -1])
    out_rot180 = model(x_rot180)
    if isinstance(out_rot180, dict) and "logits" in out_rot180:
        out_rot180 = out_rot180["logits"]
    prob_rot180 = torch.rot90(torch.sigmoid(out_rot180), k=-2, dims=[-2, -1])

    # Average probabilities
    prob_mean = (prob_id + prob_hflip + prob_vflip + prob_rot180) / 4.0
    return prob_mean.squeeze().cpu().numpy().astype(np.float32)


@torch.no_grad()
def predict(
    model: nn.Module,
    tensor: torch.Tensor,
    device: torch.device,
    use_tta: bool = True,
) -> np.ndarray:
    """Return an oil-class probability map at the model input resolution (512x512)."""
    model.eval()
    tensor = _match_tensor_channels(model, tensor)

    if getattr(model, "_oil_spill_model_type", None) == "segformer":
        tensor = tensor.to(device)
        output = model(tensor)
        logits = F.interpolate(output.logits, size=tensor.shape[-2:], mode="bilinear", align_corners=False)
        probabilities = torch.softmax(logits, dim=1)[:, 1]
        return probabilities.squeeze(0).cpu().numpy().astype(np.float32)

    if use_tta:
        return predict_tta(model, tensor, device)

    tensor = tensor.to(device)
    out = model(tensor)
    if isinstance(out, dict) and "logits" in out:
        out = out["logits"]
    prob = torch.sigmoid(out).squeeze().cpu().numpy().astype(np.float32)
    return prob


def apply_morphological_postprocessing(binary_mask: np.ndarray, min_size: int = 64) -> np.ndarray:
    """Applies morphological cleanup:

    1. remove_small_objects(min_size=64)
    2. binary_closing(footprint=disk(5 // 2)) == disk(2)
    """
    mask_bool = binary_mask.astype(bool)

    if HAS_SKIMAGE:
        cleaned_bool = remove_small_objects(mask_bool, min_size=min_size)
        footprint = disk(5 // 2)  # radius 2 disk
        closed_bool = binary_closing(cleaned_bool, footprint=footprint)
        return closed_bool.astype(np.uint8)
    else:
        # Fallback using OpenCV connected components & closing
        num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(
            binary_mask.astype(np.uint8), connectivity=8
        )
        cleaned = np.zeros_like(binary_mask, dtype=np.uint8)
        for label in range(1, num_labels):
            if stats[label, cv2.CC_STAT_AREA] >= min_size:
                cleaned[labels == label] = 1

        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5))
        closed = cv2.morphologyEx(cleaned, cv2.MORPH_CLOSE, kernel)
        return closed.astype(np.uint8)


def interpret_output(
    prob_map: np.ndarray,
    threshold: Optional[float] = None,
    min_spill_pixels: int = 15,
    apply_postprocess: bool = True,
) -> Dict[str, Any]:
    """Convert the oil probability map into a binary segmentation decision with post-processing."""
    if threshold is None:
        threshold = 0.5

    raw_binary = (prob_map >= threshold).astype(np.uint8)
    if apply_postprocess:
        binary_mask = apply_morphological_postprocessing(raw_binary, min_size=64)
    else:
        binary_mask = raw_binary

    oil_pixel_count = int(binary_mask.sum())
    total_pixels = int(prob_map.size)
    spill_coverage = oil_pixel_count / total_pixels * 100.0 if total_pixels else 0.0
    max_prob = float(prob_map.max()) if total_pixels else 0.0
    is_oil = oil_pixel_count >= min_spill_pixels
    spill_probs = prob_map[binary_mask == 1]
    mean_spill_prob = float(spill_probs.mean()) if len(spill_probs) else 0.0
    confidence = ((0.6 * max_prob + 0.4 * mean_spill_prob) if is_oil else (1.0 - max_prob)) * 100.0
    confidence = float(np.clip(confidence, 50.0, 99.99))

    return {
        "is_oil": is_oil,
        "prediction": "OIL SPILL" if is_oil else "NO OIL SPILL",
        "confidence": round(confidence, 2),
        "oil_pixel_count": oil_pixel_count,
        "total_pixels": total_pixels,
        "spill_coverage_percentage": round(spill_coverage, 3),
        "max_probability": round(max_prob, 4),
        "mean_spill_probability": round(mean_spill_prob, 4),
        "threshold_used": threshold,
        "binary_mask_512": binary_mask,
        # Kept for compatibility with existing SAFE localization callers
        "binary_mask_256": binary_mask,
    }