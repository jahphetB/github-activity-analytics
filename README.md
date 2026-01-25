# GitHub Activity Analytics (FastAPI + PostgreSQL)

A backend service that ingests public GitHub repository data into PostgreSQL and exposes analytics endpoints for repo activity and contributors.

## Features
- Ingest any GitHub repo via API: `POST /ingest/repo`
- Stores structured data in Postgres (`repos`, `users`, `commits`)
- Analytics endpoints:
  - `GET /repos/top?days=30&limit=10`
  - `GET /repos/{full_name}/activity?days=30`
  - `GET /repos/{full_name}/contributors?days=30&limit=10`

## Tech Stack
- Python, FastAPI
- PostgreSQL
- SQLAlchemy (Core)
- GitHub REST API

## Setup (Windows)
1) Create and activate venv
```powershell
python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt

## Testing

Create a Postgres test database and set `TEST_DATABASE_URL` in `.env`, then run:

```powershell
pytest -q
