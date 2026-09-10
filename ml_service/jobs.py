"""
jobs.py - Minimal in-memory job manager.

Each uploaded file becomes one "job". The pipeline runs in a background
thread so the HTTP upload request returns immediately with a job_id; the
frontend then polls (or listens via SSE) for stage-by-stage progress and
finally the full result JSON.

This is intentionally simple (single-process, in-memory) so it is easy to
read and modify. If you need to survive process restarts or scale across
multiple workers, swap this for Redis/Celery/RQ later without touching
pipeline.py.
"""

from __future__ import annotations

import threading
import time
import traceback
import uuid
from pathlib import Path
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

from pipeline import STAGE_NAMES, run_pipeline, PipelineInputError


@dataclass
class Stage:
    name: str
    status: str = "pending"  # pending | running | success | warning | error | skipped
    message: str = ""
    data: Optional[Dict[str, Any]] = None
    updated_at: float = field(default_factory=time.time)


@dataclass
class Job:
    id: str
    input_path: str
    input_filename: str
    params: Dict[str, Any]
    status: str = "queued"  # queued | processing | complete | failed | cancelled
    stages: Dict[str, Stage] = field(default_factory=dict)
    stage_order: List[str] = field(default_factory=lambda: list(STAGE_NAMES))
    result: Optional[Dict[str, Any]] = None
    error: Optional[str] = None
    created_at: float = field(default_factory=time.time)
    updated_at: float = field(default_factory=time.time)

    def __post_init__(self):
        for name in self.stage_order:
            self.stages[name] = Stage(name=name)

    def to_dict(self) -> Dict[str, Any]:
        return {
            "job_id": self.id,
            "status": self.status,
            "input_filename": self.input_filename,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
            "stages": [
                {
                    "name": self.stages[name].name,
                    "status": self.stages[name].status,
                    "message": self.stages[name].message,
                    "data": self.stages[name].data,
                    "updated_at": self.stages[name].updated_at,
                }
                for name in self.stage_order
            ],
            "result": self.result,
            "error": self.error,
        }


class JobManager:
    def __init__(self, model, device, outputs_dir: str):
        self.model = model
        self.device = device
        self.outputs_dir = outputs_dir
        self._jobs: Dict[str, Job] = {}
        self._lock = threading.Lock()

    def create_job(self, input_path: str, input_filename: str, params: Dict[str, Any]) -> Job:
        job_id = uuid.uuid4().hex[:16]
        job = Job(id=job_id, input_path=input_path, input_filename=input_filename, params=params)
        with self._lock:
            self._jobs[job_id] = job
        return job

    def get_job(self, job_id: str) -> Optional[Job]:
        with self._lock:
            return self._jobs.get(job_id)

    def cancel(self, job_id: str) -> Optional[Job]:
        with self._lock:
            job = self._jobs.get(job_id)
            if job is None:
                return None
            if job.status in ("complete", "failed", "cancelled"):
                return job
            job.status = "cancelled"
            job.error = "Analysis cancelled by the user."
            job.updated_at = time.time()
            return job

    def start(self, job: Job) -> None:
        thread = threading.Thread(target=self._run, args=(job,), daemon=True)
        thread.start()

    def _on_stage(self, job: Job):
        def _callback(name: str, status: str, message: str, data: Optional[Dict[str, Any]] = None):
            with self._lock:
                stage = job.stages.get(name)
                if stage is None:
                    stage = Stage(name=name)
                    job.stages[name] = stage
                    job.stage_order.append(name)
                stage.status = status
                stage.message = message
                stage.data = data
                stage.updated_at = time.time()
                job.updated_at = time.time()
        return _callback

    def _run(self, job: Job) -> None:
        with self._lock:
            job.status = "processing"
            job.updated_at = time.time()
        try:
            result = run_pipeline(
                job_id=job.id,
                input_path=job.input_path,
                model=self.model,
                device=self.device,
                outputs_dir=self.outputs_dir,
                latitude=job.params.get("latitude"),
                longitude=job.params.get("longitude"),
                timestamp=job.params.get("timestamp"),
                lookback_days=job.params.get("lookback_days", 5.0),
                release_hours_ago=job.params.get("release_hours_ago"),
                skip_ais=job.params.get("skip_ais", False),
                on_stage=self._on_stage(job),
            )
            with self._lock:
                if job.status == "cancelled":
                    return
                job.result = result
                job.status = "complete"
                job.updated_at = time.time()
        except PipelineInputError as e:
            with self._lock:
                job.status = "failed"
                job.error = str(e)
                job.updated_at = time.time()
        except Exception as e:
            traceback.print_exc()
            with self._lock:
                job.status = "failed"
                job.error = f"{type(e).__name__}: {e}"
                job.updated_at = time.time()
        finally:
            try:
                Path(job.input_path).unlink(missing_ok=True)
            except OSError:
                traceback.print_exc()