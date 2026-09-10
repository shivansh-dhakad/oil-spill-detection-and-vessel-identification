"""
server.py - Flask API for the Oil Spill ML pipeline.

Designed to sit behind your existing Node.js/Express backend as an internal
microservice (Node proxies requests to this service and relays JSON to the
React frontend), or to be called directly from the frontend if you prefer.

Run:
    python server.py
    # or in production:
    gunicorn -w 1 -b 0.0.0.0:5001 --timeout 300 server:app
    # -w 1 (single worker) is recommended unless you move the model load to
    # be per-worker-safe and have the GPU/RAM to support it - the model is
    # loaded once per process at startup.

Endpoints:
    GET  /api/health
    POST /api/spill/analyze              multipart/form-data upload -> {job_id}
    GET  /api/spill/jobs/<job_id>        full job status + stages (+ result once complete)
    GET  /api/spill/jobs/<job_id>/stream Server-Sent Events live progress stream
    GET  /api/spill/files/<job_id>/<name> serves generated files (mask, overlay, trajectory csv/png)
"""

from __future__ import annotations

import json
import os
import sys
import time
import uuid
from pathlib import Path

from flask import Flask, request, jsonify, Response, send_from_directory
from flask_cors import CORS
from werkzeug.utils import secure_filename

CURRENT_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(CURRENT_DIR))

try:
    from dotenv import load_dotenv
    load_dotenv(CURRENT_DIR / ".env")
except ImportError:
    pass

import torch
from model import load_model
from jobs import JobManager

# --------------------------------------------------------------------- #
# Configuration
# --------------------------------------------------------------------- #
UPLOADS_DIR = CURRENT_DIR / "uploads"
OUTPUTS_DIR = CURRENT_DIR / "outputs"
UPLOADS_DIR.mkdir(exist_ok=True)
OUTPUTS_DIR.mkdir(exist_ok=True)

ALLOWED_EXTENSIONS = {".zip", ".png", ".jpg", ".jpeg", ".tif", ".tiff", ".bmp"}
# Sentinel-1 SAFE archives commonly run 700MB-1.5GB+, so default the cap well
# above that. Override with MAX_UPLOAD_MB if your infra needs a tighter limit
# (keep backend/routes/predictions.js's multer `limits.fileSize` >= this).
MAX_CONTENT_LENGTH = int(os.environ.get("MAX_UPLOAD_MB", "3072")) * 1024 * 1024

# unetpp_best.pth (legacy UNet++ checkpoint) is preferred over the
# .safetensors SegFormer model — put it first so it's picked up automatically.
DEFAULT_MODEL_CANDIDATES = [
    CURRENT_DIR / "models" / "unetpp_best.pth",
    CURRENT_DIR.parent / "models" / "unetpp_best.pth",
    CURRENT_DIR / "models" / "best.pth",
    CURRENT_DIR / "models" / "model.safetensors",
    CURRENT_DIR / "models" / "final_statedict.pth",
]
DEFAULT_HF_MODEL_REPO_ID = "shivanshdhakad/oil_spill_detection_using_unet_architecture"
DEFAULT_HF_MODEL_FILENAME = "unetpp_best.pth"


def get_default_model_path() -> str:
    for cand in DEFAULT_MODEL_CANDIDATES:
        if cand.exists():
            return str(cand)
    return str(CURRENT_DIR / "models" / "unetpp_best.pth")


def resolve_model_path() -> str:
    configured_path = os.environ.get("OIL_SPILL_MODEL_PATH")
    if configured_path:
        return configured_path

    for candidate in DEFAULT_MODEL_CANDIDATES:
        if candidate.exists():
            return str(candidate)

    repo_id = os.environ.get("HF_MODEL_REPO_ID", DEFAULT_HF_MODEL_REPO_ID)

    filename = os.environ.get("HF_MODEL_FILENAME", DEFAULT_HF_MODEL_FILENAME)
    revision = os.environ.get("HF_MODEL_REVISION") or None
    repo_type = os.environ.get("HF_MODEL_REPO_TYPE", "model")
    token = os.environ.get("HF_TOKEN") or os.environ.get("HUGGINGFACE_HUB_TOKEN")

    try:
        from huggingface_hub import hf_hub_download

        print(f"[startup] Downloading model from Hugging Face: {repo_id}/{filename}")
        return hf_hub_download(
            repo_id=repo_id,
            filename=filename,
            repo_type=repo_type,
            revision=revision,
            token=token,
        )
    except Exception as error:
        raise RuntimeError(
            f"Could not download model from Hugging Face ({repo_id}/{filename}): {error}"
        ) from error


# --------------------------------------------------------------------- #
# App + model setup
# --------------------------------------------------------------------- #
app = Flask(__name__)
app.config["MAX_CONTENT_LENGTH"] = MAX_CONTENT_LENGTH
# Lock this down to your Node backend / frontend origin(s) in production,
# e.g. CORS(app, origins=["https://your-frontend.example.com"])
CORS(app)


@app.errorhandler(413)
def handle_too_large(e):
    limit_mb = MAX_CONTENT_LENGTH // (1024 * 1024)
    return jsonify({
        "error": f"File exceeds the server's upload limit ({limit_mb} MB). "
                  f"Raise MAX_UPLOAD_MB in ml_service's environment (and the matching "
                  f"multer limit in backend/routes/predictions.js) if you need to allow larger files."
    }), 413

device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
try:
    model_path = resolve_model_path()
except Exception as error:
    model_path = get_default_model_path()
    print(f"[startup] ERROR: {error}")

print(f"[startup] Loading model from {model_path} on {device}...")
try:
    model, model_metadata = load_model(model_path, device=device)
    print("[startup] Model loaded successfully.")
except Exception as e:
    print(f"[startup] ERROR: failed to load model: {e}")
    print("[startup] The server will still start, but /api/spill/analyze will fail "
          "until a valid local model or Hugging Face model configuration is available.")
    model, model_metadata = None, {"error": str(e)}

job_manager = JobManager(model=model, device=device, outputs_dir=str(OUTPUTS_DIR))


# --------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------- #
def _allowed_file(filename: str) -> bool:
    ext = Path(filename).suffix.lower()
    # .SAFE archives are usually uploaded as "<scene>.SAFE.zip" - the
    # suffix check above already covers plain ".zip".
    return ext in ALLOWED_EXTENSIONS


def _parse_bool(value, default=False):
    if value is None:
        return default
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _parse_float(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


# --------------------------------------------------------------------- #
# Routes
# --------------------------------------------------------------------- #
@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok" if model is not None else "degraded",
        "device": str(device),
        "model": model_metadata,
    })


@app.route("/api/spill/analyze", methods=["POST"])
def analyze():
    """
    Accepts a multipart/form-data upload:

      file            (required) - a .SAFE.zip / .zip Sentinel-1 archive,
                                    OR a plain image (.png/.jpg/.tif/.bmp)

      For plain images ONLY (SAFE archives carry their own geolocation):
      latitude        (required) - decimal degrees, -90..90
      longitude       (required) - decimal degrees, -180..180
      timestamp       (optional) - ISO 8601 UTC acquisition time, defaults to now

      Optional for either input type:
      lookback_days       - float, days of current/wind history to backtrack (default 20)
      release_hours_ago   - float, evidence-based release age in hours
      skip_ais            - bool, skip Stage 3 vessel attribution (default false)

    Returns 202 with {"job_id": "..."} immediately; poll
    GET /api/spill/jobs/<job_id> (or subscribe to the /stream endpoint) for progress.
    """
    if model is None:
        return jsonify({"error": "Model is not loaded on the server. Check server logs / OIL_SPILL_MODEL_PATH."}), 503

    if "file" not in request.files:
        return jsonify({"error": "No file provided. Send it as multipart/form-data field 'file'."}), 400

    upload = request.files["file"]
    if not upload.filename:
        return jsonify({"error": "Empty filename."}), 400
    if not _allowed_file(upload.filename):
        return jsonify({
            "error": f"Unsupported file type '{Path(upload.filename).suffix}'. "
                     f"Allowed: {sorted(ALLOWED_EXTENSIONS)}"
        }), 400

    latitude = _parse_float(request.form.get("latitude"))
    longitude = _parse_float(request.form.get("longitude"))
    timestamp = request.form.get("timestamp")
    lookback_days = _parse_float(request.form.get("lookback_days")) or 5.0
    release_hours_ago = _parse_float(request.form.get("release_hours_ago"))
    skip_ais = _parse_bool(request.form.get("skip_ais"), default=False)

    # Save the upload under a unique, sanitized name.
    original_name = secure_filename(upload.filename)
    unique_prefix = uuid.uuid4().hex[:8]
    save_name = f"{unique_prefix}_{original_name}"
    save_path = UPLOADS_DIR / save_name
    upload.save(str(save_path))

    job = job_manager.create_job(
        input_path=str(save_path),
        input_filename=original_name,
        params={
            "latitude": latitude,
            "longitude": longitude,
            "timestamp": timestamp,
            "lookback_days": lookback_days,
            "release_hours_ago": release_hours_ago,
            "skip_ais": skip_ais,
        },
    )
    job_manager.start(job)

    return jsonify({
        "job_id": job.id,
        "status_url": f"/api/spill/jobs/{job.id}",
        "stream_url": f"/api/spill/jobs/{job.id}/stream",
    }), 202


@app.route("/api/spill/jobs/<job_id>", methods=["GET"])
def get_job(job_id: str):
    job = job_manager.get_job(job_id)
    if job is None:
        return jsonify({"error": "Unknown job_id."}), 404
    return jsonify(job.to_dict())


@app.route("/api/spill/jobs/<job_id>/stream", methods=["GET"])
def stream_job(job_id: str):
    """Server-Sent Events stream of stage updates, so the frontend can show
    live progress ('extraction... preprocessing... running model...') without
    polling. Closes automatically once the job reaches a terminal status."""
    job = job_manager.get_job(job_id)
    if job is None:
        return jsonify({"error": "Unknown job_id."}), 404

    def _generate():
        last_payload = None
        while True:
            job_now = job_manager.get_job(job_id)
            if job_now is None:
                break
            payload = json.dumps(job_now.to_dict())
            if payload != last_payload:
                yield f"data: {payload}\n\n"
                last_payload = payload
            if job_now.status in ("complete", "failed", "cancelled"):
                break
            time.sleep(0.6)

    return Response(_generate(), mimetype="text/event-stream", headers={
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
    })


@app.route("/api/spill/jobs/<job_id>/cancel", methods=["POST"])
def cancel_job(job_id: str):
    job = job_manager.cancel(job_id)
    if job is None:
        return jsonify({"error": "Unknown job_id."}), 404
    return jsonify(job.to_dict())


@app.route("/api/spill/files/<job_id>/<path:filename>", methods=["GET"])
def get_job_file(job_id: str, filename: str):
    """Serves a generated output file (mask/overlay PNG, trajectory CSV/PNG)
    for one job. Filenames come only from the job's own result payload, and
    send_from_directory prevents path traversal outside that job's folder."""
    job_dir = OUTPUTS_DIR / job_id
    if not job_dir.is_dir():
        return jsonify({"error": "Unknown job_id."}), 404
    return send_from_directory(str(job_dir), filename)


if __name__ == "__main__":
    port = int(os.environ.get("PORT", 5001))
    app.run(host="0.0.0.0", port=port, debug=False, threaded=True)