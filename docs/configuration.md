# Configuration reference

Copy each `.env.example` to a local `.env` before starting that service. Do not commit `.env` files or keys.

## ML service (`ml_service/.env`)

| Variable | Default / purpose |
|---|---|
| `PORT` | `5001`; Flask listen port. |
| `HOST` | `0.0.0.0`; Flask bind host. |
| `OIL_SPILL_MODEL_PATH` | Optional model checkpoint override. |
| `MAX_UPLOAD_MB` | `3072`; maximum SAFE upload size. |
| `GFW_API_TOKEN` | Optional Global Fishing Watch token. |
| `AISSTREAM_API_KEY` | Optional AISStream key. |
| `SUPABASE_URL` | Optional Supabase URL for remote current observations. |
| `SUPABASE_SERVICE_KEY` | Optional Supabase service/anon key matching the table policy. |

`server.py` first checks `OIL_SPILL_MODEL_PATH`, then prioritizes `models/best_model.safetensors`, then scans supported local checkpoint extensions.

## Backend (`backend/.env`)

| Variable | Default / purpose |
|---|---|
| `PORT` | `4000`; Express listen port. |
| `ML_SERVICE_URL` | `http://localhost:5001`; Flask service URL. |
| `MAX_UPLOAD_MB` | `3072`; must be at least the ML service value. |
| `SUPABASE_URL` | Optional persistence database URL. |
| `SUPABASE_SERVICE_KEY` | Optional persistence service-role key. |

Without Supabase, completed prediction records remain available only while the backend process is running.

## Frontend (`frontend/.env`)

| Variable | Purpose |
|---|---|
| `VITE_API_BASE_URL` | Leave blank for local Vite proxying; otherwise set the API origin. |

## Optional services

Environmental data and AIS providers may be unavailable for a particular time/location even with valid credentials. The pipeline records that limitation in the stage status and final investigation result.
