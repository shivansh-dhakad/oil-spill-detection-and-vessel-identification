"""
track_based_attribution.py — TRACK_BASED_ATTRIBUTION scoring engine.

Redesign of the AIS vessel-attribution stage (see ais_attribution.py) to use
FULL AIS TRACKS instead of point-presence records whenever they are available.
This module is additive: it does not remove PRESENCE_ONLY handling from
ais_attribution.py, it supersedes it for any candidate that has a real track
(>=1 timestamped position fix). The pipeline should prefer this module's
output over calculate_candidate_attribution(...) whenever
data_mode == "TRACK" is available for a candidate.

--------------------------------------------------------------------------
WHY THIS REDESIGN EXISTS
--------------------------------------------------------------------------
The previous TRACK-mode scorer in ais_attribution.py already computed six
features (spatial, temporal, trajectory, drift, course, data_quality) as a
single weighted average. That has two structural weaknesses this module
fixes:

1. "Spatial proximity" was really just distance-to-origin, evaluated
   independent of the estimated spill start TIME. It conflates two distinct
   physical questions — "did this vessel's track ever pass near the origin?"
   (relevant to establishing the vessel operates in the area) vs. "was this
   vessel actually AT the origin at the moment of release?" (the real
   causal claim). We now separate these into a Spatial Proximity Score
   (§1, time-agnostic, track-wide) and a Drift Consistency Score
   (§3, time-anchored at the hindcast spill-start instant).

2. AIS Quality was folded into the weighted average as just another vote.
   That lets a vessel with 95% complete data and mediocre other scores
   outrank a vessel with a single perfect, extremely close, well-timed fix
   but a sparse track — which is scientifically backwards: a sparse track
   is not itself evidence of guilt or innocence, it is evidence that we
   should trust the OTHER scores less. AIS Quality is therefore pulled out
   of the linear weighted sum and instead applied as a multiplicative
   CONFIDENCE DISCOUNT on the final score (§6), which is the standard way
   to prevent overconfident conclusions from thin evidence.

--------------------------------------------------------------------------
THE FINAL SCORE
--------------------------------------------------------------------------
All component scores are in [0, 1]. A score of None means "cannot be
computed from available data" and is excluded from the weighted average
(weights are renormalized over whatever is available) rather than defaulted
to 0 or 1 — never invent evidence.

    Final Score = 0.45 x Haversine Proximity      (S_spatial)
                + 0.25 x Time Proximity           (S_temporal)
                + 0.15 x Trajectory Intersection  (S_drift)
                + 0.10 x Vessel Type Risk         (S_risk)
                + 0.05 x Speed Anomaly            (S_speed)

1. Haversine Proximity (45%)     — great-circle distance between the vessel's
                                    track and the reconstructed spill origin;
                                    closer vessels score higher (§1).
2. Time Proximity (25%)          — how close the vessel's nearest AIS/GFW fix
                                    is to the estimated spill timestamp (§2).
3. Trajectory Intersection (15%) — whether the vessel's track actually passes
                                    through the spill origin within the
                                    hindcast's release-time window (§3).
4. Vessel Type Risk (10%)        — prior weight by vessel type (oil tanker
                                    highest, fishing vessel lowest); see §5.
5. Speed Anomaly (5%)            — vessels slowing/stopping near the spill at
                                    the estimated release time score higher
                                    than one passing through at speed (§4).

AIS Quality Score (S_quality) remains a confidence MULTIPLIER, not a term in
the weighted sum above:
    final_score = (weighted average of 1-5, over whatever is available) x
                  confidence_multiplier(quality, n_points, coverage_hours)

This guarantees: no amount of AIS-quality polish can manufacture attribution
evidence (quality is not in the numerator's evidence sum), and no amount of
strong-looking evidence can escape being discounted when the track backing
it is thin, gappy, or short (quality still gates the ceiling).
"""

from __future__ import annotations

import math
import random
import statistics
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

EARTH_RADIUS_KM = 6371.0

# ---------------------------------------------------------------------------
# Data mode label used throughout the pipeline / JSON output / UI.
# This is what replaces "PRESENCE_ONLY" for any candidate that has a track.
# ---------------------------------------------------------------------------
DATA_MODE_TRACK_BASED = "TRACK_BASED_ATTRIBUTION"
DATA_MODE_PRESENCE_ONLY = "PRESENCE_ONLY"   # legacy fallback, unchanged
DATA_MODE_UNAVAILABLE = "UNAVAILABLE"


# ===========================================================================
# 0. Input contracts
# ===========================================================================

@dataclass
class TrackPoint:
    """One AIS position report."""
    timestamp: datetime
    lat: float
    lon: float
    sog: Optional[float] = None   # speed over ground, knots
    cog: Optional[float] = None   # course over ground, degrees 0-360

    def __post_init__(self):
        if self.timestamp.tzinfo is None:
            self.timestamp = self.timestamp.replace(tzinfo=timezone.utc)


@dataclass
class VesselTrack:
    """A vessel's AIS track plus static metadata."""
    mmsi: str
    points: List[TrackPoint]
    imo: Optional[str] = None
    name: Optional[str] = None
    vessel_type: Optional[str] = None   # free-text, e.g. "Oil Tanker"
    flag: Optional[str] = None
    # Assumed nominal reporting interval for this vessel class, used only to
    # estimate AIS completeness (Class A ~ 2-10s underway / 3min moored;
    # for spill-window analysis on hourly-ish candidate exports, 10 min is a
    # conservative default for "expected fix density" — override per source).
    expected_report_interval_min: float = 10.0

    def sorted_points(self) -> List[TrackPoint]:
        return sorted(self.points, key=lambda p: p.timestamp)


@dataclass
class HindcastOrigin:
    """Output of the OpenDrift backward hindcast (stage 4)."""
    lat: float
    lon: float
    start_time: datetime
    # 1-sigma radius of the hindcast origin estimate, km. This should come
    # from the spread of OpenDrift's particle ensemble (or a seeded-cluster
    # std-dev) — NOT a fixed constant, since uncertainty legitimately varies
    # with hindcast duration, weathering assumptions, and current-model
    # skill. A sane fallback if the ensemble spread isn't wired up yet is
    # ~10% of the total backward-drift distance, floored at 5 km.
    position_uncertainty_km: float = 15.0
    # 1-sigma uncertainty on the estimated release time, hours.
    time_uncertainty_hr: float = 3.0

    def __post_init__(self):
        if self.start_time.tzinfo is None:
            self.start_time = self.start_time.replace(tzinfo=timezone.utc)


@dataclass
class DetectionEvent:
    """The satellite-observed spill detection (stage 1/2 output)."""
    lat: float
    lon: float
    timestamp: datetime

    def __post_init__(self):
        if self.timestamp.tzinfo is None:
            self.timestamp = self.timestamp.replace(tzinfo=timezone.utc)


# ===========================================================================
# Geodesy helpers
# ===========================================================================

def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return EARTH_RADIUS_KM * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dlambda = math.radians(lon2 - lon1)
    y = math.sin(dlambda) * math.cos(phi2)
    x = math.cos(phi1) * math.sin(phi2) - math.sin(phi1) * math.cos(phi2) * math.cos(dlambda)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def angular_diff_deg(a: float, b: float) -> float:
    """Smallest absolute angular difference between two bearings, in [0, 180]."""
    return abs((a - b + 180.0) % 360.0 - 180.0)


def interpolate_track(points: List[TrackPoint], t: datetime) -> Optional[TrackPoint]:
    """
    Linear interpolation of lat/lon/cog at time t, bracketed by two real
    fixes. Returns None if t is outside the track's time span (we do not
    extrapolate position — extrapolating a ship's location beyond its last
    known fix is exactly the kind of unsupported inference this framework
    is designed to avoid).
    """
    pts = points
    if not pts:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    if t < pts[0].timestamp or t > pts[-1].timestamp:
        return None
    if t == pts[0].timestamp:
        return pts[0]
    for p1, p2 in zip(pts, pts[1:]):
        if p1.timestamp <= t <= p2.timestamp:
            span = (p2.timestamp - p1.timestamp).total_seconds()
            frac = 0.0 if span <= 0 else (t - p1.timestamp).total_seconds() / span
            cog = p1.cog
            if p1.cog is not None and p2.cog is not None:
                # circular interpolation of heading
                diff = ((p2.cog - p1.cog + 180) % 360) - 180
                cog = (p1.cog + frac * diff) % 360
            return TrackPoint(
                timestamp=t,
                lat=p1.lat + frac * (p2.lat - p1.lat),
                lon=p1.lon + frac * (p2.lon - p1.lon),
                sog=(p1.sog + frac * (p2.sog - p1.sog)) if (p1.sog is not None and p2.sog is not None) else p1.sog,
                cog=cog,
            )
    return None


def nearest_point_in_time(points: List[TrackPoint], t: datetime) -> Optional[TrackPoint]:
    if not points:
        return None
    if t.tzinfo is None:
        t = t.replace(tzinfo=timezone.utc)
    return min(points, key=lambda p: abs((p.timestamp - t).total_seconds()))


def position_at_time(points: List[TrackPoint], t: datetime) -> Optional[Dict[str, Any]]:
    """
    Best-available vessel position at time t, for map display (e.g. drawing a
    line from the spill origin to "the ship's position at the time of the
    spill"). Prefers a true interpolation bracketed by real fixes; falls back
    to the nearest real fix (never extrapolated) with a flag so the caller
    can render it distinctly (e.g. a lighter dash) when it isn't exact.
    """
    if not points:
        return None
    interp = interpolate_track(points, t)
    if interp is not None:
        return {"lat": round(interp.lat, 5), "lon": round(interp.lon, 5), "extrapolated": False}
    nearest = nearest_point_in_time(points, t)
    return {"lat": round(nearest.lat, 5), "lon": round(nearest.lon, 5), "extrapolated": True}


# ===========================================================================
# 1. Spatial Proximity Score
# ===========================================================================
#
# Formula:
#   d_min = min over all track points p of haversine(p, origin)
#   D0    = decay_scale_km  (see below)
#   S_spatial = exp(-d_min / D0)
#
# Why exponential decay rather than the previous linear
# max(0, 1 - d/R_search): a linear ramp treats "0 km away" and
# "(R_search - epsilon) km away" as almost equally different in score near
# the far edge, and drops a vessel to a HARD ZERO exactly at the arbitrary
# search-radius boundary — a vessel 201 km away gets 0.000 while one at
# 199 km gets ~0.005; nothing physically distinguishes them. Exponential
# decay has no hard cliff, degrades gracefully, and lets us tie the decay
# constant to something physically meaningful: the hindcast's own
# POSITION UNCERTAINTY. A vessel within the plausible origin ellipse should
# not be penalized much more than one at the ellipse's center; a vessel
# far outside it should be penalized sharply. We set:
#
#   D0 = max(D0_min, position_uncertainty_km / ln(2))
#
# so that S_spatial = 0.5 exactly at one hindcast sigma from the origin,
# and decays roughly by half for each additional sigma of distance —
# directly coupling the scoring aggressiveness to how confident the
# hindcast itself is.
# ===========================================================================

D0_MIN_KM = 5.0


def spatial_decay_scale_km(origin: HindcastOrigin) -> float:
    return max(D0_MIN_KM, origin.position_uncertainty_km / math.log(2))


def score_spatial_proximity(
    track: VesselTrack, origin: HindcastOrigin
) -> Tuple[Optional[float], Optional[float]]:
    """Returns (d_min_km, S_spatial)."""
    pts = track.sorted_points()
    if not pts:
        return None, None
    d_min = min(haversine_km(p.lat, p.lon, origin.lat, origin.lon) for p in pts)
    d0 = spatial_decay_scale_km(origin)
    return round(d_min, 2), round(math.exp(-d_min / d0), 4)


# ===========================================================================
# 2. Temporal Overlap Score
# ===========================================================================
#
# Formula:
#   window = [t0 - k*sigma_t, t0 + k*sigma_t],  k = 2 (≈95% coverage of a
#            Gaussian release-time estimate)
#   tau = 0                                  if any track point falls in window
#       = min distance in hours from the     otherwise
#         nearest track point to the window edge
#   S_temporal = exp( -tau^2 / (2 * sigma_t^2) )
#
# Why: this rewards a vessel whose track brackets or sits inside the
# estimated spill window with a full score, and applies a smooth Gaussian
# roll-off (not a cliff) for vessels observed only before/after — directly
# addressing "penalize vessels appearing only long before or after" without
# a discontinuous cutoff. sigma_t comes from the hindcast's own time
# uncertainty, so a less-certain hindcast is intrinsically more forgiving.
# ===========================================================================

def _sigma_t_and_window(origin: HindcastOrigin, k_sigma: float = 2.0) -> Tuple[float, datetime, datetime]:
    """Shared temporal window used by every score evaluated 'around the
    hindcast release time' (temporal overlap and all four behavioral
    sub-scores below), so they all agree on what 'near t0' means."""
    sigma_t = max(0.5, origin.time_uncertainty_hr)
    win_start = origin.start_time - timedelta(hours=k_sigma * sigma_t)
    win_end = origin.start_time + timedelta(hours=k_sigma * sigma_t)
    return sigma_t, win_start, win_end


def score_temporal_overlap(
    track: VesselTrack, origin: HindcastOrigin, k_sigma: float = 2.0
) -> Tuple[Optional[float], Optional[float]]:
    """Returns (tau_hours, S_temporal)."""
    pts = track.sorted_points()
    if not pts:
        return None, None
    sigma_t, win_start, win_end = _sigma_t_and_window(origin, k_sigma)

    if pts[-1].timestamp < win_start:
        tau_hr = (win_start - pts[-1].timestamp).total_seconds() / 3600.0
    elif pts[0].timestamp > win_end:
        tau_hr = (pts[0].timestamp - win_end).total_seconds() / 3600.0
    else:
        tau_hr = 0.0  # some point falls inside the window

    score = math.exp(-(tau_hr ** 2) / (2 * sigma_t ** 2))
    return round(tau_hr, 2), round(score, 4)


# ===========================================================================
# 3. Drift Consistency Score
# ===========================================================================
#
# Formula:
#   pos_hat(t0) = interpolated (never extrapolated) vessel position at the
#                 hindcast spill-start time t0
#   e_drift     = haversine(pos_hat(t0), origin)
#   S_drift     = exp(-e_drift / D0_drift),   D0_drift = 0.75 * D0_spatial
#
# Why tighter than the spatial-proximity scale: this is the single most
# specific, causally-relevant claim in the whole framework — "this vessel
# was AT the hindcast-reconstructed release point AT the reconstructed
# release time" — so it deserves the highest weight (see WEIGHTS below) and
# the least tolerance for slack. If t0 falls outside the vessel's observed
# track span we do NOT extrapolate (that would fabricate a position); we
# instead fall back to the nearest real fix and apply an explicit
# extrapolation penalty proportional to how far in time that nearest fix
# is from t0, so the score degrades honestly rather than silently reusing
# spatial-proximity's looser tolerance.
# ===========================================================================

def score_drift_consistency(
    track: VesselTrack, origin: HindcastOrigin
) -> Tuple[Optional[float], Optional[float]]:
    """Returns (e_drift_km, S_drift)."""
    pts = track.sorted_points()
    if not pts:
        return None, None
    d0 = 0.75 * spatial_decay_scale_km(origin)

    interp = interpolate_track(pts, origin.start_time)
    if interp is not None:
        e = haversine_km(interp.lat, interp.lon, origin.lat, origin.lon)
        return round(e, 2), round(math.exp(-e / d0), 4)

    # t0 outside observed span: use nearest fix + extrapolation penalty
    nearest = nearest_point_in_time(pts, origin.start_time)
    e = haversine_km(nearest.lat, nearest.lon, origin.lat, origin.lon)
    gap_hr = abs((nearest.timestamp - origin.start_time).total_seconds()) / 3600.0
    extrap_penalty = math.exp(-gap_hr / 12.0)  # halves roughly every ~8.3h of extrapolation
    return round(e, 2), round(math.exp(-e / d0) * extrap_penalty, 4)


# ===========================================================================
# 4. Speed Anomaly Score
# ===========================================================================
#
# Formula:
#   baseline = vessel's own median SOG over its whole observed track
#   speed_at_window = slowest reported SOG within the release window (falls
#                      back to the nearest fix outside the window, with an
#                      extrapolation penalty, if the window has no fix)
#   drop_frac = clip((baseline - speed_at_window) / baseline, 0, 1)
#   S_speed   = drop_frac * extrap_penalty
#
# Why self-relative: a fishing vessel and a tanker have very different
# "normal" speeds, so only a drop from a vessel's OWN baseline is real
# behavioral evidence — a vessel that slows sharply or stops near the spill
# origin around the estimated release time (consistent with tank-cleaning
# or a discharge operation) scores higher than one merely transiting
# through at its normal cruising speed.
# ===========================================================================

SPEED_ANOMALY_BASELINE_FLOOR_KNOTS = 1.0


def _median_sog(pts: List[TrackPoint]) -> Optional[float]:
    vals = [p.sog for p in pts if p.sog is not None]
    if not vals:
        return None
    return statistics.median(vals)


def score_speed_anomaly(
    track: VesselTrack, origin: HindcastOrigin, k_sigma: float = 2.0
) -> Tuple[Optional[float], Optional[float]]:
    """
    Returns (speed_drop_fraction, S_speed_anomaly).

    Compares the vessel's SLOWEST reported speed within the release window
    to its OWN median speed over the whole track (self-relative, not an
    absolute knots threshold — a fishing vessel and a tanker have very
    different "normal" speeds, and only a drop from a vessel's own baseline
    is real behavioral evidence). If the window has no valid SOG fix, falls
    back to the nearest fix outside the window with the same kind of
    extrapolation penalty used by score_drift_consistency (§3), since we
    never invent a speed inside a gap we didn't observe.
    """
    pts = track.sorted_points()
    if not pts:
        return None, None
    baseline = _median_sog(pts)
    if baseline is None or baseline < SPEED_ANOMALY_BASELINE_FLOOR_KNOTS:
        # No usable speed data, or the vessel's own baseline is already
        # near-stationary — a "drop" from an already-slow baseline carries
        # little information either way.
        return None, None

    _, win_start, win_end = _sigma_t_and_window(origin, k_sigma)
    in_window = [p for p in pts if win_start <= p.timestamp <= win_end and p.sog is not None]

    if in_window:
        speed_at_window = min(p.sog for p in in_window)
        extrap_penalty = 1.0
    else:
        speed_pts = [p for p in pts if p.sog is not None]
        if not speed_pts:
            return None, None
        nearest = min(speed_pts, key=lambda p: min(
            abs((p.timestamp - win_start).total_seconds()),
            abs((p.timestamp - win_end).total_seconds()),
        ))
        speed_at_window = nearest.sog
        gap_hr = min(
            abs((nearest.timestamp - win_start).total_seconds()),
            abs((nearest.timestamp - win_end).total_seconds()),
        ) / 3600.0
        extrap_penalty = math.exp(-gap_hr / 12.0)

    drop_frac = max(0.0, min(1.0, (baseline - speed_at_window) / baseline))
    return round(drop_frac, 3), round(drop_frac * extrap_penalty, 4)


# ===========================================================================
# 5. Vessel Risk Prior
# ===========================================================================
#
# This is a PRIOR, not evidence from this incident — it encodes the base
# rate at which different vessel classes are historically implicated in
# operational/illegal oil discharges (tank-cleaning, bilge/bunker
# mismanagement, ballast discharge), per IMO MARPOL Annex I enforcement
# literature and regional coast-guard spill-attribution statistics: tankers
# and product carriers dominate operational-discharge attributions because
# they carry and transfer oil as cargo; general cargo/bulk carriers follow
# via bunker/bilge mismanagement; fishing and passenger vessels are
# comparatively rare sources of large slicks. BECAUSE this is a prior and
# not incident evidence, it is given the smallest defensible weight among
# the six core scores and is clearly labeled in output as "prior" so it
# never gets mistaken for observed evidence.
# ===========================================================================

VESSEL_RISK_PRIOR: Dict[str, float] = {
    "oil tanker": 1.00,
    "crude oil tanker": 1.00,
    "chemical tanker": 0.90,
    "product tanker": 0.90,
    "tanker": 0.90,
    "bulk carrier": 0.60,
    "cargo ship": 0.50,
    "cargo": 0.50,
    "general cargo": 0.50,
    "container ship": 0.50,
    "fishing vessel": 0.20,
    "fishing": 0.20,
    "other": 0.40,
    "unknown": 0.40,   # neutral — absence of type info is not evidence either way
}


def score_vessel_risk_prior(vessel_type: Optional[str]) -> float:
    if not vessel_type:
        return VESSEL_RISK_PRIOR["unknown"]
    key = vessel_type.strip().lower()
    if key in VESSEL_RISK_PRIOR:
        return VESSEL_RISK_PRIOR[key]
    for k, v in VESSEL_RISK_PRIOR.items():
        if k in key:  # substring match, e.g. "Crude Oil Tanker (IMO Type 2)"
            return v
    return VESSEL_RISK_PRIOR["unknown"]


# ===========================================================================
# 6. AIS Quality Score  (confidence multiplier, NOT a weighted-average term)
# ===========================================================================
#
# Formula:
#   completeness = min(1, n_actual_points / n_expected_points)
#       n_expected_points = track_duration_min / expected_report_interval_min
#   gap_penalty  = min(1, max_gap_hours / GAP_TOLERANCE_HOURS)
#   jump_penalty = fraction of consecutive-fix pairs whose implied speed
#                  exceeds a plausible max (spoofing / bad timestamp)
#   S_quality = clip(1 - 0.4*(1-completeness) - 0.4*gap_penalty
#                     - 0.2*jump_penalty, 0, 1)
#
# CONFIDENCE MULTIPLIER (this is the actual overconfidence guard):
#   coverage_factor = min(1, n_points / MIN_POINTS_FULL_CONF)
#   confidence = CONF_FLOOR + (1 - CONF_FLOOR) * S_quality * coverage_factor
#
# Why a floor instead of letting confidence hit 0: a track that is real but
# very sparse (e.g. one AIS fix inside the search window because the vessel
# was mostly out of terrestrial AIS range) should be discounted heavily,
# not treated as equivalent to "no evidence at all" — it still moved the
# needle, just less trustworthily. CONF_FLOOR sets the deepest allowed
# discount. MIN_POINTS_FULL_CONF additionally ensures that even a single
# perfect, on-target fix cannot produce full confidence — multiple
# corroborating fixes are required to reach it.
# ===========================================================================

GAP_TOLERANCE_HOURS = 6.0
MAX_PLAUSIBLE_SPEED_KNOTS = 50.0
KM_TO_NM = 0.539957
CONF_FLOOR = 0.30
MIN_POINTS_FULL_CONF = 6


def score_ais_quality(track: VesselTrack) -> Tuple[float, Dict[str, Any]]:
    """Returns (S_quality, diagnostics_dict)."""
    pts = track.sorted_points()
    diagnostics: Dict[str, Any] = {"n_points": len(pts), "flags": []}
    if not pts:
        return 0.0, diagnostics

    if len(pts) == 1:
        diagnostics["flags"].append("Single-fix track — continuity cannot be assessed.")
        return round(0.3, 4), diagnostics  # can't assess gaps/jumps; conservative low score

    duration_min = (pts[-1].timestamp - pts[0].timestamp).total_seconds() / 60.0
    n_expected = max(1.0, duration_min / max(1.0, track.expected_report_interval_min))
    completeness = min(1.0, len(pts) / n_expected)

    max_gap_hr = 0.0
    speed_violations = 0
    for p1, p2 in zip(pts, pts[1:]):
        gap_hr = max(0.0, (p2.timestamp - p1.timestamp).total_seconds() / 3600.0)
        max_gap_hr = max(max_gap_hr, gap_hr)
        if gap_hr > 0:
            dist_km = haversine_km(p1.lat, p1.lon, p2.lat, p2.lon)
            implied_kn = (dist_km / gap_hr) * KM_TO_NM
            if implied_kn > MAX_PLAUSIBLE_SPEED_KNOTS:
                speed_violations += 1

    gap_penalty = min(1.0, max_gap_hr / GAP_TOLERANCE_HOURS)
    jump_penalty = speed_violations / max(1, len(pts) - 1)

    if max_gap_hr > GAP_TOLERANCE_HOURS:
        diagnostics["flags"].append(f"Gap of {max_gap_hr:.1f}h exceeds {GAP_TOLERANCE_HOURS:.0f}h tolerance.")
    if speed_violations:
        diagnostics["flags"].append(f"{speed_violations} fix-pair(s) imply speed > {MAX_PLAUSIBLE_SPEED_KNOTS:.0f} kn.")

    s_quality = max(0.0, min(1.0, 1 - 0.4 * (1 - completeness) - 0.4 * gap_penalty - 0.2 * jump_penalty))
    diagnostics.update({
        "completeness": round(completeness, 3),
        "max_gap_hours": round(max_gap_hr, 2),
        "jump_penalty": round(jump_penalty, 3),
    })
    return round(s_quality, 4), diagnostics


def confidence_multiplier(s_quality: float, n_points: int) -> float:
    coverage_factor = min(1.0, n_points / MIN_POINTS_FULL_CONF)
    return round(CONF_FLOOR + (1 - CONF_FLOOR) * s_quality * coverage_factor, 4)


# ===========================================================================
# 7. Combination: core weighted average + confidence discount
# ===========================================================================

CORE_WEIGHTS: Dict[str, float] = {
    # Final Score = 0.45 x Haversine Proximity + 0.25 x Time Proximity
    #             + 0.15 x Trajectory Intersection + 0.10 x Vessel Type Risk
    #             + 0.05 x Speed Anomaly
    "spatial":  0.45,   # Haversine Proximity: min distance from ANY point on
                        # the track to the reconstructed spill origin
    "temporal": 0.25,   # Time Proximity: how close the nearest AIS fix is to
                        # the estimated spill timestamp
    "drift":    0.15,   # Trajectory Intersection: does the track pass through
                        # the spill origin within the release-time window?
    "risk":     0.10,   # Vessel Type Risk (prior, not incident evidence)
    "speed":    0.05,   # Speed Anomaly: slowing/stopping near the spill origin
                        # around the estimated release time
}
assert abs(sum(CORE_WEIGHTS.values()) - 1.0) < 1e-9

CONFIDENCE_TIERS = {
    "probable_source_vessel": 0.65,
    "candidate_vessel": 0.35,
    "nearby_vessel": 0.0,
}


def classify_confidence_tier(final_score: Optional[float]) -> str:
    if final_score is None:
        return "insufficient_evidence"
    if final_score >= CONFIDENCE_TIERS["probable_source_vessel"]:
        return "probable_source_vessel"
    if final_score >= CONFIDENCE_TIERS["candidate_vessel"]:
        return "candidate_vessel"
    return "nearby_vessel"


@dataclass
class AttributionResult:
    mmsi: str
    name: Optional[str]
    vessel_type: Optional[str]
    data_mode: str
    scores: Dict[str, Optional[float]]
    raw: Dict[str, Optional[float]]
    core_score: Optional[float]
    ais_quality: float
    confidence: float
    final_score: Optional[float]
    uncertainty: Dict[str, Optional[float]]
    confidence_tier: str
    quality_flags: List[str] = field(default_factory=list)


def score_vessel_track(
    track: VesselTrack,
    origin: HindcastOrigin,
    detection: DetectionEvent,
    n_monte_carlo: int = 200,
) -> AttributionResult:
    """
    Computes the Final Score for one vessel:

        Final Score = 0.45 x Haversine Proximity + 0.25 x Time Proximity
                    + 0.15 x Trajectory Intersection + 0.10 x Vessel Type Risk
                    + 0.05 x Speed Anomaly

    then applies the AIS-quality confidence multiplier (§6/§7).
    """
    d_spatial, s_spatial = score_spatial_proximity(track, origin)
    tau_temporal, s_temporal = score_temporal_overlap(track, origin)
    e_drift, s_drift = score_drift_consistency(track, origin)
    drop_frac, s_speed = score_speed_anomaly(track, origin)
    s_risk = score_vessel_risk_prior(track.vessel_type)
    s_quality, quality_diag = score_ais_quality(track)
    # Best-available vessel position at the reconstructed spill-release time -
    # for map display only (the dotted origin -> vessel-at-spill-time line),
    # not used in scoring (score_drift_consistency computes its own error
    # distance independently).
    pos_at_spill_time = position_at_time(track.sorted_points(), origin.start_time)

    feature_scores = {
        "spatial": s_spatial,
        "temporal": s_temporal,
        "drift": s_drift,
        "risk": s_risk,   # always available (defaults to neutral 0.40)
        "speed": s_speed,
    }
    available_weight = sum(CORE_WEIGHTS[k] for k, v in feature_scores.items() if v is not None)
    if available_weight <= 0:
        core_score = None
    else:
        weighted_sum = sum(v * CORE_WEIGHTS[k] for k, v in feature_scores.items() if v is not None)
        core_score = round(weighted_sum / available_weight, 4)

    conf = confidence_multiplier(s_quality, len(track.points))
    final_score = round(core_score * conf, 4) if core_score is not None else None

    # -- Uncertainty propagation: perturb the hindcast origin within its own
    #    position/time uncertainty (Monte Carlo) and recompute the scores
    #    that actually depend on the origin (spatial, temporal, drift, and
    #    speed all do — risk does not) to get a spread on the final score.
    #    This reports HOW SENSITIVE the ranking is to hindcast error, rather
    #    than presenting final_score as exact. --
    uncertainty = _monte_carlo_uncertainty(track, origin, feature_scores, available_weight, conf, n_monte_carlo)

    return AttributionResult(
        mmsi=track.mmsi,
        name=track.name,
        vessel_type=track.vessel_type,
        data_mode=DATA_MODE_TRACK_BASED,
        scores=feature_scores,
        raw={
            "spatial_distance_km": d_spatial,
            "temporal_gap_hours": tau_temporal,
            "drift_error_km": e_drift,
            "speed_drop_fraction": drop_frac,
            "position_at_spill_time": pos_at_spill_time,
        },
        core_score=core_score,
        ais_quality=s_quality,
        confidence=conf,
        final_score=final_score,
        uncertainty=uncertainty,
        confidence_tier=classify_confidence_tier(final_score),
        quality_flags=quality_diag.get("flags", []),
    )


def _monte_carlo_uncertainty(
    track: VesselTrack,
    origin: HindcastOrigin,
    base_feature_scores: Dict[str, Optional[float]],
    available_weight: float,
    conf: float,
    n_samples: int,
) -> Dict[str, Optional[float]]:
    """
    Resamples the hindcast origin (lat/lon within position_uncertainty_km,
    start_time within time_uncertainty_hr) N times, recomputes only the
    scores that actually depend on the origin (spatial, temporal, drift, and
    speed all do, the last through its shared temporal window — risk does
    not), and reports the resulting spread of final_score. This is a cheap
    sensitivity analysis, not a full joint posterior — but it is sufficient
    to answer "is this ranking fragile to hindcast error?".
    """
    if available_weight <= 0:
        return {"mean": None, "std": None, "p05": None, "p95": None}

    rng = random.Random(hash(track.mmsi) & 0xFFFFFFFF)
    lat_std_deg = origin.position_uncertainty_km / 111.0
    lon_std_deg = origin.position_uncertainty_km / (111.0 * max(0.2, math.cos(math.radians(origin.lat))))

    samples: List[float] = []
    for _ in range(max(1, n_samples)):
        jittered = HindcastOrigin(
            lat=origin.lat + rng.gauss(0, lat_std_deg),
            lon=origin.lon + rng.gauss(0, lon_std_deg),
            start_time=origin.start_time + timedelta(hours=rng.gauss(0, origin.time_uncertainty_hr)),
            position_uncertainty_km=origin.position_uncertainty_km,
            time_uncertainty_hr=origin.time_uncertainty_hr,
        )
        _, s_sp = score_spatial_proximity(track, jittered)
        _, s_te = score_temporal_overlap(track, jittered)
        _, s_dr = score_drift_consistency(track, jittered)
        _, s_sd = score_speed_anomaly(track, jittered)
        sample_scores = {
            "spatial": s_sp, "temporal": s_te, "drift": s_dr,
            "speed": s_sd, "risk": base_feature_scores["risk"],
        }
        wsum = sum(CORE_WEIGHTS[k] for k, v in sample_scores.items() if v is not None)
        if wsum <= 0:
            continue
        core = sum(v * CORE_WEIGHTS[k] for k, v in sample_scores.items() if v is not None) / wsum
        samples.append(core * conf)

    if not samples:
        return {"mean": None, "std": None, "p05": None, "p95": None}
    samples.sort()
    mean = statistics.mean(samples)
    std = statistics.pstdev(samples) if len(samples) > 1 else 0.0
    p05 = samples[max(0, int(0.05 * len(samples)) - 1)]
    p95 = samples[min(len(samples) - 1, int(0.95 * len(samples)))]
    return {
        "mean": round(mean, 4),
        "std": round(std, 4),
        "p05": round(p05, 4),
        "p95": round(p95, 4),
    }


# ===========================================================================
# 8. Ranking entry point — replaces PRESENCE_ONLY ranking wherever a track
#    exists. Vessels without any track fall back to the caller's existing
#    PRESENCE_ONLY path (not reimplemented here — see integration note at
#    bottom of file).
# ===========================================================================

def rank_vessels_track_based(
    tracks: List[VesselTrack],
    origin: HindcastOrigin,
    detection: DetectionEvent,
    min_evidence_threshold: float = 0.20,
) -> Dict[str, Any]:
    """
    Scores and ranks all vessels that have at least one real AIS fix using
    TRACK_BASED_ATTRIBUTION. Returns the same overall shape as the legacy
    run_attribution() result so it can be dropped into main.py in place of
    (or merged with) the PRESENCE_ONLY branch.
    """
    results = [score_vessel_track(t, origin, detection) for t in tracks if t.points]

    scored = [r for r in results if r.final_score is not None]
    scored.sort(key=lambda r: r.final_score, reverse=True)

    above_threshold = [r for r in scored if r.final_score >= min_evidence_threshold]
    status = "OK" if above_threshold else ("INSUFFICIENT_EVIDENCE" if scored else "NO_CANDIDATES_SCORED")

    return {
        "data_mode": DATA_MODE_TRACK_BASED,
        "status": status,
        "hindcast_origin": {"lat": origin.lat, "lon": origin.lon,
                             "start_time_utc": origin.start_time.isoformat(),
                             "position_uncertainty_km": origin.position_uncertainty_km,
                             "time_uncertainty_hr": origin.time_uncertainty_hr},
        "weights": CORE_WEIGHTS,
        "candidates_evaluated": len(results),
        "candidates": [
            {
                "mmsi": r.mmsi,
                "name": r.name,
                "vessel_type": r.vessel_type,
                "data_mode": r.data_mode,
                "final_score": r.final_score,
                "core_score": r.core_score,
                "confidence": r.confidence,
                "confidence_tier": r.confidence_tier,
                "ais_quality": r.ais_quality,
                "uncertainty": r.uncertainty,
                "component_scores": r.scores,
                "raw_measurements": r.raw,
                "quality_flags": r.quality_flags,
                "position_at_spill_time": r.raw.get("position_at_spill_time"),
            }
            for r in scored
        ],
        "disclaimer": (
            "TRACK_BASED_ATTRIBUTION ranks vessels by relative likelihood given "
            "available AIS tracks and the hindcast reconstruction. Scores are "
            "discounted by AIS track quality/coverage and are NOT calibrated "
            "probabilities. This does not establish causation; confirmation "
            "requires independent, non-AIS evidence."
        ),
    }


# ===========================================================================
# INTEGRATION NOTE for ais_attribution.py / main.py
# ===========================================================================
# In run_attribution(...), after building `records` and before dispatching
# on `data_mode`:
#
#   track_candidates = [r for r in records if r.get("data_mode") == "TRACK"]
#   presence_candidates = [r for r in records if r.get("data_mode") == "PRESENCE_ONLY"]
#
#   tracks = [
#       VesselTrack(
#           mmsi=r["mmsi"], name=r.get("name"), vessel_type=r.get("vessel_type"),
#           flag=r.get("flag"), imo=r.get("imo"),
#           points=[TrackPoint(o["timestamp"], o["latitude"], o["longitude"],
#                               o.get("sog"), o.get("cog")) for o in r["observations"]],
#       )
#       for r in track_candidates
#   ]
#   origin = HindcastOrigin(estimated_origin_lat, estimated_origin_lon,
#                            estimated_start_utc, position_uncertainty_km=..., 
#                            time_uncertainty_hr=...)
#   detection = DetectionEvent(detection_lat, detection_lon, detection_time_utc)
#
#   track_result = rank_vessels_track_based(tracks, origin, detection)
#   # legacy PRESENCE_ONLY scoring still runs for presence_candidates and the
#   # two candidate lists are merged for display, each carrying its own
#   # data_mode so the report is honest about which vessels had real tracks.
# ===========================================================================