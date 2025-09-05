# Contracts

This document describes the stable payloads and configuration shapes used by the engine, API, and UI.

## targets_config

Per-target configuration keyed by the target column name in the uploaded Excel.

Example

```
{
  "Enquiry": {
    "ai": false,
    "prompt": "",
    "wc": true,
    "wc_min": 3,
    "kw_flag": { "enabled": true, "mode": "ANY", "phrases": ["urgent", "help"] },
    "vf_on": false,
    "filters": {},
    "filter_mode": "AND",
    "tf_on": false,
    "text_filters": {}
  }
}
```

Schema (per target)

- ai: boolean. Enables the AI prompt rule when true.
- prompt: string. Template for AI rule. Supports `{Field_Name}`, `{Field_Value}`, and `{<Normalized_Column_Name>}` tokens.
- wc: boolean. Enables word count rule on the target column.
- wc_min: integer [1..20]. Minimum words required when `wc` is true.
- kw_flag: object. Keyword flag rule on the target column only.
  - enabled: boolean.
  - mode: "ANY" | "ALL". Matching mode across phrases.
  - phrases: string[]. Exact substring matches (case-insensitive).
- vf_on: boolean. Enables value filters on arbitrary columns.
- filters: object `{ columnName: string[] }`. Allowed values per column. Within a column, values are OR'ed; across columns, combined by `filter_mode`.
- filter_mode: "AND" | "OR". Combination across columns for value/text filters.
- tf_on: boolean. Enables text filters on arbitrary columns.
- text_filters: object `{ columnName: { mode: "ANY"|"ALL", phrases: string[], include: boolean } }`.

Notes

- Unknown fields are ignored by the engine.
- Missing fields default as in `backend_app/engine.ensure_target_defaults`.

## Engine outputs

- For each configured target column `T`, the engine adds a column `"T Mistakes"` with either `"[]"` (no issues) or a semicolon-joined string of messages.
- Message strings (non-AI):
  - `"NULL VALUE"` when word-count is enabled and the target cell is empty/whitespace.
  - `"Too short (<N words)"` when word-count is enabled and the target cell has fewer than `wc_min` words.
  - `"Keyword flag: <phrases>"` when keyword rule matches based on configuration (phrases joined by ", ").

The returned DataFrame contains only rows where at least one `"<Target> Mistakes"` column is not `"[]"`.

## API payloads

Uploads

- `POST /uploads` (multipart): field `file` (xlsx). Response:
  - `{ "upload_id": string, "filename": string }`

Jobs

- `POST /jobs` (json): `{ "upload_id": string, "targets_config": { ... } }`. Response:
  - `{ "job_id": string }`
- `GET /jobs/{id}`: Response:
  - `{ "status": "PENDING"|"RUNNING"|"SUCCEEDED"|"FAILED", "progress": number, "error": string|null }`
- `GET /jobs/{id}/download`: Success returns the result file (`.xlsx`).

Preview

- `GET /uploads/{upload_id}/preview` (query params):
  - `targets_config`: JSON string (URL-encoded) matching the `targets_config` schema.
  - `limit` (optional): max sample rows to include (default 20).
  - Response:
    - `rows_total`: total row count in the uploaded Excel.
    - `rows_kept`: number of rows flagged by any target.
    - `per_target_counts`: object mapping each target to its kept-row count.
    - `sample_rows`: array of up to `limit` record dicts (includes the “Mistakes” columns for configured targets).

## Status/progress rules

- `PENDING` on creation, `RUNNING` while processing, `SUCCEEDED` on success, `FAILED` on exceptions.
- `progress` is an integer 0..100. Implementations may update it per N rows.

## Error semantics (engine)

- Selecting a target column not present in the Excel raises: `"Selected target column not found in Excel: <col>"`.
- Invalid `wc_min` when `wc` is true raises: `"'<col>' word-count minimum must be between 1 and 20."`

## Internal Interfaces (for infra swaps)

Queue (job runner)

- Module: `backend_app/tasks.py`
- `JobRunner.submit(fn, *args, **kwargs)`: schedules execution of a callable.
- Implementations:
  - `FastAPILocalRunner`: uses FastAPI `BackgroundTasks` (default).
  - `InlineRunner`: executes synchronously (debug/testing).
- `CeleryRunner` (stub): placeholder adapter for Celery; currently raises until a Celery app/task is wired.
- Env: `JOB_RUNNER=background|inline` (default: `background`).
  - Future: `JOB_RUNNER=celery` once Celery is configured.

Storage (result download)

- Module: `backend_app/storage.py`
- `Storage.result_download_response(path: Path, download_name: str) -> Response`: returns a framework response for downloads.
- Implementations:
  - `LocalStorage`: serves a local file via `FileResponse` (default).
  - Future `S3Storage`: will return pre-signed URLs (to be added).
- Env: `STORAGE_BACKEND=local` (default).

Database (persistence; not active yet)

- Modules: `backend_app/models.py`, `backend_app/repo.py`, `backend_app/db.py`.
- SQLAlchemy models `Upload`, `Job`, `Result` are provided but not imported by the API yet.
- `backend_app/db.get_session_factory()` returns a session factory when `DATABASE_URL` is set; otherwise `None`.
- The API currently uses an in-memory registry as the source of truth; when `DATABASE_URL` is set and SQLAlchemy is available, uploads/jobs are mirrored to DB (best-effort). Public endpoints and shapes remain unchanged.
- Env: `DATABASE_URL=postgresql+psycopg://user:pass@host:port/dbname` (example). If not set or SQLAlchemy is missing, DB is skipped.
