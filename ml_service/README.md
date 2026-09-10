# Oil Spill Detection & Attribution ML Service

A Flask microservice that takes a satellite image or Sentinel-1 `.SAFE.zip` SAR
archive and returns:

1. **Oil spill detection** — semantic segmentation (SegFormer-B2 / legacy UNet++)
2. **Geolocation** — pixel mask → real-world lat/lon, using SAFE product geocoding
3. **Backward drift hindcast** — where the oil most likely came from, using
   OpenDrift particle backtracking against ocean current + wind history
4. **Vessel attribution** — ranks candidate vessels (AIS/GFW data) by how
   plausible they are as the source, using spatial/temporal/behavioral scoring
   and an Isolation Forest anomaly model

It's designed to run as an internal microservice behind a Node/Express or
similar backend, which proxies requests to it and relays JSON to a frontend.

See **[ARCHITECTURE.md](./ARCHITECTURE.md)** for the full pipeline design and
data flow.

---

## Features

- Accepts plain images (`.png/.jpg/.tif/.bmp`) **or** Sentinel-1 `.SAFE.zip`
  archives (SAFE archives carry their own geolocation — no manual lat/lon needed)
- Two-model support: SegFormer-B2 `.safetensors` (preferred) or a legacy
  UNet++ `.pth` checkpoint, auto-detected from the checkpoint file
- SAR-specific preprocessing: dual-pol (VV/VH) calibration to sigma0 dB,
  pseudo-RGB conversion, exact training-time resize/normalization
- Ocean current and wind data retrieval from Open-Meteo with local CSV in-situ fallback:
  **Open-Meteo (2022+) → Copernicus In-Situ Marine CSV (`INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048`) → wind-only drift**
- Coastline-aware drift simulation (OpenDrift + GSHHS landmask) so origins
  never land on dry ground
- Vessel attribution against Global Fishing Watch and/or AISStream, with a
  trained Isolation Forest scoring anomalous vessel behavior
- Async job model: upload returns immediately with a `job_id`; progress is
  polled or streamed live via Server-Sent Events

---

## Project Structure

```
.
├── server.py                  Flask API — routes, uploads, model load at startup
├── jobs.py                    In-memory async job manager (background thread per upload)
├── pipeline.py                Stage-emitting orchestrator — the actual pipeline logic
├── model.py                   Model loading (SegFormer / UNet++) + inference
├── preprocessing.py           Image validation, resize/normalize, mask/overlay generation
├── safe_processor.py          Sentinel-1 .SAFE.zip parsing, SAR calibration, geolocation
├── environment.py             Open-Meteo ocean current + wind history client
├── insitu_currents.py         Copernicus in-situ CSV current parser (fallback for pre-2022 / missing data)
├── drift.py                   OpenDrift backward drift simulation (Open-Meteo / In-situ CSV currents + wind)
├── ais_attribution.py         Stage 3 orchestrator — AIS/GFW candidate collection + scoring
├── track_based_attribution.py Trajectory-based scoring (spatial/temporal/drift/speed)
├── vessel_risk.py             Isolation Forest anomaly scoring for candidate vessels
├── app.py                     Interactive CLI entrypoint (same pipeline, terminal output)
├── models/                    Model checkpoints (not committed — see below)
├── data/                      In-situ ocean current CSV archive (Copernicus Marine INSITU_GLO_PHY_UV_DISCRETE_NRT_013_048)
├── uploads/                   Saved user uploads (created at runtime)
├── outputs/                   Generated masks, overlays, trajectories, attribution JSON
└── requirements.txt
```

---

## Setup

### 1. Install dependencies

```bash
pip install -r requirements.txt
```

> `opendrift`, `rasterio`, and `segmentation-models-pytorch`
> are heavier/optional-ish dependencies — drift simulation and SAFE archive
> support degrade gracefully (with a clear error) if they're missing, but
> install them for full functionality.

### 2. Get a model checkpoint

Place one of these under `models/` (checked in this order):

| Path                              | Format             |
|------------------------------------|--------------------|
| `models/unetpp_best.pth`           | Legacy UNet++      |
| `models/best.pth`                  | Legacy UNet++      |
| `models/model.safetensors`         | SegFormer-B2 (preferred) |
| `models/final_statedict.pth`       | Legacy UNet++      |

Or point directly at one with the `OIL_SPILL_MODEL_PATH` env var.

### 3. Configure environment variables

Create a `.env` file next to `server.py`:

```bash
# --- Model ---
OIL_SPILL_MODEL_PATH=models/model.safetensors   # optional override

# --- Server ---
PORT=5001
MAX_UPLOAD_MB=3072          # SAFE archives can be 700MB-1.5GB+

# --- Vessel attribution (optional — attribution runs in PRESENCE_ONLY/UNAVAILABLE
#     mode without these, but real AIS data needs at least one) ---
GFW_API_TOKEN=your_global_fishing_watch_token
AISSTREAM_API_KEY=your_aisstream_key
```

### 4. Run it

```bash
# Development
python server.py

# Production
gunicorn -w 1 -b 0.0.0.0:5001 --timeout 300 server:app
```

> Use a **single worker** (`-w 1`) unless you make model loading per-worker-safe
> and have the GPU/RAM budget for it — the model is loaded once per process at
> startup.

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `GET`  | `/api/health` | Model/device status |
| `POST` | `/api/spill/analyze` | Upload a file, kicks off a job, returns `job_id` |
| `GET`  | `/api/spill/jobs/<job_id>` | Full job status, stages, and result once complete |
| `GET`  | `/api/spill/jobs/<job_id>/stream` | Server-Sent Events live progress stream |
| `GET`  | `/api/spill/files/<job_id>/<name>` | Serves generated files (mask, overlay, trajectory CSV/PNG) |

### `POST /api/spill/analyze` — multipart/form-data

| Field | Required | Notes |
|---|---|---|
| `file` | yes | `.zip`/`.png`/`.jpg`/`.tif`/`.bmp` |
| `latitude`, `longitude` | plain images only | SAFE archives self-geolocate |
| `timestamp` | plain images only | ISO 8601 UTC; defaults to now |
| `lookback_days` | no | Currents/wind history window (default 20) |
| `release_hours_ago` | no | If you already know the release age |
| `skip_ais` | no | Skip Stage 3 vessel attribution |

Returns `202 Accepted` with:
```json
{ "job_id": "...", "status_url": "...", "stream_url": "..." }
```

Poll `status_url` (or subscribe to `stream_url`) until `status` is
`complete` or `failed`.

---

## Known Limitations

- Open-Meteo's ocean-current model (SMOC) has coverage from Jan 2022 onward.
- Vessel attribution quality depends entirely on AIS data availability in the
  search window — vessels with AIS off (deliberately or not) won't appear.
- Single-worker deployment recommended; see gunicorn note above.