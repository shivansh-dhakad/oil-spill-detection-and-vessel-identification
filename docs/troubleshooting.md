# Troubleshooting

## ML health is `degraded`

The Flask service started but could not load a model. Confirm that `ml_service/models/best_model.safetensors` exists, or set `OIL_SPILL_MODEL_PATH` to a valid checkpoint. Restart the service and check `/api/health` again.

## Backend cannot reach the ML service

Start `ml_service/server.py` first, then confirm `ML_SERVICE_URL` in `backend/.env` is `http://localhost:5001`. Visit `http://localhost:5001/api/health` directly before retrying the backend health endpoint.

## Upload rejected or fails during extraction

Only complete Sentinel-1 `.SAFE.zip` archives are supported. Confirm the archive retains the `.SAFE` directory, `manifest.safe`, annotation metadata, and measurement bands. Do not submit an extracted TIFF or a plain ZIP with unrelated files.

## Upload is too large

Set the same larger `MAX_UPLOAD_MB` value in `backend/.env` and `ml_service/.env`, then restart both services. Ensure the backend and ML service have enough disk space for temporary upload copies and generated output.

## Drift or vessel stages show warnings

Warnings indicate missing or incomplete external evidence, not an application crash. Environmental coverage can be absent for the selected location/time. Vessel attribution also requires usable AIS/GFW coverage and configured credentials. Review the stage message and treat unavailable results as a limitation of the investigation.

## Job never completes

Use the job status endpoint to inspect the last stage and error. The job manager is process-local, so a restart of the ML service loses active work. Review the ML-service terminal output for the underlying model, SAFE extraction, or external-data error.

## Frontend cannot call the backend

For the local setup, leave `VITE_API_BASE_URL` blank and run Vite on port 5173. If you set an API URL, it must point to a reachable Express origin. Check `http://localhost:4000/api/health` before debugging the browser.
