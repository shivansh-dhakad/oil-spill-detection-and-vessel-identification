# VarunaDrishti

VarunaDrishti is a local-first application for investigating possible oil spills in Sentinel-1 SAR SAFE archives. It segments potential slicks, geolocates the detection from product metadata, models backward and forward drift, and ranks vessels using available AIS evidence.

> Vessel attribution is investigative support, not proof of causation. Results depend on scene quality, environmental coverage, and AIS availability.

## Documentation

All project guides live in [docs/](docs/README.md).

| Guide | Use it for |
|---|---|
| [Project overview](docs/overview.md) | Features, scope, components, and data flow. |
| [Full project summary](docs/project-summary.md) | Complete workflow, component responsibilities, data lifecycle, and limitations. |
| [Architecture](docs/architecture.md) | Service boundaries, pipeline stages, and job lifecycle. |
| [Local setup](docs/local-setup.md) | Installing and starting the three local services. |
| [SAFE input guide](docs/safe-input.md) | Preparing a valid Sentinel-1 `.SAFE.zip` upload. |
| [Configuration](docs/configuration.md) | Environment variables, model selection, AIS, and Supabase. |
| [API reference](docs/api.md) | Browser-facing and internal HTTP endpoints. |
| [Troubleshooting](docs/troubleshooting.md) | Common setup, upload, model, and data-provider issues. |
| [Development guide](docs/development-guide.md) | Repository layout, verification commands, and maintenance workflow. |

## Quick start

Run these commands in separate PowerShell terminals:

```powershell
cd ml_service
Copy-Item .env.example .env
pip install -r requirements.txt
python server.py
```

```powershell
cd backend
Copy-Item .env.example .env
npm install
npm run dev
```

```powershell
cd frontend
Copy-Item .env.example .env
npm install
npm run dev
```

Open `http://localhost:5173` and upload a Sentinel-1 `.SAFE.zip` archive. See [local setup](docs/local-setup.md) before configuring external services or changing upload limits.
