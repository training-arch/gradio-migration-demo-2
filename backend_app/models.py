"""
SQLAlchemy model stubs for future DB persistence.
These are not imported by the API yet to avoid adding a runtime dependency
until the database integration is enabled.
"""
from __future__ import annotations

import datetime as dt
import uuid

# Import guarded so that the file can exist without breaking imports when
# SQLAlchemy is not installed yet. Only import if used explicitly.
try:  # pragma: no cover - import-time optional
    from sqlalchemy.orm import declarative_base, Mapped, mapped_column
    from sqlalchemy import String, DateTime, Text, JSON, Integer, ForeignKey
except Exception:  # type: ignore
    declarative_base = None  # type: ignore
    Mapped = None  # type: ignore
    mapped_column = None  # type: ignore
    String = DateTime = Text = JSON = Integer = ForeignKey = None  # type: ignore


def uuid4_str() -> str:
    return str(uuid.uuid4())


if declarative_base is not None:  # pragma: no cover
    Base = declarative_base()

    class Upload(Base):
        __tablename__ = "uploads"
        id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4_str)
        filename: Mapped[str] = mapped_column(String(255), nullable=False)
        path: Mapped[str] = mapped_column(Text, nullable=False)
        created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow)

    class Job(Base):
        __tablename__ = "jobs"
        id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4_str)
        upload_id: Mapped[str] = mapped_column(String(36), ForeignKey("uploads.id"), nullable=False)
        status: Mapped[str] = mapped_column(String(20), default="PENDING")
        progress: Mapped[int] = mapped_column(Integer, default=0)
        error: Mapped[str | None] = mapped_column(Text, nullable=True)
        targets_config: Mapped[dict] = mapped_column(JSON, default={})
        result_path: Mapped[str | None] = mapped_column(Text, nullable=True)
        created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow)
        updated_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow, onupdate=dt.datetime.utcnow)

    class Result(Base):
        __tablename__ = "results"
        id: Mapped[str] = mapped_column(String(36), primary_key=True, default=uuid4_str)
        job_id: Mapped[str] = mapped_column(String(36), ForeignKey("jobs.id"), nullable=False)
        summary: Mapped[str | None] = mapped_column(Text, nullable=True)
        sample_json: Mapped[dict | None] = mapped_column(JSON, nullable=True)
        file_path: Mapped[str | None] = mapped_column(Text, nullable=True)
        created_at: Mapped[dt.datetime] = mapped_column(DateTime(timezone=True), default=dt.datetime.utcnow)

