from __future__ import annotations
import os
import uuid
import json
import shutil
from pathlib import Path
from typing import Dict, Any, Optional
import pandas as pd

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .engine import run_targets
from .tasks import get_job_runner
from .storage import get_storage
from .db import get_session_factory

try:
    from .models import Upload as DBUpload, Job as DBJob  # type: ignore
except Exception:
    DBUpload = None  # type: ignore
    DBJob = None  # type: ignore

SessionFactory = get_session_factory()

# --- simple local storage dirs ---
BASE_DIR = Path(__file__).resolve().parent.parent
UPLOADS_DIR = BASE_DIR / "uploads"
RESULTS_DIR = BASE_DIR / "results"
UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
RESULTS_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI(title="Audit Engine API (Local)")

from fastapi.middleware.cors import CORSMiddleware

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://127.0.0.1:3000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)



# --- super tiny in-memory job registry ---
JOBS: Dict[str, Dict[str, Any]] = {}

class JobCreate(BaseModel):
    upload_id: str
    targets_config: Dict[str, dict]

@app.get("/healthz")
def healthz():
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

    # run job using configured runner (background or inline)
    runner = get_job_runner(bg)
    runner.submit(_run_job, job_id)
    return {"job_id": job_id}

@app.get("/jobs/{job_id}")
def get_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="job not found")
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
        job["status"] = "RUNNING"; job["progress"] = 5
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

        kept_df, out_path = run_targets(job["upload_path"], job["targets_config"], save_path=job["result_path"])
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
