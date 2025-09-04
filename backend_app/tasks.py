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
    # default
    if bg is None:
        return InlineRunner()
    return FastAPILocalRunner(bg)

