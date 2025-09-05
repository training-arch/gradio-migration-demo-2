import io
import os
from pathlib import Path

import pandas as pd
import pytest


@pytest.mark.skipif(__import__('importlib').util.find_spec('sqlalchemy') is None, reason='SQLAlchemy not installed')
def test_db_mirror_smoke(tmp_path, monkeypatch):
    # Build a persistent sqlite DB file
    db_path = tmp_path / 'app.db'
    url = f"sqlite:///{db_path.as_posix()}"

    # Import SQLAlchemy bits and our models
    from sqlalchemy import create_engine
    from sqlalchemy.orm import sessionmaker
    from backend_app import models as m

    # Create tables
    engine = create_engine(url, future=True)
    assert getattr(m, 'Base', None) is not None, 'Models Base not defined'
    m.Base.metadata.create_all(engine)

    # Prepare a session factory and monkeypatch the API to use it
    sf = sessionmaker(bind=engine, autoflush=False, autocommit=False, future=True)
    import importlib
    api_mod = importlib.import_module('backend_app.api')
    monkeypatch.setattr(api_mod, 'SessionFactory', sf, raising=False)

    from fastapi.testclient import TestClient
    client = TestClient(api_mod.app)

    # Upload a small workbook
    df = pd.DataFrame({
        'Enquiry': ['short', 'please help, urgent', 'okay text'],
        'Channel': ['Email', 'Chat', 'Chat'],
    })
    buf = io.BytesIO(); df.to_excel(buf, index=False); buf.seek(0)
    r = client.post('/uploads', files={
        'file': ('sample.xlsx', buf.getvalue(), 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    })
    assert r.status_code == 200
    upload_id = r.json()['upload_id']

    # Create a job
    payload = {
        'upload_id': upload_id,
        'targets_config': {
            'Enquiry': { 'wc': True, 'wc_min': 3, 'kw_flag': { 'enabled': True, 'mode': 'ANY', 'phrases': ['urgent','help']}}
        }
    }
    rj = client.post('/jobs', json=payload)
    assert rj.status_code == 200
    job_id = rj.json()['job_id']

    # Verify DB records exist
    with sf() as s:  # type: ignore
        up = s.get(m.Upload, upload_id)
        jb = s.get(m.Job, job_id)
        assert up is not None
        assert jb is not None

