# API reference

The browser calls the Express API at `http://localhost:4000/api`. Express forwards analysis operations to the Flask ML service at `http://localhost:5001/api`.

## Express API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Backend liveness and ML health. |
| `POST` | `/api/predictions` | Submit a SAFE analysis job. |
| `GET` | `/api/predictions` | List predictions; supports `status`, `minConfidence`, `region`, and `search`. |
| `GET` | `/api/predictions/stats/summary` | Prediction summary statistics. |
| `GET` | `/api/predictions/:id` | One completed prediction. |
| `GET` | `/api/predictions/jobs/:jobId` | Current job state; includes `predictionId` on finalisation. |
| `GET` | `/api/predictions/jobs/:jobId/stream` | Server-Sent Event progress stream. |
| `POST` | `/api/predictions/jobs/:jobId/cancel` | Cancel an active job. |
| `GET` | `/api/predictions/files/:jobId/:filename` | Generated artifact stream. |
| `POST` | `/api/predictions/batch` | Create an in-memory batch record. |
| `GET` | `/api/predictions/batch/:batchId` | Read batch progress. |
| `POST` | `/api/predictions/batch/:batchId/logs` | Add or replace a batch log entry. |
| `GET` | `/api/alerts` | List alerts. |
| `PATCH` | `/api/alerts/:alertId/read` | Mark one alert read. |
| `PATCH` | `/api/alerts/read` | Mark all alerts read. |

### Submit a SAFE job

`POST /api/predictions` expects `multipart/form-data`.

| Field | Required | Notes |
|---|---|---|
| `file` | Yes | Sentinel-1 `.SAFE.zip` archive. |
| `sensor` | No | Display label; defaults in the frontend. |
| `lookbackDays` | No | Hindcast history period in days. |
| `forecastHours` | No | Forward-drift projection period; default `24`. |
| `skipAis` | No | Send `true` to skip vessel attribution. |

The response is `202 Accepted`:

```json
{
  "jobId": "...",
  "statusUrl": "/api/predictions/jobs/...",
  "streamUrl": "/api/predictions/jobs/..."
}
```

## Flask ML API

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Loaded model and compute device. |
| `POST` | `/api/spill/analyze` | Internal asynchronous SAFE job submission. |
| `GET` | `/api/spill/jobs/<job_id>` | Job and result. |
| `GET` | `/api/spill/jobs/<job_id>/stream` | Job SSE stream. |
| `POST` | `/api/spill/jobs/<job_id>/cancel` | Cancel a job. |
| `GET` | `/api/spill/files/<job_id>/<filename>` | Generated ML artifact. |

Job states are `queued`, `processing`, `complete`, `failed`, or `cancelled`. Each stage is `pending`, `running`, `success`, `warning`, `error`, or `skipped`.
