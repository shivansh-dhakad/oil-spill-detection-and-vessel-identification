"""
test_forward_forecast.py - Verification test for OpenDrift forward drift forecasting.
"""

from datetime import datetime, timezone
import sys
import os

# Add ml_service to path
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from environment import fetch_environmental_forecast
from drift import run_forward_forecast, estimate_forward_forecast_summary, calculate_bearing_deg


def test_bearing_calculation():
    # Test compass bearing
    # Moving directly North
    b_north = calculate_bearing_deg(10.0, 80.0, 11.0, 80.0)
    assert abs(b_north - 0.0) < 0.1 or abs(b_north - 360.0) < 0.1, f"Expected 0 deg, got {b_north}"
    
    # Moving directly East
    b_east = calculate_bearing_deg(10.0, 80.0, 10.0, 81.0)
    assert abs(b_east - 90.0) < 1.0, f"Expected 90 deg, got {b_east}"
    print("[PASS] calculate_bearing_deg passed.")


def test_forecast_pipeline():
    # Coordinates in Bay of Bengal
    lat, lon = 12.34, 78.90
    detection_time = datetime(2025, 6, 15, 8, 30, tzinfo=timezone.utc)
    fallback_conditions = {
        "current_velocity_ms": 0.25,
        "current_direction_deg": 65.0,
        "wind_speed_ms": 6.5,
        "wind_direction_deg": 220.0,
    }

    print(f"Fetching environmental forecast for ({lat}, {lon}) at {detection_time}...")
    env_forecast = fetch_environmental_forecast(
        latitude=lat,
        longitude=lon,
        detection_time_utc=detection_time,
        forecast_hours=24,
        fallback_conditions=fallback_conditions,
    )

    assert env_forecast["available"] is True, "Forecast data should be available (with fallback)"
    assert len(env_forecast["time_series"]) >= 24, f"Expected >= 24 hourly records, got {len(env_forecast['time_series'])}"
    print(f"[PASS] fetch_environmental_forecast returned {len(env_forecast['time_series'])} hourly points.")

    print("Running forward drift forecast simulation...")
    trajectory = run_forward_forecast(
        spill_lat=lat,
        spill_lon=lon,
        detection_time_utc=detection_time,
        env_time_series=env_forecast["time_series"],
        windage_factor=0.03,
        forecast_hours=24,
    )

    assert len(trajectory) >= 2, f"Expected forward trajectory points, got {len(trajectory)}"
    assert trajectory[0]["cumulative_distance_km"] == 0.0, "Initial point cumulative distance must be 0"
    assert trajectory[-1]["cumulative_distance_km"] > 0.0, "Final point must show forward displacement"
    print(f"[PASS] run_forward_forecast produced {len(trajectory)} trajectory points. Final distance: {trajectory[-1]['cumulative_distance_km']:.2f} km.")

    summary = estimate_forward_forecast_summary(trajectory, detection_time)
    assert summary["status"] == "COMPLETED", f"Expected COMPLETED, got {summary.get('status')}"
    assert summary["forecast_hours"] == 24, f"Expected 24h, got {summary.get('forecast_hours')}"
    assert "waypoints" in summary and len(summary["waypoints"]) > 0, "Waypoints should be present"
    print(f"[PASS] estimate_forward_forecast_summary passed. Drift speed: {summary['average_drift_speed_knots']} kts, Bearing: {summary['drift_bearing_deg']}°.")
    print(f"Waypoints: {summary['waypoints']}")


if __name__ == "__main__":
    test_bearing_calculation()
    test_forecast_pipeline()
    print("\nALL FORWARD TRACKING TESTS PASSED SUCCESSFULLY!")
