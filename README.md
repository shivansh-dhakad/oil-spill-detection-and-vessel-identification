# VarunaDrishti (वरुणदृष्टि) 🌊🛰️

**AI-Powered Satellite Oil Spill Detection & Maritime Vessel Attribution Platform**

VarunaDrishti combines Sentinel-1 Synthetic Aperture Radar (SAR) imagery, deep learning segmentation (UNet++ / SegFormer), oceanographic drift hindcasting, and real-time/historical AIS telemetry (Global Fishing Watch & AISStream) to detect oil slicks and attribute responsibility to maritime vessels.

---

## System Architecture

```
                                  ┌──────────────────────────────────────────────┐
                                  │             Browser (End User)               │
                                  └──────────────────────┬───────────────────────┘
                                                         │ HTTPS
                                                         ▼
                                  ┌──────────────────────────────────────────────┐
                                  │        Vercel (React / Vite Frontend)        │
                                  │       https://varunadrishti.vercel.app       │
                                  └──────────────────────┬───────────────────────┘
                                                         │ /api/* (VITE_API_BASE_URL)
                                                         ▼
                                  ┌──────────────────────────────────────────────┐
                                  │         Render (Node.js Express API)         │
                                  │   https://varunadrishti-backend.onrender.com │
                                  └──────────────┬────────────────────────┬──────┘
                                                 │                        │
                    Persists / Hydrates analysis │                        │ Analysis job forwarding
                    records & audit trail        │                        │ (ML_SERVICE_URL)
                                                 ▼                        ▼
                      ┌────────────────────────────────────┐    ┌────────────────────────────────────────┐
                      │         Supabase Database          │    │    Hugging Face Spaces (ML Engine)     │
                      │  • predictions (Results & reports) │    │    https://<user>-<space>.hf.space      │
                      │  • insitu_currents (Ocean vectors) │    │    • FastAPI + Gradio Wrapper (port 7860)
                      └─────────────────▲──────────────────┘    │    • PyTorch UNet++ / SegFormer Model   │
                                        │                       │    • OpenDrift Backward Hindcast       │
                                        └───────────────────────┤    • Bayesian AIS Vessel Attribution   │
                                          Remote currents query │    • 16 GB Free RAM (prevents OOM)     │
                                          (eliminates 500MB CSV)└────────────────────────────────────────┘
```

---

## Key Features

1. **End-to-End Pipeline**:
   - **Satellite Ingestion**: Supports raw Sentinel-1 `.SAFE.zip` archives or pre-cropped SAR images with spatial metadata.
   - **Deep Learning Segmentation**: Dual support for UNet++ (`unetpp_best.pth`) and SegFormer-B2 (`model.safetensors`).
   - **Environmental Geolocation**: Retrieves in-situ ocean currents (Copernicus / Argo drifters) and wind vectors (Open-Meteo).
   - **Backward Drift Hindcast**: Simulates reverse slick trajectory to estimate original spill coordinates and release time.
   - **Bayesian Vessel Attribution**: Correlates drift origin with AIS historical tracking data to rank suspect vessels with confidence scoring.
2. **Live Transition Screen**: Real-time 8-stage progress reporting streamed live via Server-Sent Events (SSE) before navigating to results.
3. **Interactive Tactical Map**: OpenStreetMap Leaflet map rendering spill polygons, uncertainty radius, hindcast trajectory, and suspect vessel coordinates.
4. **Persistent History**: Supabase PostgreSQL database persistence ensures analysis reports and audit logs survive server redeployments.
5. **100% Free-Tier Cloud Compatible**: Specially optimized to run across Vercel, Render, Hugging Face Spaces, and Supabase free tiers with zero hosting costs.

---

## Project Structure

```
oil spill project/
├── frontend/                     # React + Vite Client
│   ├── src/
│   │   ├── pages/                # NewPrediction, Processing, PredictionResults, History, IncidentManagement
│   │   ├── components/           # SpillMap (Leaflet), AnalysisReport, Stage3D, Header, etc.
│   │   └── api.js                # API client with VITE_API_BASE_URL support
│   ├── vercel.json               # SPA route rewrite configuration for Vercel
│   └── vite.config.js            # Vite configuration with local proxy
│
├── backend/                      # Node.js + Express API Gateway
│   ├── server.js                 # Server entry point, CORS, and Supabase hydration
│   ├── routes/predictions.js     # Analysis job submission, streaming, polling, and incident management
│   ├── data/
│   │   ├── store.js              # Prediction store with auto-persistence
│   │   ├── supabaseClient.js     # Supabase REST client wrapper
│   │   └── mlClient.js           # Forwarding client to ML engine (Render / HF Spaces)
│   ├── scripts/
│   │   └── upload_currents_to_supabase.js  # Stream & upload in-situ ocean currents
│   └── supabase_schema.sql       # PostgreSQL schema (predictions + insitu_currents tables)
│
└── ml_service/                   # Python ML & Attribution Engine
    ├── app_hf.py                 # Hugging Face Spaces entrypoint (FastAPI + Gradio + Flask mount)
    ├── server.py                 # Flask REST API (analysis endpoints & SSE streaming)
    ├── model.py                  # PyTorch model loader (UNet++ & SegFormer)
    ├── pipeline.py               # Complete 8-stage detection & attribution pipeline
    ├── drift.py                  # Backward trajectory simulation & OpenDrift integration
    ├── ais_attribution.py        # Bayesian ship attribution & scoring engine
    ├── insitu_currents.py        # Copernicus in-situ currents retrieval (SQLite / Supabase / CSV)
    ├── upload_currents_to_supabase.py # Python script for currents extraction & upload
    ├── insitu_clean.csv          # Clean paired surface currents (17 MB, 233,996 records)
    ├── requirements.txt          # Python dependencies (includes torch, gradio, fastapi, uvicorn)
    └── models/                   # Model checkpoints (unetpp_best.pth, isolation_forest.joblib)
```

---

## Running Locally

### 1. ML Service (Port 5001 or 7860)

```bash
cd ml_service
pip install -r requirements.txt
python server.py
# Or run with Hugging Face wrapper:
# python app_hf.py
```

Environment configuration (`ml_service/.env`):
```env
PORT=5001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_key
GFW_API_TOKEN=your_gfw_token_here          # Optional: Global Fishing Watch
AISSTREAM_API_KEY=your_aisstream_key_here  # Optional: Real-time AIS
```

### 2. Backend (Port 4000)

```bash
cd backend
npm install
npm run dev
```

Environment configuration (`backend/.env`):
```env
PORT=4000
ML_SERVICE_URL=http://localhost:5001
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_SERVICE_KEY=your_supabase_service_role_key
```

### 3. Frontend (Port 5173)

```bash
cd frontend
npm install
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Requests to `/api/*` are automatically proxied to `http://localhost:4000`.

---

## Free-Tier Cloud Deployment Guide

| Tier | Platform | Build Command | Start Command / Entrypoint |
|---|---|---|---|
| **Frontend** | **Vercel** | `npm run build` | `dist/` |
| **Backend** | **Render** | `npm install` | `node server.js` |
| **ML Engine** | **Hugging Face Spaces** | `pip install -r requirements.txt` | `app.py` (renamed from `app_hf.py`) |
| **Database** | **Supabase** | N/A | PostgreSQL SQL Editor |

### 1. Supabase Database Setup
1. Create a project on [Supabase](https://supabase.com).
2. Open **SQL Editor** → **New Query**, paste [`backend/supabase_schema.sql`](file:///c:/Users/shiva/Desktop/oil%20spill%20project%202/oil%20spill%20project/backend/supabase_schema.sql), and click **Run**.
3. In **Table Editor** → select **`insitu_currents`** → **Insert** → **Import data from CSV**, upload [`ml_service/insitu_clean.csv`](file:///c:/Users/shiva/Desktop/oil%20spill%20project%202/oil%20spill%20project/ml_service/insitu_clean.csv) (17 MB).

### 2. Deploy ML Service on Hugging Face Spaces
1. Create a new Space on [Hugging Face](https://huggingface.co/spaces) with SDK: **Gradio**, Hardware: **CPU Basic (16 GB RAM — Free)**.
2. Push the contents of `ml_service/` to the Space repository.
3. Rename `app_hf.py` to `app.py` in the Space root.
4. Add Space Secrets:
   - `SUPABASE_URL` = your Supabase URL
   - `SUPABASE_SERVICE_KEY` = your Supabase key
5. Note your public Space URL: `https://<user>-<space-name>.hf.space`.

### 3. Deploy Backend on Render
1. Create a new **Web Service** on [Render](https://render.com) connected to your repository with root directory `backend`.
2. Add Environment Variables:
   - `PORT` = `4000`
   - `ML_SERVICE_URL` = `https://<user>-<space-name>.hf.space`
   - `SUPABASE_URL` = your Supabase URL
   - `SUPABASE_SERVICE_KEY` = your Supabase service role key
   - `FRONTEND_URL` = `https://varunadrishti.vercel.app`

### 4. Deploy Frontend on Vercel
1. Import your repository into [Vercel](https://vercel.com) with root directory `frontend`.
2. Set Environment Variable:
   - `VITE_API_BASE_URL` = `https://varunadrishti-backend.onrender.com`
3. Deploy!

---

## API Documentation

### Node.js Backend (`/api/*`)

| Method | Endpoint | Description |
|---|---|---|
| `GET` | `/api/health` | Service liveness & ML engine reachability |
| `GET` | `/api/predictions` | Query historical predictions with filters |
| `GET` | `/api/predictions/stats/summary` | Global stats (slick area, detections, confidence) |
| `GET` | `/api/predictions/:id` | Detailed record with candidates and map data |
| `POST` | `/api/predictions` | Upload image / SAFE file & trigger analysis job |
| `GET` | `/api/predictions/jobs/:jobId` | Poll 8-stage job execution progress |
| `GET` | `/api/predictions/jobs/:jobId/stream` | Server-Sent Events (SSE) live progress stream |
| `GET` | `/api/predictions/files/:jobId/:file` | Fetch generated masks, overlays, and trajectories |
| `GET` | `/api/incidents` | Incident management and tracking |
| `PATCH` | `/api/incidents/:id/status` | Update incident review status |

---

## License

Apache 2.0 / MIT — Built for maritime environmental surveillance and conservation.
