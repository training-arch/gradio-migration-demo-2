"""
Optional DB wiring helpers. Not used by default.
Enable by providing a valid DATABASE_URL and importing these helpers in the API.
"""
from __future__ import annotations
import os

try:  # pragma: no cover
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
except Exception:  # type: ignore
    create_engine = None  # type: ignore
    sessionmaker = None  # type: ignore


def get_session_factory():
    url = os.getenv("DATABASE_URL")
    if not url or create_engine is None or sessionmaker is None:
        return None
    engine = create_engine(url, future=True)
    return sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)

