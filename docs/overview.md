# Project overview

## Purpose

VarunaDrishti analyses Sentinel-1 Synthetic Aperture Radar (SAR) SAFE archives for possible oil slicks and presents an investigation workspace rather than a standalone model prediction. It combines image segmentation, metadata-derived geolocation, environmental context, drift modelling, and vessel evidence.

## User workflow

1. Upload a Sentinel-1 `.SAFE.zip` archive.
2. Watch the asynchronous analysis job progress through nine stages.
3. Review the detection mask, overlay, location, environmental conditions, hindcast, forecast, and candidate vessels.
4. Use the history and batch views to compare completed investigations.

## Components

| Component | Technology | Responsibility |
|---|---|---|
| `frontend/` | React, Vite, Leaflet | Upload, job status, maps, reports, history, and batch UI. |
| `backend/` | Node.js, Express, Multer | Browser API, disk-backed upload forwarding, job/file proxying, alerts, and prediction records. |
| `ml_service/` | Python, Flask, PyTorch | SAFE extraction, segmentation, geolocation, environmental retrieval, drift, and attribution. |
| Supabase (optional) | PostgreSQL | Durable completed-prediction history and optional remote current observations. |

## Supported input

The application supports Sentinel-1 SAFE products packaged as `.SAFE.zip`. SAFE product metadata and measurement bands supply the acquisition time and geographic reference; no manual coordinates are accepted or required.

The service reads the VV/VH measurement TIFFs inside a SAFE archive. That internal processing is part of SAFE support and does not mean standalone GeoTIFF uploads are supported.

## Outputs

A successful job can produce:

- Classification, confidence, mask, visual overlay, and thumbnail.
- Spill centroid, polygon patches, and area information.
- Wind/current data-quality summary.
- Backward trajectory, probable origin, and release-time estimate.
- Forward trajectory forecast (24 hours by default).
- Ranked vessel candidates and evidence details when a vessel source is available.

Artifacts are written to `ml_service/outputs/<job-id>/` and are retrievable through the Express file endpoint.

## Scope and limitations

Jobs, batch progress, and active ML state are in memory. They do not survive service restarts. Missing data providers, unavailable current history, or sparse AIS tracks are exposed as warnings or unavailable results; the application does not fabricate evidence.

See [architecture](architecture.md) for how the pipeline produces these outputs.
