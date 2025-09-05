import io
import os
import importlib.util
import pandas as pd
import pytest

from fastapi.testclient import TestClient
from backend_app.api import app


client = TestClient(app)


def make_sample_xlsx_bytes():
    df = pd.DataFrame({
        "Enquiry": ["short", "please help, urgent", "okay text"],
        "Channel": ["Email", "Chat", "Chat"],
    })
    buf = io.BytesIO()
    df.to_excel(buf, index=False)
    buf.seek(0)
    return buf.getvalue()


celery_available = importlib.util.find_spec("celery") is not None and bool(os.getenv("CELERY_BROKER_URL"))


@pytest.mark.xfail(not celery_available, reason="Celery not configured in environment", strict=False)
def test_jobs_submit_via_celery_when_enabled(monkeypatch):
    # Force JOB_RUNNER=celery for this call
    monkeypatch.setenv("JOB_RUNNER", "celery")

    # Upload
    data = {"file": ("sample.xlsx", make_sample_xlsx_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r = client.post("/uploads", files=data)
    assert r.status_code == 200
    upload_id = r.json()["upload_id"]

    payload = {
        "upload_id": upload_id,
        "targets_config": {
            "Enquiry": {"wc": True, "wc_min": 3, "kw_flag": {"enabled": True, "mode": "ANY", "phrases": ["urgent", "help"]}}
        },
    }
    rj = client.post("/jobs", json=payload)
    # Expect success when Celery is configured; otherwise this test is marked xfail
    assert rj.status_code == 200
    assert "job_id" in rj.json()

