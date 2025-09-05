Local Development Quickstart

- Python (backend)
  - Use Python 3.12 for best compatibility.
  - Create venv: `py -3.12 -m venv .venv312`
  - Activate: `. .venv312\\Scripts\\Activate.ps1`
  - Install deps: `pip install -r requirements.txt -r requirements-dev.txt`
  - Run tests: `pytest -q`
  - Run API: `uvicorn backend_app.api:app --reload --port 8000`

- Node (frontend)
  - Ensure Node 18+ (`node -v`).
  - Install deps: `cd audit-ui && npm ci` (or `npm install`)
  - Dev server: `npm run dev` (default http://localhost:3000)
  - Configure backend URL via `NEXT_PUBLIC_API_BASE` (defaults to http://localhost:8000)
  - Copy env example: `cp audit-ui/.env.local.example audit-ui/.env.local` (edit if needed)

- Notes
  - The engine runs offline (no AI calls). AI rules are placeholders.
  - SQLAlchemy is optional; editor-only in dev. The API works without a database.
  - Job runner defaults to FastAPI background tasks. Celery is stubbed for future use.
  - Copy root env: `cp .env.example .env` to tweak backend config locally.

Optional: Celery Runner (advanced)

- Purpose: Offload job execution to a worker. Default remains background or inline.
- Requirements: A running broker (e.g., Redis or RabbitMQ) and a Celery worker.
- Env vars:
  - `JOB_RUNNER=celery`
  - `CELERY_BROKER_URL=redis://localhost:6379/0` (example)
  - `CELERY_RESULT_BACKEND=redis://localhost:6379/0` (optional)
- Start worker (in a separate terminal):
  - `celery -A backend_app.celery_app.app worker -l info`
- Start API normally. On `POST /jobs`, the API submits a Celery task and stores the task id.
- `GET /jobs/{id}` maps Celery states to API statuses (PENDING/RUNNING/SUCCEEDED/FAILED).

Encoding tip (UI text)

- Keep UI copy in ASCII to avoid mojibake. In VS Code, ensure files are saved as UTF-8.
