"""
Celery app stub for future use.
Disabled by default; use JOB_RUNNER=celery only after configuring a broker.

Env vars:
  - CELERY_BROKER_URL
  - CELERY_RESULT_BACKEND (optional)

This module is safe to import even when Celery is not installed (guarded use).
"""
from __future__ import annotations
import os

try:  # pragma: no cover - optional import
    from celery import Celery
except Exception:  # type: ignore
    Celery = None  # type: ignore


def _create_app() -> "Celery | None":
    if Celery is None:
        return None
    broker = os.getenv("CELERY_BROKER_URL")
    backend = os.getenv("CELERY_RESULT_BACKEND")
    if not broker:
        return None
    app = Celery("audit_engine", broker=broker, backend=backend)
    return app


app = _create_app()

if app:
    @app.task(name="run_job_task")  # type: ignore[misc]
    def run_job_task(upload_path: str, targets_config: dict, save_path: str) -> str:
        from .engine import run_targets
        kept_df, out_path = run_targets(upload_path, targets_config, save_path=save_path)
        return out_path or ""

