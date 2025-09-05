from fastapi.testclient import TestClient
from backend_app.api import app


def test_config_endpoint_shape():
    client = TestClient(app)
    r = client.get("/config")
    assert r.status_code == 200
    body = r.json()
    # Basic shape checks (non-sensitive)
    for key in ("job_runner", "storage_backend", "cors_origins", "db_enabled", "celery_enabled"):
        assert key in body

