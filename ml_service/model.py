"""Segmentation model loading and inference for oil-spill detection.

The production model is a two-class SegFormer segmentation checkpoint stored
in the safe, non-pickle ``.safetensors`` format. The legacy UNet++ loader is
kept only so existing ``.pth`` deployments do not break unexpectedly.
"""

import os
from pathlib import Path
from typing import Any

# Keep Transformers' one-time cache migration within the project, which also
# makes CLI inference work in restricted desktop/workspace environments.
os.environ.setdefault("HF_HOME", str(Path(__file__).resolve().parent / ".hf_cache"))
# This app is PyTorch-only. Avoid importing an installed TensorFlow runtime just
# because Transformers probes optional backends during module import.
os.environ.setdefault("USE_TF", "0")

import numpy as np
import torch
import torch.nn as nn
import torch.nn.functional as F

try:
    from safetensors.torch import load_file as load_safetensors_file
    from transformers import SegformerConfig, SegformerForSemanticSegmentation
    HAS_SEGFORMER = True
except ImportError:
    HAS_SEGFORMER = False

try:
    import segmentation_models_pytorch as smp
    HAS_SMP = True
except ImportError:
    HAS_SMP = False


# Identified from the supplied checkpoint tensor shapes.
SEGFORMER_B2_CONFIG = {
    "num_channels": 3,
    "depths": [3, 4, 6, 3],
    "sr_ratios": [8, 4, 2, 1],
    "hidden_sizes": [64, 128, 320, 512],
    "patch_sizes": [7, 3, 3, 3],
    "strides": [4, 2, 2, 2],
    "num_attention_heads": [1, 2, 5, 8],
    "mlp_ratios": [4, 4, 4, 4],
    "decoder_hidden_size": 768,
    "num_labels": 2,
}


def build_unetpp_model() -> nn.Module:
    if not HAS_SMP:
        raise ImportError("segmentation-models-pytorch is required for a legacy .pth model.")
    return smp.UnetPlusPlus(
        encoder_name="resnet34", encoder_weights=None,
        in_channels=3, classes=1, activation=None,
    )


def build_segformer_model() -> nn.Module:
    """Build the exact SegFormer-B2 shape required by ``model.safetensors``."""
    if not HAS_SEGFORMER:
        raise ImportError(
            "The .safetensors segmentation model requires transformers and safetensors. "
            "Install the project's requirements first."
        )
    config = SegformerConfig(**SEGFORMER_B2_CONFIG)
    config.id2label = {0: "background", 1: "oil"}
    config.label2id = {"background": 0, "oil": 1}
    return SegformerForSemanticSegmentation(config)


def _load_safetensors_model(model_path: str, device: torch.device) -> tuple[nn.Module, dict[str, Any]]:
    model = build_segformer_model()
    state_dict = load_safetensors_file(model_path, device="cpu")
    incompatible = model.load_state_dict(state_dict, strict=True)
    if incompatible.missing_keys or incompatible.unexpected_keys:
        raise RuntimeError(
            "SegFormer checkpoint does not match the required architecture: "
            f"missing={incompatible.missing_keys}, unexpected={incompatible.unexpected_keys}"
        )
    model.to(device).eval()
    model._oil_spill_model_type = "segformer"  # type: ignore[attr-defined]
    model._oil_spill_input_size = 512  # type: ignore[attr-defined]
    return model, {
        "type": "SegFormer-B2 Safetensors",
        "path": str(Path(model_path).resolve()),
        "oil_class_id": 1,
        "input_size": 512,
    }


def load_model(model_path: str, device: torch.device | None = None) -> tuple[nn.Module, dict[str, Any]]:
    """Load the preferred .safetensors SegFormer model or a legacy .pth model."""
    if device is None:
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    if not os.path.isfile(model_path):
        raise FileNotFoundError(f"Model file not found: {model_path}")

    if Path(model_path).suffix.lower() == ".safetensors":
        return _load_safetensors_model(model_path, device)

    checkpoint = torch.load(model_path, map_location=device, weights_only=False)
    if isinstance(checkpoint, dict) and "model_state_dict" in checkpoint:
        state_dict = checkpoint["model_state_dict"]
        metadata: dict[str, Any] = {
            "epoch": checkpoint.get("epoch"), "val_iou": checkpoint.get("val_iou"),
            "config": checkpoint.get("config", {}), "type": "Legacy UNet++ checkpoint",
        }
    elif isinstance(checkpoint, dict):
        state_dict, metadata = checkpoint, {"type": "Legacy UNet++ state dictionary"}
    else:
        raise ValueError(f"Unrecognized checkpoint format in: {model_path}")
    model = build_unetpp_model()
    model.load_state_dict(state_dict)
    model.to(device).eval()
    model._oil_spill_model_type = "unetpp"  # type: ignore[attr-defined]
    # This UNet++ checkpoint was trained on 256x256 crops (see training notebook /
    # history.json), unlike the 512x512 SegFormer convention — inference must resize
    # to the same resolution or the model sees objects at the wrong scale and the
    # sigmoid output stays below the detection threshold for everything.
    model._oil_spill_input_size = 256  # type: ignore[attr-defined]
    metadata["input_size"] = 256
    return model, metadata


@torch.no_grad()
def predict(model: nn.Module, tensor: torch.Tensor, device: torch.device) -> np.ndarray:
    """Return an oil-class probability map at the model input resolution."""
    model.eval()
    tensor = tensor.to(device)
    output = model(tensor)
    if getattr(model, "_oil_spill_model_type", None) == "segformer":
        logits = F.interpolate(output.logits, size=tensor.shape[-2:], mode="bilinear", align_corners=False)
        probabilities = torch.softmax(logits, dim=1)[:, 1]
    else:
        probabilities = torch.sigmoid(output).squeeze(1)
    return probabilities.squeeze(0).cpu().numpy().astype(np.float32)


def interpret_output(prob_map: np.ndarray, threshold: float = 0.5, min_spill_pixels: int = 15) -> dict[str, Any]:
    """Convert the oil probability map into a binary segmentation decision."""
    binary_mask = (prob_map >= threshold).astype(np.uint8)
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
        # Kept for compatibility with existing SAFE localization callers.
        "binary_mask_256": binary_mask,
    }