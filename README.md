# VarunaDrishti

Oil Spill Detection & Vessel Attribution platform — now fully wired end to
end: **React frontend → Node.js/Express backend → Flask ML service**, with
a live processing/transition screen and a real OpenStreetMap map.

```
React (Vite, :5173)  --/api-->  Express (:4000)  --/api/spill-->  Flask ML service (:5001)
     |                                |                                  |
  upload + live                  proxies job                    runs the real
  progress UI                    submit/status/                 detection + drift +
  + OSM map                      stream/files                   AIS attribution pipeline
```

The frontend only ever talks to the Node backend (same as before) — Node
proxies analysis requests on to the Flask ML service and never exposes it
directly.

## What changed in this pass

1. **Real pipeline instead of the mock.** `POST /api/predictions` now
   forwards the uploaded file to the Flask service and returns a `jobId`
   immediately (detection takes real time - model inference, drift
   simulation, AIS lookups).
2. **A processing/transition screen.** `/processing/:jobId` shows all 8
   pipeline stages (extraction → preprocessing → model inference →
   segmentation → geolocation → environmental data → drift hindcast →
   vessel attribution) updating live via Server-Sent Events, then
   auto-navigates to the results page once the run completes.
3. **A real map.** The results page's map is now OpenStreetMap tiles via
   Leaflet (`frontend/src/components/SpillMap.jsx`) — spill centroid, a
   radius circle sized from the detected area, the estimated drift origin,
   the backward-hindcast trajectory, and AIS vessel candidates plotted at
   their best-known positions, replacing the earlier illustrative SVG mock.
4. **Geolocation inputs.** The "SAR Image + Spatial Metadata" tab on the
   upload page now asks for latitude/longitude/acquisition time (required —
   plain images don't carry embedded geolocation the way `.SAFE.zip`
   archives do), plus optional drift-lookback and skip-AIS controls.

## Project layout

```
oil spill project/
  ml_service/          Flask API wrapping the ML pipeline (model, drift, AIS)
    server.py            HTTP endpoints (job submit/status/stream/files)
    jobs.py               in-memory async job runner
    pipeline.py            same logic as the original app.py, emits JSON stage progress
    model.py, preprocessing.py, safe_processor.py,
    environment.py, drift.py, ais_attribution.py,
    track_based_attribution.py, vessel_risk.py     unchanged detection/geolocation/drift/AIS logic

  backend/              Express API
    server.js
    routes/predictions.js   list/detail/stats + job submit/status/stream/file proxy
    data/store.js            in-memory prediction store + ML-result → Prediction mapping
    data/mlClient.js          axios wrapper for calling ml_service

  frontend/             React app
    src/pages/
      NewPrediction.jsx        upload + parameters (now with lat/lon/timestamp for images)
      Processing.jsx            NEW: live stage-by-stage transition screen
      PredictionResults.jsx     tactical map + AIS attribution sidebar
      PredictionHistory.jsx     audit log
    src/components/
      Header.jsx
      SpillMap.jsx               NEW: Leaflet/OSM map
    src/api.js                    fetch wrapper (+ job polling/streaming)
```

## Running it (three processes)

**1. ML service** (http://localhost:5001):

```bash
cd ml_service
pip install -r requirements.txt
# put your model weights at ml_service/models/model.safetensors
# (or set OIL_SPILL_MODEL_PATH to point elsewhere)
python server.py
```

Environment variables (`ml_service/.env`):
```
GFW_API_TOKEN=...
AISSTREAM_API_KEY=...
OIL_SPILL_MODEL_PATH=/path/to/model.safetensors   # optional override
```

**2. Backend** (http://localhost:4000):

```bash
cd backend
npm install
cp .env.example .env     # ML_SERVICE_URL defaults to http://localhost:5001
npm start                # or `npm run dev` for auto-restart
```

**3. Frontend** (http://localhost:5173):

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:5173. Vite proxies `/api/*` to the Node backend in
dev, so no CORS config is needed. `npm run build` produces a static
`dist/` you can serve from Express or any static host.

> If `ml_service` isn't running, the backend and frontend still start and
> the History/existing-record views still work — `POST /api/predictions`
> and `/api/health`'s `mlService` field will just report it as unreachable
> until you start it.

## API surface (Node backend)

| Method | Path                                        | Description |
|--------|----------------------------------------------|--------------|
| GET    | `/api/health`                                | Liveness check, including ML service reachability |
| GET    | `/api/predictions`                           | List, with `?status=&minConfidence=&region=&search=` |
| GET    | `/api/predictions/stats/summary`             | Dashboard summary metrics |
| GET    | `/api/predictions/:id`                       | Full detail for the results page |
| POST   | `/api/predictions`                           | Upload a file, kicks off a real analysis job, returns `{ jobId }` |
| GET    | `/api/predictions/jobs/:jobId`               | Poll job status/stages; once complete, includes `predictionId` |
| GET    | `/api/predictions/jobs/:jobId/stream`        | Server-Sent Events — live stage updates |
| GET    | `/api/predictions/files/:jobId/:filename`    | Mask/overlay PNG, trajectory CSV/PNG |
| GET    | `/api/incidents`                              | Search and filter oil spill incidents |
| GET    | `/api/incidents/:incidentId`                  | Read one incident |
| PATCH  | `/api/incidents/:incidentId/status`           | Update lifecycle status |

`POST /api/predictions` body (`multipart/form-data`):

| Field | Required | Notes |
|---|---|---|
| `file` | yes | `.SAFE.zip`/`.zip` or a plain SAR image (`.png/.jpg/.tif`) |
| `sourceType` | yes | `"safe_zip"` or `"sar_image"` |
| `latitude`, `longitude` | only for `sar_image` | decimal degrees |
| `timestamp` | no | ISO 8601 UTC acquisition time |
| `lookbackDays` | no | drift hindcast lookback, default 20 |
| `skipAis` | no | `"true"` to skip vessel attribution |

## Notes

- Job state (in `ml_service/jobs.py` and the Node `jobId → predictionId`
  map) is in-memory — fine for local dev/demo; swap for Redis/a DB before
  running multiple workers or needing state to survive a restart.
- `MAX_CONTENT_LENGTH`/multer limits are set generously (500 MB / 2.4 GB)
  for large SAFE archives — tune to your infra.
- The map's vessel/drift-origin positions come straight from the ML
  pipeline's JSON (`result.vessel_attribution.candidates[].position`,
  `result.drift_hindcast`, `result.drift_trajectory_points`) — these fields
  were added to `ais_attribution.py`/`pipeline.py` in this pass, additively,
  without touching any scoring logic.
