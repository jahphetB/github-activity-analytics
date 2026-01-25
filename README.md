# GitHub Activity Analytics (FastAPI + PostgreSQL)

A backend service that ingests public GitHub repository data into PostgreSQL and exposes analytics endpoints for repo activity and contributors.

## Features
- Ingest any GitHub repo via API: `POST /ingest/repo`
- Stores structured data in Postgres (`repos`, `users`, `commits`)
- Analytics endpoints:
  - `GET /repos/top?days=30&limit=10`
  - `GET /repos/{full_name}/activity?days=30`
  - `GET /repos/{full_name}/contributors?days=30&limit=10`
## Metric Definitions

- **Commit activity**: number of commits grouped by UTC day (`DATE_TRUNC('day', committed_at)`).
- **Top repos**: repositories ranked by total commit count within the last `N` days.
- **Top contributors**: contributors ranked by commit count within the last `N` days (based on `users.login` when available, otherwise commit author name).

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




┌─────────────┐
│ GitHub API  │
│ (REST)      │
└──────┬──────┘
       │
       │  Fetch repos & commits
       ▼
┌───────────────────────┐
│ Ingestion Layer       │
│ FastAPI               │
│ POST /ingest/repo     │
└─────────┬─────────────┘
          │
          │  Idempotent inserts
          ▼
┌───────────────────────┐
│ PostgreSQL            │
│ repos                 │
│ users                 │
│ commits               │
└─────────┬─────────────┘
          │
          │  SQL analytics queries
          ▼
┌───────────────────────┐
│ Analytics API         │
│ GET /repos/top        │
│ GET /repos/{repo}/    │
│   activity            │
│ GET /contributors     │
└─────────┬─────────────┘
          │
          ▼
┌───────────────────────┐
│ Clients               │
│ Swagger / curl / apps │
└───────────────────────┘

