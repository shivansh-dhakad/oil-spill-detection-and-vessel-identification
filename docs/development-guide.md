# Development guide

## Repository layout

```text
frontend/
  src/pages/         Route-level UI screens
  src/components/    Map, report, status, and visual components
  src/api.js         Browser API client
backend/
  server.js          Express start-up, health, and alerts
  routes/            Prediction and batch routes
  data/              ML client, prediction store, Supabase support
ml_service/
  server.py          Flask API entry point
  jobs.py            In-memory background jobs
  pipeline.py        Nine-stage analysis orchestration
  safe_processor.py  Sentinel-1 SAFE parsing and geolocation
  models/            Local segmentation and attribution artifacts
docs/                Maintained project documentation
```

## Commands

Run these from the named service directory.

| Service | Install | Start | Verification |
|---|---|---|---|
| Frontend | `npm install` | `npm run dev` | `npm run build` |
| Backend | `npm install` | `npm run dev` | `node --check routes/predictions.js` |
| ML service | `pip install -r requirements.txt` | `python server.py` | `python -m py_compile server.py jobs.py pipeline.py preprocessing.py` |

## Change workflow

1. Identify the owning layer: UI, Express API, data mapping, Flask API, or pipeline.
2. Keep `frontend/src/api.js` aligned with Express route requests and responses.
3. Keep `backend/data/mlClient.js` forwarding fields aligned with Flask's `server.py` request parser.
4. When a pipeline stage changes, update `STAGE_NAMES` in `ml_service/pipeline.py`, job display logic, and the documentation.
5. When the completed ML result changes, update `createPredictionFromMlResult()` in `backend/data/store.js` and result-page consumers.
6. Run the targeted verification, then update the relevant guide in `docs/`.

## Local integration check

After a change that crosses service boundaries:

1. Confirm Flask `/api/health` reports a loaded model.
2. Confirm Express `/api/health` reports a reachable ML service.
3. Run the Vite application at port 5173.
4. Submit a valid SAFE archive.
5. Verify live stages, terminal status, result navigation, generated file access, and history entry creation.

## Adding functionality

### Frontend pages

Create a page in `frontend/src/pages/`, register it in `App.jsx`, update `Header.jsx` when navigation changes, and make calls through `api.js`. Keep the route theme logic in `App.jsx` consistent with any new page styling.

### Backend routes

Add prediction-related endpoints to `backend/routes/predictions.js`. Use a focused data helper for ML or persistence access. Return meaningful JSON errors and retain disk-backed streaming for large SAFE archives.

### ML outputs

Write generated artifacts only under `ml_service/outputs/<job-id>/`. Include their basenames in result data and serve them through the job-file endpoint. Do not return arbitrary local paths to the browser.

## Documentation maintenance

Keep detailed material in this folder and the root README as its short entry point. Update `safe-input.md` for input validation changes, `configuration.md` for `.env` changes, `api.md` for contract changes, `architecture.md` and `project-summary.md` for workflow changes, and `troubleshooting.md` when a recurring failure gains a reliable resolution.
