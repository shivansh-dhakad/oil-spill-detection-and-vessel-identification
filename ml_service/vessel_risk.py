"""Isolation-Forest vessel anomaly scoring for the attribution stage."""

import json
import math
from pathlib import Path
from typing import Any, Dict, List, Optional

import joblib
import numpy as np


FEATURE_NAMES = [
    "observation_count", "min_distance_km", "avg_distance_km",
    "min_time_difference_hours", "avg_time_difference_hours",
    "avg_speed", "max_speed", "heading_variation",
]


def _haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi, dlambda = math.radians(lat2 - lat1), math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return 6371.0 * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _heading_variation(headings: List[float]) -> float:
    if len(headings) < 2:
        return 0.0
    diffs = [abs((b - a + 180) % 360 - 180) for a, b in zip(headings, headings[1:])]
    return float(np.mean(diffs)) if diffs else 0.0


def build_features(vessel_info: Dict[str, Any], origin_lat: Optional[float], origin_lon: Optional[float], start_time: Any) -> Optional[Dict[str, float]]:
    """Build the exact eight model features from real positional AIS observations."""
    observations = vessel_info.get("observations") or []
    if not observations or origin_lat is None or origin_lon is None or start_time is None:
        return None
    distances = [_haversine_km(o["latitude"], o["longitude"], origin_lat, origin_lon) for o in observations]
    time_diffs = [abs((o["timestamp"] - start_time).total_seconds()) / 3600.0 for o in observations]
    speeds = [float(o["sog"]) for o in observations if o.get("sog") is not None]
    headings = [float(o["cog"]) for o in observations if o.get("cog") is not None]
    return {
        "observation_count": float(len(observations)),
        "min_distance_km": float(min(distances)),
        "avg_distance_km": float(np.mean(distances)),
        "min_time_difference_hours": float(min(time_diffs)),
        "avg_time_difference_hours": float(np.mean(time_diffs)),
        "avg_speed": float(np.mean(speeds)) if speeds else 0.0,
        "max_speed": float(max(speeds)) if speeds else 0.0,
        "heading_variation": _heading_variation(headings),
    }


class VesselIsolationForest:
    """Loads the supplied forest and exposes calibrated anomaly scores in [0, 1]."""

    def __init__(self, model_path: str | Path, metadata_path: str | Path):
        self.model_path = Path(model_path)
        self.metadata_path = Path(metadata_path)
        self.model = joblib.load(self.model_path)
        self.metadata = json.loads(self.metadata_path.read_text(encoding="utf-8"))
        expected = self.metadata.get("feature_names", FEATURE_NAMES)
        if expected != FEATURE_NAMES:
            raise ValueError("Isolation-forest feature metadata does not match the application feature schema.")

    def score(self, features: Dict[str, float]) -> Dict[str, Any]:
        """Score a complete feature vector (requires scikit-learn 1.7.1)."""
        vector = np.array([[features[name] for name in FEATURE_NAMES]], dtype=float)
        # In sklearn, more negative decision_function values are more anomalous.
        raw_anomaly = float(-self.model.decision_function(vector)[0])
        anchors = self.metadata.get("score_calibration", {})
        p01, p99 = float(anchors.get("p01", -1.0)), float(anchors.get("p99", 1.0))
        calibrated = float(np.clip((raw_anomaly - p01) / max(p99 - p01, 1e-9), 0.0, 1.0))
        return {
            "raw_anomaly_score": round(raw_anomaly, 6),
            "anomaly_score": round(calibrated, 4),
            "isolation_forest_prediction": "ANOMALOUS" if int(self.model.predict(vector)[0]) == -1 else "IN_DISTRIBUTION",
            "features": {name: round(features[name], 5) for name in FEATURE_NAMES},
            "model_version": self.metadata.get("model_version"),
        }