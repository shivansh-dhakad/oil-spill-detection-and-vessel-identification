# VarunaDrishti Project Summary

## 1. Project Purpose

VarunaDrishti is an AI-assisted maritime surveillance platform for detecting oil spills in Sentinel-1 SAR imagery and investigating possible vessel sources.

The complete workflow is:

1. Upload a SAR scene.
2. Detect possible oil-spill pixels using a segmentation model.
3. Generate a mask and visual overlay.
4. Convert the detected spill into geographic coordinates.
5. Retrieve wind and ocean-current history.
6. Run a backward drift simulation to estimate the spill origin and release time.
7. Compare the estimated origin with AIS vessel data.
8. Rank candidate vessels according to spatial, temporal, trajectory, and behavioral evidence.
9. Display maps, reports, alerts, history, and investigation results in the frontend.

The project is divided into three main services:

- `frontend`: React user interface.
- `backend`: Node.js/Express API and persistence layer.
- `ml_service`: Python/Flask machine-learning and scientific-analysis service.

---

## 2. Technology Stack, APIs, and Data Storage

### 2.1 Technology Stack

| Layer | Technologies | Main responsibility |
|---|---|---|
| Frontend | React 18, Vite, React Router, Framer Motion | User interface, navigation, progress display, and result visualization |
| Styling | Tailwind CSS, PostCSS, custom CSS | Responsive layout, dark command-center theme, animations, and Leaflet styling |
| Mapping | Leaflet, React Leaflet, OpenStreetMap tiles | Spill geometry, vessel locations, drift paths, and interactive map controls |
| Backend | Node.js, Express, Multer, Axios, Morgan, CORS | Upload handling, API gateway, ML-service proxying, alerts, and result storage |
| Database | Supabase PostgreSQL with JSONB fields | Optional durable storage for predictions, candidates, reports, maps, and files metadata |
| ML API | Python, Flask, Flask-CORS | Asynchronous analysis jobs, progress streaming, and generated-file delivery |
| ML and science | PyTorch, OpenCV, NumPy, OpenDrift, Pandas, SciPy, PyProj | Segmentation, image processing, geospatial work, environmental modelling, and drift simulation |
| Vessel analysis | AIS/GFW integrations, scikit-learn/joblib Isolation Forest | AIS candidate collection, vessel scoring, and behavioral anomaly analysis |

### 2.2 APIs Used by the Application

#### Frontend-to-backend API

The browser normally calls the Node backend under the `/api` prefix:

- `GET /api/health`: checks backend and ML-service health.
- `POST /api/predictions`: uploads a SAR file and starts an analysis job.
- `GET /api/predictions/jobs/:jobId`: returns job progress and the completed ML result.
- `GET /api/predictions/jobs/:jobId/stream`: streams live progress using Server-Sent Events.
- `POST /api/predictions/jobs/:jobId/cancel`: cancels an active job.
- `GET /api/predictions/:id`: retrieves a stored prediction.
- `GET /api/predictions`: lists predictions with filters.
- `GET /api/predictions/stats/summary`: returns dashboard statistics.
- `GET /api/predictions/files/:jobId/:filename`: streams generated masks, overlays, and trajectory files.
- `GET /api/alerts`: returns oil-spill alerts.
- `PATCH /api/alerts/:alertId/read`: marks one alert as read.
- `PATCH /api/alerts/read`: clears all alerts.

#### Backend-to-ML-service API

The Node backend communicates with the Flask service through the configured `ML_SERVICE_URL`:

- `GET /api/health`: checks model and ML-service status.
- `POST /api/spill/analyze`: accepts a multipart file and analysis parameters.
- `GET /api/spill/jobs/<job_id>`: returns ML job status and result data.
- `GET /api/spill/jobs/<job_id>/stream`: sends ML progress events.
- `POST /api/spill/jobs/<job_id>/cancel`: requests job cancellation.
- `GET /api/spill/files/<job_id>/<filename>`: serves generated output files.

#### External data APIs and sources

- Open-Meteo marine/current data: ocean-current history and marine conditions.
- Open-Meteo weather data: historical or fallback wind information.
- Global Fishing Watch 4Wings: vessel presence and identity information.
- AISStream: live or recent AIS vessel tracks when configured.
- Local Copernicus Marine CSV: in-situ current observations used as a fallback.
- OpenStreetMap tile service: map background tiles in the frontend.

### 2.3 Database and Storage

The project uses Supabase, which provides a PostgreSQL database, as optional durable storage.

The main database table is defined in `backend/supabase_schema.sql`. It stores prediction records including:

- Prediction ID, job ID, timestamps, source type, and sensor.
- Detection status, confidence, severity, and model name.
- Region latitude, longitude, and region name.
- Slick area and area-measurement metadata.
- Weather and ocean-current values.
- Drift-hindcast information.
- Vessel candidates and attribution evidence as JSONB.
- Investigation summaries, map data, and generated-file metadata as JSONB.

There are three important storage locations:

- `backend/uploads/`: temporary files received by the Node backend.
- `ml_service/uploads/`: temporary files received by the Flask ML service.
- `ml_service/outputs/<job_id>/`: masks, overlays, thumbnails, trajectory CSV files, and trajectory maps.

The backend and ML job managers keep active state in memory. Supabase is used to preserve completed prediction records when configured, but active jobs do not survive a service restart.

---

## 3. High-Level Architecture

```text
User
  |
  v
React/Vite Frontend
  |
  | HTTP, Server-Sent Events
  v
Node.js/Express Backend
  |
  | Upload proxy, job status, result storage
  v
Python/Flask ML Service
  |
  +-- Image segmentation
  +-- Geolocation
  +-- Wind/current retrieval
  +-- Backward drift hindcast
  +-- AIS vessel attribution
  |
  v
Prediction result, maps, files, and reports
```

The frontend normally communicates only with the Node backend. The backend forwards analysis requests to the ML service and protects the frontend from needing to know the internal ML-service URL.

---

## 4. Frontend

### 3.1 Technology

The frontend uses:

- React 18
- Vite
- React Router
- Framer Motion for transitions and animation
- Leaflet and React Leaflet for maps
- Tailwind CSS and custom CSS for the visual theme

Important configuration files:

- `frontend/package.json`: dependencies and scripts.
- `frontend/vite.config.js`: Vite configuration and development proxy.
- `frontend/src/main.jsx`: React entry point.
- `frontend/src/App.jsx`: application shell and route definitions.
- `frontend/src/api.js`: frontend API client.
- `frontend/src/index.css`: global styling, dark glass theme, Leaflet overrides, and animations.

### 3.2 Frontend Routes

Routes are registered in `frontend/src/App.jsx`.

- `/`: dashboard and new-prediction upload screen.
- `/results/:id`: detailed prediction result and investigation page.
- `/history`: stored prediction history and statistics.
- `/batch`: batch-processing interface.
- `/incidents`: incident-management interface.

### 3.3 Main Components

- `Header.jsx`
  - Navigation links.
  - Notification bell and alert list.
  - Polls for new oil-spill alerts.
  - Allows individual alert opening and clearing all alerts.

- `AnalysisModal.jsx`
  - Displays live analysis progress.
  - Uses Server-Sent Events when available.
  - Falls back to polling job status.
  - Supports cancellation.

- `SpillMap.jsx`
  - Renders the Leaflet/OpenStreetMap investigation map.
  - Shows the detected spill area.
  - Shows the estimated drift origin.
  - Draws vessel positions and selected vessel tracks.
  - Draws distance lines and drift trajectories.
  - Displays the map legend and vessel markers.

- `AnalysisReport.jsx`
  - Displays the detailed ML analysis report.
  - Shows detection confidence, environmental data, drift information, and attribution evidence.
  - Provides links to generated masks, overlays, trajectory files, and reports.

- `PredictionResults.jsx`
  - Loads a completed prediction.
  - Displays detection status and map information.
  - Displays Hydrodynamic Telemetry.
  - Displays vessel attribution cards.
  - Allows the user to select a vessel and inspect its track.
  - Uses rank-colored badges and selected-card styling for vessel candidates.

- `NewPrediction.jsx`
  - Starts a new prediction job from the dashboard.

- `PredictionHistory.jsx`
  - Lists previous prediction records and allows filtering.

- `BatchProcessing.jsx`
  - Provides a batch-processing interface for multiple SAFE products.

- `IncidentManagement.jsx`
  - Provides an incident lifecycle interface.

- `AmbientField.jsx`, `GradientWaves.jsx`, `OrbitHero.jsx`, `Stage3D.jsx`
  - Provide the application's visual background, animated hero content, and stage visualization.

- `ErrorBoundary.jsx`
  - Prevents an uncaught React component error from taking down the entire interface.

### 3.4 Frontend Prediction Flow

1. The user selects an input file.
2. The frontend calls `api.createPrediction()`.
3. The backend returns a job ID immediately.
4. `AnalysisModal.jsx` listens for job progress.
5. When the ML job completes, the backend creates a stored prediction record.
6. The frontend navigates to `/results/:id`.
7. `PredictionResults.jsx` loads the completed record and renders the map, files, telemetry, and vessel rankings.

### 3.5 Frontend API Client

`frontend/src/api.js` contains methods for:

- Health checks.
- Prediction listing and retrieval.
- Statistics.
- Incident listing and status updates.
- Alert listing and read operations.
- Prediction creation.
- Job polling, streaming, and cancellation.
- Generated-file URLs.

The API base is controlled by `VITE_API_BASE_URL`. When it is not set, the frontend uses the current origin and the `/api` path.

---

## 5. Backend

### 4.1 Technology and Responsibilities

The backend is a Node.js application using:

- Express
- Multer for file uploads
- Axios for communication with the ML service
- Supabase client for optional persistence
- CORS and Morgan middleware

Important files:

- `backend/server.js`: Express application and top-level routes.
- `backend/routes/predictions.js`: prediction and ML-job routes.
- `backend/data/mlClient.js`: ML-service HTTP client.
- `backend/data/store.js`: prediction transformation, in-memory state, alerts, and filtering.
- `backend/data/supabaseClient.js`: Supabase conversion and persistence.
- `backend/supabase_schema.sql`: database schema.
- `backend/package.json`: Node dependencies and scripts.

### 4.2 Registered Backend Endpoints

General endpoints:

- `GET /api/health`
- `GET /api/alerts`
- `PATCH /api/alerts/:alertId/read`
- `PATCH /api/alerts/read`

Prediction endpoints:

- `GET /api/predictions`
- `GET /api/predictions/stats/summary`
- `GET /api/predictions/:id`
- `POST /api/predictions`
- `GET /api/predictions/jobs/:jobId`
- `POST /api/predictions/jobs/:jobId/cancel`
- `GET /api/predictions/jobs/:jobId/stream`
- `GET /api/predictions/files/:jobId/:filename`

### 4.3 Upload and Proxy Flow

1. Express receives a multipart upload at `POST /api/predictions`.
2. Multer stores the upload temporarily in `backend/uploads/`.
3. The backend streams the file to the Python ML service instead of buffering large SAFE archives in memory.
4. The ML service returns a job ID.
5. The backend returns the job ID, status URL, and stream URL to the frontend.
6. The backend proxies job status, Server-Sent Events, cancellation, and generated output files.
7. The temporary Node upload is deleted after it has been handed to the ML service.

This design is important because Sentinel-1 SAFE archives can be very large.

### 4.4 Result Storage

When the ML job is complete:

1. The backend reads the ML result.
2. `store.js` converts snake_case ML fields to the frontend's camelCase shape.
3. The prediction receives an application ID.
4. The result is held in memory.
5. If Supabase credentials are configured, the result is also upserted into Supabase.
6. On backend startup, stored predictions can be loaded from Supabase.

The store also provides:

- Prediction filtering.
- Summary statistics.
- Alert generation for detected spills.
- Alert read state.
- Candidate vessel transformation.
- Proximity calculations for vessel display.

### 4.5 Supabase

Supabase is optional. The schema stores:

- Prediction identity and timestamps.
- Sensor and source type.
- Detection status and confidence.
- Geographic region.
- Slick area.
- Weather and current data.
- Drift information.
- Vessel candidates.
- Investigation summaries.
- Map data.
- Generated-file metadata.

The database schema is in `backend/supabase_schema.sql`.

---

## 6. ML Service

### 5.1 Technology

The ML service is a Python Flask application. It runs asynchronously through a background job manager.

Important files:

- `ml_service/server.py`: Flask API and file-serving routes.
- `ml_service/jobs.py`: in-memory background job manager.
- `ml_service/pipeline.py`: complete analysis pipeline.
- `ml_service/model.py`: model loading and inference.
- `ml_service/preprocessing.py`: image processing, masks, overlays, and thumbnails.
- `ml_service/safe_processor.py`: Sentinel-1 SAFE archive processing and geolocation.
- `ml_service/environment.py`: current and wind data retrieval.
- `ml_service/insitu_currents.py`: local Copernicus current-data fallback.
- `ml_service/drift.py`: backward drift simulation and origin estimation.
- `ml_service/ais_attribution.py`: AIS candidate collection and attribution scoring.
- `ml_service/track_based_attribution.py`: detailed vessel-track scoring.
- `ml_service/vessel_risk.py`: Isolation Forest vessel behavior scoring.
- `ml_service/requirements.txt`: Python dependencies.

### 5.2 ML Service Endpoints

- `GET /api/health`
- `POST /api/spill/analyze`
- `GET /api/spill/jobs/<job_id>`
- `GET /api/spill/jobs/<job_id>/stream`
- `POST /api/spill/jobs/<job_id>/cancel`
- `GET /api/spill/files/<job_id>/<filename>`

### 5.3 Pipeline Stages

The pipeline in `ml_service/pipeline.py` performs the following stages.

#### Stage 1: Extraction

The service detects whether the input is:

- A Sentinel-1 SAFE ZIP archive.
- A normal image such as PNG, JPG, TIFF, or BMP.

SAFE archives are parsed for SAR measurements, metadata, calibration information, and geographic information. Plain images require latitude and longitude from the request.

#### Stage 2: Preprocessing

The input is converted into the format expected by the selected model.

Processing includes:

- Image reading and validation.
- Resizing.
- SAR normalization for SAFE products.
- Model-specific input sizing.
- Tensor conversion.

The repository contains a legacy UNet++ checkpoint, and the code also supports a SegFormer-style model configuration.

#### Stage 3: Model Inference

The segmentation model produces a probability map for oil-spill pixels.

The service calculates:

- Predicted class.
- Confidence percentage.
- Oil pixel count.
- Spill coverage percentage.
- Binary segmentation mask.

If no oil spill is detected, later geolocation, drift, and vessel-attribution stages are skipped.

#### Stage 4: Mask and Overlay Generation

`preprocessing.py` creates:

- A binary mask image.
- A full-resolution overlay image.
- A smaller JPEG overlay thumbnail.

The overlay highlights detected pixels on the original scene. These files are stored in the job's output directory and served through the ML and backend file routes.

#### Stage 5: Geolocation

For SAFE archives, the segmentation mask is mapped to geographic coordinates using the product geocoding and ground-control information.

For ordinary images, the submitted latitude and longitude are used.

The service also attempts to ensure that the detection point is located in the ocean. If a detected point is on land, it searches for a nearby ocean point.

SAFE products may also produce geographic polygon patches representing the detected spill boundary.

#### Stage 6: Environmental Data

The service retrieves historical environmental conditions near the detected spill location.

It uses:

- Ocean currents.
- Wind speed and direction.
- Wave information when available.
- Open-Meteo marine and weather data.
- A local Copernicus in-situ CSV fallback when appropriate.

Current and wind availability are tracked separately, so a missing current record does not automatically discard usable wind data.

#### Stage 7: Backward Drift Hindcast

OpenDrift starts a particle at the detected spill location and moves it backward through time using current and wind data.

The system then selects an expected release origin using this priority:

1. A provided release age, if available.
2. A coastal-stranding point where the particle stops moving.
3. The furthest valid ocean point at the lookback horizon.

Land points are rejected or snapped to the nearest ocean position. The service returns:

- Estimated origin latitude and longitude.
- Estimated release time.
- Earliest and latest plausible release times.
- Origin-selection method.
- Drift distance.
- Simulation engine.
- A disclaimer that the origin is modelled, not surveyed.

It also generates:

- Full trajectory CSV.
- Trajectory map image.
- A reduced list of trajectory points for the frontend Leaflet map.

#### Stage 8: AIS Vessel Attribution

The system compares the estimated origin and release time with AIS vessel data from configured external providers.

It supports:

- Full real vessel tracks.
- Presence-only vessel observations.
- AIS quality checks.
- Vessel identity information.
- Vessel-type risk priors.
- Behavioral anomaly scoring.

For vessels with tracks, the scoring considers:

- Spatial proximity to the estimated origin.
- Temporal proximity to the release window.
- Whether the vessel track intersects the origin.
- Whether its movement is consistent with the drift model.
- Course direction.
- AIS data quality.
- Vessel type.

Candidates are ranked by a weighted score. The ranking represents relative attribution likelihood among evaluated candidates; it is not proof of causation or legal responsibility.

If enough track data exists, an Isolation Forest provides an additional behavioral anomaly signal. It cannot replace missing AIS evidence.

---

## 7. Generated Outputs

Each completed ML job can produce:

- JSON analysis result.
- Binary segmentation mask.
- Full-resolution detection overlay.
- Overlay thumbnail.
- Trajectory CSV.
- Trajectory map PNG.
- Spill geometry and polygon patches where geolocation is available.
- Drift trajectory points for frontend map rendering.
- Vessel candidate records and evidence explanations.

Files are stored under `ml_service/outputs/<job_id>/` and are served through the backend file proxy.

---

## 8. Development Commands

### Frontend

```bash
cd frontend
npm install
npm run dev
npm run build
npm run preview
```

### Backend

```bash
cd backend
npm install
npm run dev
npm start
```

### ML Service

```bash
cd ml_service
pip install -r requirements.txt
python server.py
```

---

## 9. Important Limitations

- ML jobs are stored in memory and do not survive ML-service restarts.
- The backend prediction store is primarily in memory unless Supabase is configured.
- AIS attribution depends on external APIs, tokens, and the quality of available transmissions.
- Sparse or missing AIS data reduces attribution confidence.
- Ocean-current and wind data may be unavailable for some dates or locations.
- The backward drift origin is an estimate, not a surveyed release location.
- Oil weathering, waves, local turbulence, and unmodelled ocean processes can affect the real spill path.
- The main frontend upload flow focuses on SAFE archives, although the backend and ML API support ordinary images with coordinates.
- The frontend contains batch and incident-management screens, but the inspected backend currently does not register all corresponding batch and incident endpoints.
- CORS is broadly enabled in the source and should be restricted to trusted origins in production.
- No automated test script is currently defined in the frontend or backend package files.

---

## 11. Short Presentation Summary

VarunaDrishti is a three-layer oil-spill investigation system. The React frontend allows users to upload scenes and inspect results. The Node backend manages uploads, job communication, alerts, persistence, and file access. The Python ML service performs image segmentation, geolocation, environmental-data retrieval, backward drift modelling, and AIS vessel attribution.

The system does not simply detect an oil spill. It also estimates where and when the spill may have started, compares that estimate with nearby vessel movements, ranks possible source vessels, and presents the evidence through an interactive maritime investigation interface.
