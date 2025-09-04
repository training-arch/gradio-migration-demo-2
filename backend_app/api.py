from __future__ import annotations
import os
import uuid
import json
import shutil
from pathlib import Path
from typing import Dict, Any, Optional

from fastapi import FastAPI, UploadFile, File, HTTPException, BackgroundTasks, Form
from fastapi.responses import FileResponse
from pydantic import BaseModel

from .engine import run_targets

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

    # run in background for demo
    bg.add_task(_run_job, job_id)
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
    return FileResponse(path, media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", filename="mistakes_only.xlsx")

# --- background runner ---
def _run_job(job_id: str):
    job = JOBS.get(job_id)
    if not job:
        return
    try:
        job["status"] = "RUNNING"; job["progress"] = 5
        kept_df, out_path = run_targets(job["upload_path"], job["targets_config"], save_path=job["result_path"])
        job["progress"] = 95
        # write succeeded
        job["status"] = "SUCCEEDED"; job["progress"] = 100
    except Exception as e:
        job["status"] = "FAILED"
        job["error"] = str(e)
        job["progress"] = 100