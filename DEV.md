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

- Notes
  - The engine runs offline (no AI calls). AI rules are placeholders.
  - SQLAlchemy is optional; editor-only in dev. The API works without a database.
  - Job runner defaults to FastAPI background tasks. Celery is stubbed for future use.

