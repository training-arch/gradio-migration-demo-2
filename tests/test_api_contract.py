import io
import os
import time
import pandas as pd
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


def test_healthz():
    r = client.get("/healthz")
    assert r.status_code == 200
    assert r.json().get("ok") is True


def test_upload_job_lifecycle():
    # Upload
    data = {"file": ("sample.xlsx", make_sample_xlsx_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r = client.post("/uploads", files=data)
    assert r.status_code == 200
    up = r.json()
    upload_id = up["upload_id"]

    # Discover columns
    rc = client.get(f"/uploads/{upload_id}/columns")
    assert rc.status_code == 200
    cols = rc.json()["columns"]
    assert "Enquiry" in cols

    # Create job
    payload = {
        "upload_id": upload_id,
        "targets_config": {
            "Enquiry": {"wc": True, "wc_min": 3, "kw_flag": {"enabled": True, "mode": "ANY", "phrases": ["urgent", "help"]}}
        },
    }
    rj = client.post("/jobs", json=payload)
    assert rj.status_code == 200
    job_id = rj.json()["job_id"]

    # Poll a few times (background job runner by default)
    for _ in range(10):
        gs = client.get(f"/jobs/{job_id}")
        assert gs.status_code == 200
        status = gs.json()
        if status["status"] in ("SUCCEEDED", "FAILED"):
            break
        time.sleep(0.1)

    assert status["status"] in ("SUCCEEDED", "FAILED")
    if status["status"] == "SUCCEEDED":
        # Download
        dl = client.get(f"/jobs/{job_id}/download")
        assert dl.status_code == 200
        assert dl.headers.get("content-type", "").startswith("application/vnd.openxmlformats-officedocument")


def test_preview_endpoint():
    # Upload
    data = {"file": ("sample.xlsx", make_sample_xlsx_bytes(), "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")}
    r = client.post("/uploads", files=data)
    assert r.status_code == 200
    upload_id = r.json()["upload_id"]

    cfg = {
        "Enquiry": {"wc": True, "wc_min": 3, "kw_flag": {"enabled": True, "mode": "ANY", "phrases": ["urgent", "help"]}}
    }
    params = {"targets_config": __import__("json").dumps(cfg), "limit": 5}
    rp = client.get(f"/uploads/{upload_id}/preview", params=params)
    assert rp.status_code == 200
    body = rp.json()
    assert "rows_total" in body and "rows_kept" in body
    assert isinstance(body["sample_rows"], list)
    assert body["per_target_counts"].get("Enquiry") is not None
