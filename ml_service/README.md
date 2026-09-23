# VarunaDrishti ML Service

This Flask service runs the analysis engine behind VarunaDrishti. It accepts a SAR scene, creates an in-memory background job, reports nine stages through polling or Server-Sent Events, and writes analysis artifacts to a per-job output directory.

## Pipeline

1. Extract Sentinel-1 SAFE or image input.
2. Preprocess SAR/image data for the selected segmentation model.
3. Run model inference with test-time augmentation.
4. Create mask and overlay artifacts.
5. Resolve spill geolocation and geometry.
6. Retrieve environmental history.
7. Hindcast likely backward drift and release origin.
8. Forecast forward drift (24 hours by default).
9. Attribute vessel candidates from configured AIS/GFW sources.

The service can return warnings or skipped stages. For example, it does not run drift or attribution after a negative detection, and it does not invent AIS candidates when a data source is unavailable.

## Supported input

| Input | Notes |
|---|---|
| `.SAFE.zip` / `.zip` | Sentinel-1 SAFE archive; metadata supplies location. |

## Setup

```powershell
cd ml_service
Copy-Item .env.example .env
pip install -r requirements.txt
python server.py
```

The default port is `5001`. The service chooses CUDA when PyTorch detects it, otherwise CPU.

### Model checkpoint

`server.py` prioritizes `models/best_model.safetensors`, then scans the local model directories for `.safetensors`, `.safetensor`, or `.pth` files. Set `OIL_SPILL_MODEL_PATH` to override that selection.

If the checkpoint cannot load, the health endpoint reports `degraded`; the server remains available but new analysis requests return `503` until a compatible model is installed.

### Environment

Start from `.env.example`. Key settings are:

| Variable | Meaning |
|---|---|
| `PORT` | Flask listen port (default `5001`). |
| `OIL_SPILL_MODEL_PATH` | Optional absolute or working-directory-relative model path. |
| `MAX_UPLOAD_MB` | Maximum request size; keep it aligned with the Express backend. |
| `GFW_API_TOKEN` | Optional Global Fishing Watch credentials. |
| `AISSTREAM_API_KEY` | Optional AISStream credentials. |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` | Optional remote in-situ current source. |

## API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Model status and selected device. |
| `POST` | `/api/spill/analyze` | Start an asynchronous analysis job. |
| `GET` | `/api/spill/jobs/<job_id>` | Job state, ordered stages, and result when complete. |
| `GET` | `/api/spill/jobs/<job_id>/stream` | Server-Sent Events stage stream. |
| `POST` | `/api/spill/jobs/<job_id>/cancel` | Mark an active job cancelled. |
| `GET` | `/api/spill/files/<job_id>/<filename>` | Return an output owned by that job. |

### Start an analysis

Send `multipart/form-data` to `POST /api/spill/analyze`.

| Field | Required | Description |
|---|---|---|
| `file` | Yes | A supported SAR archive or image. |
| `lookback_days` | No | Hindcast history window; default is `5`. |
| `forecast_hours` | No | Forward projection period; default is `24`. |
| `release_hours_ago` | No | Evidence-based release age, when known. |
| `skip_ais` | No | Boolean to skip vessel attribution. |

Successful submission returns `202 Accepted`:

```json
{
  "job_id": "a1b2c3d4e5f6a7b8",
  "status_url": "/api/spill/jobs/a1b2c3d4e5f6a7b8",
  "stream_url": "/api/spill/jobs/a1b2c3d4e5f6a7b8/stream"
}
```

Terminal job states are `complete`, `failed`, and `cancelled`. Stage values are `pending`, `running`, `success`, `warning`, `error`, or `skipped`.

## Runtime data

- `uploads/` holds Flask-side input copies until the job finishes.
- `outputs/<job-id>/` holds generated masks, overlays, trajectory files, and maps.
- Job state is in memory. It is not shared across processes or retained after a restart.

For the supported local workflow, run `python server.py` and access this service via the Node backend rather than directly from the browser.

## Further implementation detail

The current component-level design is documented in [Architecture.md](Architecture.md). The repository-level setup and browser-facing API are in the [root README](../README.md).
