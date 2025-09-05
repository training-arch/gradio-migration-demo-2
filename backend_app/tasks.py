from __future__ import annotations
import os
from typing import Callable, Any

from fastapi import BackgroundTasks


class JobRunner:
    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
        raise NotImplementedError


class FastAPILocalRunner(JobRunner):
    """Uses FastAPI BackgroundTasks to run a callable after response returns."""

    def __init__(self, bg: BackgroundTasks):
        self.bg = bg

    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
        self.bg.add_task(fn, *args, **kwargs)


class InlineRunner(JobRunner):
    """Executes the job inline (synchronously). Useful for debugging."""

    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:
        fn(*args, **kwargs)


def get_job_runner(bg: BackgroundTasks | None) -> JobRunner:
    mode = (os.getenv("JOB_RUNNER", "background").strip().lower())
    if mode == "inline":
        return InlineRunner()
    if mode == "celery":
        return CeleryRunner()
    # default to FastAPI background tasks
    if bg is None:
        return InlineRunner()
    return FastAPILocalRunner(bg)


class CeleryRunner(JobRunner):
    """
    Celery-ready adapter (stub) for future use.
    This implementation intentionally raises if used without proper wiring,
    so it doesn't silently fail when Celery isn't configured yet.
    Enable later by providing a Celery app and task route to submit jobs.
    """

    def __init__(self) -> None:
        # Lazy-resolve celery app; keep import optional
        self._err = (
            "JOB_RUNNER=celery set, but Celery is not configured. "
            "Set CELERY_BROKER_URL (and optional CELERY_RESULT_BACKEND) and ensure a worker is running."
        )

    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:  # pragma: no cover
        try:
            from .celery_app import app as celery_app  # type: ignore
        except Exception:
            celery_app = None  # type: ignore
        if not celery_app:
            raise RuntimeError(self._err)

        # Special-case: when API passes the background job (_run_job, job_id)
        job_id = None
        if getattr(fn, "__name__", None) == "_run_job" and args:
            job_id = args[0]
        if not job_id:
            # Fallback: execute inline if unexpected callable
            # (keeps behavior predictable during development)
            fn(*args, **kwargs)
            return

        # Import in-function to avoid import cycles at module load time
        try:
            from . import api as api_mod  # type: ignore
        except Exception as e:
            raise RuntimeError(f"CeleryRunner could not import API module to access JOBS: {e}")

        job = api_mod.JOBS.get(job_id)
        if not job:
            raise RuntimeError(f"Unknown job_id: {job_id}")

        upload_path = job.get("upload_path")
        targets_config = job.get("targets_config")
        result_path = job.get("result_path")
        if not (upload_path and targets_config is not None and result_path):
            raise RuntimeError("Job metadata incomplete; cannot submit to Celery")

        task = celery_app.send_task(  # type: ignore[union-attr]
            "run_job_task",
            args=[str(upload_path), targets_config, str(result_path)],
        )
        job["celery_task_id"] = task.id
        job["status"] = "PENDING"
        job["progress"] = 0
