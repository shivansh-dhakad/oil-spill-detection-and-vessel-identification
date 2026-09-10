"""
app_hf.py — HuggingFace Spaces deployment entry point for VarunaDrishti ML Service.

How it works:
  HuggingFace Spaces looks for app.py in the repo root and starts it on port 7860.
  This file:
    1. Creates a FastAPI app that wraps the existing Flask `server.py` via WSGIMiddleware.
    2. Mounts a Gradio status UI at `/ui` (and redirects `/` to `/ui`) so the Space
       displays a web interface instead of a raw 404/JSON.
    3. Exposes all the existing Flask endpoints:
         GET  /health
         GET  /api/health
         POST /api/spill/analyze
         GET  /api/spill/jobs/<job_id>
         GET  /api/spill/jobs/<job_id>/files/<filename>
"""

import os
# HuggingFace Spaces always uses port 7860
os.environ.setdefault("PORT", "7860")

from fastapi import FastAPI
from fastapi.middleware.wsgi import WSGIMiddleware
from fastapi.responses import RedirectResponse, JSONResponse
import gradio as gr
import uvicorn

# Import the existing Flask app
from server import app as flask_app
import torch

fastapi_app = FastAPI(
    title="VarunaDrishti ML Service",
    description="Oil spill segmentation (UNet++) and vessel attribution API",
    version="1.0.0",
)

# ── Health check routes (FastAPI-native, respond before Flask fully loads) ────
@fastapi_app.get("/health", include_in_schema=False)
def hf_health():
    return JSONResponse(
        status_code=200,
        content={"status": "ok", "service": "oil-spill-ml", "hf_spaces": True},
    )

@fastapi_app.get("/api/health", include_in_schema=False)
def hf_api_health():
    return JSONResponse(
        status_code=200,
        content={
            "status": "ok",
            "service": "oil-spill-ml",
            "device": "cuda" if torch.cuda.is_available() else "cpu",
            "hf_spaces": True,
        },
    )

# ── Gradio Status Interface ──────────────────────────────────────────────────
def get_system_status():
    device = "CUDA (GPU)" if torch.cuda.is_available() else "CPU"
    gpu_name = torch.cuda.get_device_name(0) if torch.cuda.is_available() else "N/A"
    return f"""
    ### 🛰️ VarunaDrishti ML Service — Status

    | Component | Status |
    |---|---|
    | **Service** | Online |
    | **Compute Device** | `{device}` |
    | **GPU** | `{gpu_name}` |
    | **PyTorch** | `{torch.__version__}` |
    | **API Endpoints** | Mounted at `/api/spill/*` |

    ---
    **Endpoints:**
    - `GET  /health` — Liveness check
    - `POST /api/spill/analyze` — Run oil spill segmentation pipeline
    - `GET  /api/spill/jobs/<id>` — Poll job status
    - `GET  /api/spill/jobs/<id>/files/<file>` — Download output assets
    """

with gr.Blocks(title="VarunaDrishti ML Service") as gradio_ui:
    gr.Markdown("# 🌊 VarunaDrishti — AI Oil Spill Detection Engine")
    status_output = gr.Markdown(value=get_system_status())
    refresh_btn = gr.Button("🔄 Refresh Status")
    refresh_btn.click(fn=get_system_status, outputs=status_output)

# Mount Gradio at /ui
fastapi_app = gr.mount_gradio_app(fastapi_app, gradio_ui, path="/ui")

# Redirect bare root to the Gradio status UI
@fastapi_app.get("/", include_in_schema=False)
def root():
    return RedirectResponse(url="/ui")

# Mount Flask WSGI app on the root so all /api/* routes are handled by Flask
fastapi_app.mount("/", WSGIMiddleware(flask_app))

if __name__ == "__main__":
    port = int(os.environ.get("PORT", 7860))
    uvicorn.run(fastapi_app, host="0.0.0.0", port=port)
