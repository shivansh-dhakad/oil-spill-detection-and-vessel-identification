# Local setup

## Requirements

- Node.js 18 or later.
- Python 3.10 or later.
- Sufficient disk space for large SAFE archives and generated artifacts.
- A compatible model checkpoint at `ml_service/models/best_model.safetensors`, or an `OIL_SPILL_MODEL_PATH` value.

The ML dependencies include scientific and geospatial packages. Their initial installation can take longer than the Node dependencies.

## 1. Start the ML service

```powershell
cd ml_service
Copy-Item .env.example .env
pip install -r requirements.txt
python server.py
```

It listens on `http://localhost:5001` by default. Check `http://localhost:5001/api/health`: `status: "ok"` means the model loaded; `degraded` means the server is running without a usable model.

## 2. Start the backend

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run dev
```

It listens on `http://localhost:4000` and uses `ML_SERVICE_URL=http://localhost:5001` unless configured otherwise. Its health endpoint is `http://localhost:4000/api/health`.

## 3. Start the frontend

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173`. For local development, leave `VITE_API_BASE_URL` empty; Vite proxies `/api` to port 4000.

## Verify the stack

1. Confirm the ML health response has a loaded model.
2. Confirm the backend health response includes a reachable ML service.
3. Open the frontend and submit a small valid SAFE archive.
4. Confirm live stage updates arrive, then inspect the completed result.

For an error at any point, see [troubleshooting](troubleshooting.md).
