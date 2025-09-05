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
        # Defer import so environments without Celery aren't impacted.
        self._err = (
            "JOB_RUNNER=celery set, but Celery is not wired yet. "
            "Add a Celery app and task to submit jobs, then update CeleryRunner.submit()."
        )
        try:  # pragma: no cover
            import celery  # noqa: F401
        except Exception:
            # Keep as stub; submit() will raise with guidance
            pass

    def submit(self, fn: Callable[..., Any], *args: Any, **kwargs: Any) -> None:  # pragma: no cover
        raise RuntimeError(self._err)
