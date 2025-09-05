"""
Repository layer stubs for future DB usage.
These functions are designed to work with a SQLAlchemy Session when provided,
but the API currently uses in-memory state; wiring will be added later.
"""
from __future__ import annotations
from typing import Optional

# Optional SQLAlchemy imports
try:  # pragma: no cover
    from sqlalchemy.orm import Session
except Exception:  # type: ignore
    Session = None  # type: ignore


class UploadRepo:
    def __init__(self, session: "Session"):
        self.session = session

    # Placeholder methods
    def create(self, filename: str, path: str) -> str:  # returns upload_id
        raise NotImplementedError


class JobRepo:
    def __init__(self, session: "Session"):
        self.session = session

    def create(self, upload_id: str, targets_config: dict) -> str:  # returns job_id
        raise NotImplementedError

    def update_status(self, job_id: str, status: str, progress: int, error: Optional[str] = None) -> None:
        raise NotImplementedError

    def set_result_path(self, job_id: str, result_path: str) -> None:
        raise NotImplementedError

    def get_status(self, job_id: str) -> dict:
        raise NotImplementedError

