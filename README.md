# VarunaDrishti

VarunaDrishti is a local-first maritime investigation application for analysing Sentinel-1 SAR scenes. It identifies likely oil-slick pixels, locates the detection, reconstructs its likely origin, projects its forward movement, and ranks vessels whose AIS evidence is consistent with the event.

> Vessel attribution is investigative decision support. A ranking is not proof of causation, and results depend on imagery quality, environmental coverage, and available AIS data.

## What the application does

1. Accepts Sentinel-1 `.SAFE.zip` archives.
2. Extracts scene metadata and embedded geolocation where available.
3. Runs a segmentation model with test-time augmentation to create an oil mask and overlay.
4. Resolves spill geometry and retrieves wind/current history.
5. Runs a backward drift hindcast to estimate a likely origin and release window.
6. Produces a forward drift forecast (24 hours by default).
7. Queries configured vessel sources and ranks candidates using spatial, temporal, track, and anomaly evidence.
8. Streams the nine pipeline stages to the browser and stores completed investigations in memory or optional Supabase storage.

## Architecture

```text
React + Vite (5173)
        |  /api via development proxy
Node + Express (4000)
        |  ML_SERVICE_URL
Flask ML service (5001)
        |
model, scene processing, environment data, drift, AIS attribution
        |
local job outputs + optional Supabase completed-history persistence
```

The frontend communicates with the Express API. Express streams uploads from disk to Flask, proxies job progress and generated files, and converts completed ML results to prediction records.

## Repository layout

```text
frontend/     React 18/Vite UI, maps, result views, history, and batch UI
backend/      Express API gateway, temporary upload handling, optional persistence
ml_service/   Flask job API, model inference, SAFE processing, drift, attribution
summary.md    Detailed project and implementation summary
```

## Run locally

Prerequisites: Node.js 18+ and Python 3.10+ are recommended. Full SAFE and drift support requires the native dependencies pulled in by `ml_service/requirements.txt`.

### 1. Configure the ML service

```powershell
cd ml_service
Copy-Item .env.example .env
pip install -r requirements.txt
python server.py
```

The service looks first for `ml_service/models/best_model.safetensors`. To use a different checkpoint, set `OIL_SPILL_MODEL_PATH` to its path. The service starts in a degraded state when no valid model can be loaded; analysis requests then return `503`.

### 2. Start the backend

In a second terminal:

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run dev
```

By default the backend uses `http://localhost:5001` for `ML_SERVICE_URL` and accepts uploads up to `3072` MB. Keep `MAX_UPLOAD_MB` aligned with the ML service when changing it.

### 3. Start the frontend

In a third terminal:

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. Leave `VITE_API_BASE_URL` empty for local development; Vite will proxy `/api` to port 4000.

## Inputs and pipeline behaviour

| Input | Geolocation requirement |
|---|---|
| Sentinel-1 `.SAFE.zip` | Read from the product metadata. |

The asynchronous job exposes these stages: `extraction`, `preprocessing`, `model_inference`, `segmentation`, `geolocation`, `environmental_data`, `drift_hindcast`, `drift_forecast`, and `vessel_attribution`. Stages can report warnings or be skipped when there is no detected spill, no coverage, or attribution was disabled.

## Configuration

Copy the checked-in `.env.example` files; do not commit `.env` files or service keys.

| Service | Important variables |
|---|---|
| `ml_service` | `PORT`, `OIL_SPILL_MODEL_PATH`, `MAX_UPLOAD_MB`, `GFW_API_TOKEN`, `AISSTREAM_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `backend` | `PORT`, `ML_SERVICE_URL`, `MAX_UPLOAD_MB`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` |
| `frontend` | `VITE_API_BASE_URL` |

AIS and Global Fishing Watch credentials are optional. Without a configured source, vessel attribution reports its available evidence rather than fabricating candidates. Supabase is also optional: completed records remain in process memory when it is not configured and therefore do not survive a backend restart.

## HTTP API

All browser-facing endpoints are under `/api` on the Express service.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health` | Backend health and ML-service reachability. |
| `POST` | `/predictions` | Submit a multipart analysis job. |
| `GET` | `/predictions` | List stored predictions; supports status, confidence, region, and search filters. |
| `GET` | `/predictions/stats/summary` | Return stored-prediction summary statistics. |
| `GET` | `/predictions/:id` | Fetch one completed prediction. |
| `GET` | `/predictions/jobs/:jobId` | Poll stage status and retrieve the finalized prediction ID. |
| `GET` | `/predictions/jobs/:jobId/stream` | Subscribe to Server-Sent Event job updates. |
| `POST` | `/predictions/jobs/:jobId/cancel` | Cancel a queued or running job. |
| `GET` | `/predictions/files/:jobId/:filename` | Stream a generated job output. |
| `POST` | `/predictions/batch` | Create an in-memory batch progress record. |
| `GET` | `/predictions/batch/:batchId` | Read batch progress. |
| `POST` | `/predictions/batch/:batchId/logs` | Add or replace a batch item log. |
| `GET` | `/alerts` | List alerts. |
| `PATCH` | `/alerts/:alertId/read` | Mark one alert read. |
| `PATCH` | `/alerts/read` | Mark all alerts read. |

`POST /predictions` uses `multipart/form-data`. Send a Sentinel-1 SAFE archive as `file` and optionally include `sourceType`, `sensor`, `lookbackDays`, `forecastHours`, and `skipAis`. It returns `202 Accepted` with `jobId`, `statusUrl`, and `streamUrl`.

The Flask service has the corresponding internal API at `/api/spill/*`; see [the ML-service README](ml_service/README.md) for its request contract and model notes.

## Generated and temporary files

The backend stores incoming files temporarily in `backend/uploads/` while forwarding them. Flask creates `ml_service/uploads/` and `ml_service/outputs/<job-id>/` at runtime for working inputs and generated masks, overlays, and trajectory artifacts. These directories are runtime state, not durable case storage.

## Current operational limits

- Jobs and batch records are process-local; restart the ML service during a job and it cannot be recovered.
- Open-Meteo coverage and locally configured in-situ observations determine whether environmental/drift stages can produce a result.
- SAFE archives can be large; provision disk space and match both services' upload limits.
- The project is designed for local development and demonstration.
