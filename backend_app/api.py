from __future__ import annotations
import os
import logging
import uuid
import json
import shutil
from pathlib import Path
from typing import Dict, Any, Optional
import pandas as pd

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel
from contextlib import asynccontextmanager

from .engine import run_targets
from .tasks import get_job_runner
from .storage import get_storage
from .db import get_session_factory
from . import configs as cfgmod
try:  # optional env loader for local dev
    from dotenv import load_dotenv  # type: ignore
    load_dotenv()
except Exception:
    pass

try:
    from .models import Upload as DBUpload, Job as DBJob  # type: ignore
except Exception:
    DBUpload = None  # type: ignore
    DBJob = None  # type: ignore

SessionFactory = get_session_factory()

# --- logging configuration (surface AI + engine logs) ---
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
try:
    logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO))
except Exception:
    logging.basicConfig(level=logging.INFO)
# Make sure our AI-related loggers surface at INFO by default
logging.getLogger("engine.ai").setLevel(logging.INFO)
logging.getLogger("ai_runner").setLevel(logging.INFO)

# --- simple local storage dirs ---
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOADS_DIR = BASE_DIR / "uploads"
RESULTS_DIR = BASE_DIR / "results"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Log startup configuration (moved from deprecated on_event)
    runner = os.getenv("JOB_RUNNER", "background").strip().lower()
    storage = os.getenv("STORAGE_BACKEND", "local").strip().lower()
    try:
        import logging
        logging.getLogger("uvicorn.error").info(
            "Startup config: JOB_RUNNER=%s STORAGE_BACKEND=%s CORS_ORIGINS=%s",
            runner,
            storage,
            ",".join(origins),
        )
    except Exception:
        print(f"Startup config: JOB_RUNNER={runner} STORAGE_BACKEND={storage} CORS_ORIGINS={origins}")
    yield

app = FastAPI(title="Audit Engine API (Local)", lifespan=lifespan)

from fastapi.middleware.cors import CORSMiddleware

cors_env = os.getenv("CORS_ORIGINS")
if cors_env:
    origins = [o.strip() for o in cors_env.split(",") if o.strip()]
else:
    origins = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ]

app.add_middleware(
    CORSMiddleware,
    allow_origins=origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


## startup log moved into lifespan above


@app.get("/config")
def get_runtime_config():
    """Return non-sensitive runtime configuration for debugging/UI hints."""
    runner = os.getenv("JOB_RUNNER", "background").strip().lower()
    storage = os.getenv("STORAGE_BACKEND", "local").strip().lower()
    # Celery availability (best-effort)
    celery_ok = False
    try:
        from .celery_app import app as celery_app  # type: ignore
        celery_ok = bool(celery_app)
    except Exception:
        celery_ok = False

    # AI observability (non-sensitive)
    def _env_bool(name: str, default: bool = False) -> bool:
        v = os.getenv(name)
        if v is None:
            return default
        return str(v).strip().lower() in ("1", "true", "yes", "on")

    ai_enabled = _env_bool("AI_ENABLED", False)
    openai_key_present = bool(os.getenv("OPENAI_API_KEY"))
    default_ai_model = os.getenv("AI_MODEL", "gpt-4o-mini")

    return {
        "job_runner": runner,
        "storage_backend": storage,
        "cors_origins": origins,
        "db_enabled": bool(SessionFactory),
        "celery_enabled": celery_ok,
        # AI status (no secrets)
        "ai_enabled": ai_enabled,
        "openai_key_present": openai_key_present,
        "default_ai_model": default_ai_model,
    }



# --- super tiny in-memory job registry ---
JOBS: Dict[str, Dict[str, Any]] = {}

class JobCreate(BaseModel):
    upload_id: str
    targets_config: Dict[str, dict]


class ConfigSave(BaseModel):
    name: str
    description: str | None = ""
    targets_config: Dict[str, dict]

@app.get("/healthz")
def healthz():
    return {"ok": True}


@app.get("/configs")
def list_configs():
    items = cfgmod.list_configs(BASE_DIR)
    return {
        "items": [
            {"name": c.name, "description": c.description, "updated_at": c.updated_at}
            for c in items
        ]
    }


@app.get("/configs/{name}")
def get_config(name: str):
    c = cfgmod.get_config(BASE_DIR, name)
    if not c:
        raise HTTPException(status_code=404, detail="config not found")
    return {"name": c.name, "description": c.description, "updated_at": c.updated_at, "targets_config": c.targets_config}


@app.post("/configs")
def create_or_update_config(body: ConfigSave):
    # basic validation on provided config shape
    if not isinstance(body.targets_config, dict):
        raise HTTPException(status_code=400, detail="targets_config must be an object")
    saved = cfgmod.save_config(BASE_DIR, body.name, body.description or "", body.targets_config)
    return {"ok": True, "name": saved.name, "updated_at": saved.updated_at}


@app.delete("/configs/{name}")
def delete_config(name: str):
    ok = cfgmod.delete_config(BASE_DIR, name)
    if not ok:
        raise HTTPException(status_code=404, detail="config not found")
    return {"ok": True}

@app.post("/uploads")
def upload_excel(file: UploadFile = File(...)):
    if not file.filename.lower().endswith(".xlsx"):
        raise HTTPException(status_code=400, detail="Please upload an .xlsx file")
    upload_id = str(uuid.uuid4())
    dst = UPLOADS_DIR / f"{upload_id}.xlsx"
    with dst.open("wb") as f:
        shutil.copyfileobj(file.file, f)
    # Optional DB mirror
    if SessionFactory and DBUpload is not None:
        try:
            with SessionFactory() as s:  # type: ignore[attr-defined]
                obj = DBUpload(id=upload_id, filename=file.filename, path=str(dst))  # type: ignore[misc]
                s.add(obj)
                s.commit()
        except Exception:
            # DB is optional; ignore failures
            pass
    return {"upload_id": upload_id, "filename": file.filename}

@app.post("/jobs")
def create_job(payload: JobCreate, bg: BackgroundTasks):
    upload_path = UPLOADS_DIR / f"{payload.upload_id}.xlsx"
    if not upload_path.exists():
        raise HTTPException(status_code=404, detail="upload_id not found")

    job_id = str(uuid.uuid4())
    out_path = RESULTS_DIR / f"{job_id}.xlsx"
    JOBS[job_id] = {
        "status": "PENDING",
        "progress": 0,
        "error": None,
        "result_path": str(out_path),
        "upload_path": str(upload_path),
        "targets_config": payload.targets_config,
    }

    # Optional DB mirror
    if SessionFactory and DBJob is not None:
        try:
            with SessionFactory() as s:  # type: ignore[attr-defined]
                job = DBJob(
                    id=job_id,
                    upload_id=payload.upload_id,
                    status="PENDING",
                    progress=0,
                    error=None,
                    targets_config=payload.targets_config,  # type: ignore[arg-type]
                    result_path=str(out_path),
                )
                s.add(job)
                s.commit()
        except Exception:
            pass

    # Use configured runner (background/inline/celery)
    runner = get_job_runner(bg)
    try:
        runner.submit(_run_job, job_id)
    except RuntimeError as e:
        # Provide consistent HTTP surface when Celery is selected but not configured
        raise HTTPException(status_code=503, detail=str(e))
    return {"job_id": job_id}

@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    # If Celery was used, reconcile status with Celery task state
    task_id = job.get("celery_task_id")
    if task_id:
        try:
            from .celery_app import app as celery_app  # type: ignore
            if celery_app:
                AsyncResult = celery_app.AsyncResult  # type: ignore[attr-defined]
                res = AsyncResult(task_id)
                state = str(res.state or "").upper()
                # Map Celery states to API status
                if state in ("PENDING", "RECEIVED"):
                    job["status"] = "PENDING"; job["progress"] = 0
                elif state in ("STARTED", "RETRY"):
                    job["status"] = "RUNNING"; job["progress"] = max(int(job.get("progress", 0)), 5)
                elif state == "SUCCESS":
                    job["status"] = "SUCCEEDED"; job["progress"] = 100
                elif state == "FAILURE":
                    job["status"] = "FAILED"; job["progress"] = 100
                    try:
                        job["error"] = str(res.info)  # type: ignore[attr-defined]
                    except Exception:
                        pass
        except Exception:
            # If Celery isn't importable or errors, fall back to last known values
            pass
    # only expose safe fields
    return {
        "status": job["status"],
        "progress": job["progress"],
        "error": job["error"],
    }

@app.get("/jobs/{job_id}/download")
def download_result(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
    if job["status"] != "SUCCEEDED":
        raise HTTPException(status_code=409, detail=f"job not ready (status={job['status']})")
    path = Path(job["result_path"]).resolve()
    if not path.exists():
        raise HTTPException(status_code=404, detail="result file missing")
    storage = get_storage()
    return storage.result_download_response(path, download_name="mistakes_only.xlsx")

@app.get("/uploads/{upload_id}/columns")
def get_upload_columns(upload_id: str):
    """Return column names from a previously uploaded Excel file."""
    upload_path = UPLOADS_DIR / f"{upload_id}.xlsx"
    if not upload_path.exists():
        raise HTTPException(status_code=404, detail="upload_id not found")
    try:
        df = pd.read_excel(upload_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"failed to read excel: {e}")
    cols = [str(c) for c in df.columns]
    return {"columns": cols}

@app.get("/uploads/{upload_id}/values")
def get_upload_values(upload_id: str, column: str, limit: int = 200):
    """Return unique non-empty values for a given column from the uploaded Excel."""
    upload_path = UPLOADS_DIR / f"{upload_id}.xlsx"
    if not upload_path.exists():
        raise HTTPException(status_code=404, detail="upload_id not found")
    try:
        df = pd.read_excel(upload_path)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"failed to read excel: {e}")
    if column not in df.columns:
        raise HTTPException(status_code=404, detail="column not found")
    vals = (
        df[column]
        .dropna()
        .astype(str)
        .map(lambda x: x.strip())
        .replace("", pd.NA)
        .dropna()
        .unique()
        .tolist()
    )
    vals = sorted(map(str, vals))[: max(1, int(limit))]
    return {"values": vals}

@app.get("/uploads/{upload_id}/preview")
def preview_upload(upload_id: str, targets_config: str, limit: int = 20):
    """
    Run a dry preview of the engine and return counts and a sample of kept rows.
    Query params:
      - targets_config: JSON string of the configuration (URL-encoded)
      - limit: max number of sample rows to return (default 20)
    """
    upload_path = UPLOADS_DIR / f"{upload_id}.xlsx"
    if not upload_path.exists():
      raise HTTPException(status_code=404, detail="upload_id not found")
    try:
        cfg = json.loads(targets_config or "{}")
        if not isinstance(cfg, dict):
            raise ValueError("targets_config must be a JSON object")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"invalid targets_config: {e}")

    try:
        # total rows from source
        import pandas as pd
        total_rows = int(pd.read_excel(upload_path).shape[0])
        kept_df, _ = run_targets(str(upload_path), cfg, save_path=None)
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

    rows_kept = int(kept_df.shape[0])
    # per-target counts
    per_target = {}
    for t in cfg.keys():
        col = f"{t} Mistakes"
        if col in kept_df.columns:
            per_target[t] = int((kept_df[col] != "[]").sum())
    # sample rows (incl. mistakes columns). Ensure JSON-safe (no NaN/Inf).
    sample_df = kept_df.head(max(0, int(limit))).copy()
    # Convert NaN to None so JSONResponse can serialize as null
    sample_df = sample_df.where(pd.notna(sample_df), None)
    sample = sample_df.to_dict(orient="records")

    return {
        "rows_total": total_rows,
        "rows_kept": rows_kept,
        "per_target_counts": per_target,
        "sample_rows": sample,
    }

# --- background runner ---
def _run_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return
    try:
        job["status"] = "RUNNING"; job["progress"] = 5; job["status_text"] = "queued"
        # DB mirror
        if SessionFactory and DBJob is not None:
            try:
                with SessionFactory() as s:  # type: ignore[attr-defined]
                    dbj = s.get(DBJob, job_id)
                    if dbj:
                        dbj.status = "RUNNING"
                        dbj.progress = 5
                        s.commit()
            except Exception:
                pass

        def _progress(stage: str, payload: dict):
            # Map stages to coarse-grained percentages
            try:
                if stage == "read":
                    job["progress"] = 10; job["status_text"] = "reading file"
                elif stage == "ai_total":
                    job["ai_total"] = int(payload.get("total") or 0)
                    job["ai_done"] = 0
                    job["progress"] = max(20, int(job.get("progress", 20)))
                    job["status_text"] = f"preparing AI ({job['ai_total']} prompts)"
                elif stage == "ai":
                    total = int(payload.get("total") or job.get("ai_total") or 0)
                    done = int(payload.get("done") or 0)
                    job["ai_total"] = total
                    job["ai_done"] = done
                    job["batch_size"] = int(payload.get("batch_size") or 0)
                    if total > 0:
                        frac = max(0.0, min(1.0, done / total))
                        job["progress"] = min(95, 20 + int(frac * 75))
                        job["status_text"] = f"AI {done}/{total} (batch {payload.get('batch_size', 0)})"
                elif stage == "write_start":
                    job["progress"] = max(95, int(job.get("progress", 90)))
                    job["status_text"] = "writing output"
                elif stage == "write_done":
                    job["progress"] = max(95, int(job.get("progress", 95)))
                # DB mirror (best-effort)
                if SessionFactory and DBJob is not None:
                    try:
                        with SessionFactory() as s:  # type: ignore[attr-defined]
                            dbj = s.get(DBJob, job_id)
                            if dbj:
                                dbj.progress = int(job.get("progress", 0))
                                s.commit()
                    except Exception:
                        pass
            except Exception:
                pass

        kept_df, out_path = run_targets(job["upload_path"], job["targets_config"], save_path=job["result_path"], progress_cb=_progress)
        job["progress"] = 95

        # write succeeded
        job["status"] = "SUCCEEDED"; job["progress"] = 100
        # DB mirror
        if SessionFactory and DBJob is not None:
            try:
                with SessionFactory() as s:  # type: ignore[attr-defined]
                    dbj = s.get(DBJob, job_id)
                    if dbj:
                        dbj.status = "SUCCEEDED"
                        dbj.progress = 100
                        dbj.result_path = job.get("result_path")
                        s.commit()
            except Exception:
                pass
    except Exception as e:
        job["status"] = "FAILED"
        job["error"] = str(e)
        job["progress"] = 100
        if SessionFactory and DBJob is not None:
            try:
                with SessionFactory() as s:  # type: ignore[attr-defined]
                    dbj = s.get(DBJob, job_id)
                    if dbj:
                        dbj.status = "FAILED"
                        dbj.progress = 100
                        dbj.error = str(e)
                        s.commit()
            except Exception:
                pass
