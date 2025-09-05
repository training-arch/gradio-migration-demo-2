$ErrorActionPreference = 'Stop'

Write-Host 'Creating Python 3.12 venv...' -ForegroundColor Cyan
py -3.12 -m venv .venv312

Write-Host 'Activating venv and installing deps...' -ForegroundColor Cyan
. .\.venv312\Scripts\Activate.ps1
python -m pip install -U pip
pip install -r requirements.txt -r requirements-dev.txt

Write-Host 'Running tests...' -ForegroundColor Cyan
pytest -q

Write-Host 'Starting API on http://localhost:8000 ...' -ForegroundColor Green
uvicorn backend_app.api:app --reload --port 8000

