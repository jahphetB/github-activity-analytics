from fastapi import FastAPI, Depends, Query, HTTPException
from sqlalchemy import text
from sqlalchemy.orm import Session
import requests
import os

from app.db import get_db
from app.github_client import fetch_repo, fetch_commits
from app.github_store import upsert_repo, insert_commit
from app.routes.dashboard import router as dashboard_router
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(title="Universal Data Platform")

# CORS: allow the frontend (Next.js) to call the API from a different origin (localhost:3000)
cors_origins = os.getenv("CORS_ALLOW_ORIGINS", "http://localhost:3000")
allow_origins = [o.strip() for o in cors_origins.split(",") if o.strip()]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allow_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Register dashboard endpoints under /api/*
app.include_router(dashboard_router)

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    value = db.execute(text("SELECT 1")).scalar_one()
    return {"status": "ok", "db": value}


@app.get("/repos/top")
def top_repos(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    rows = db.execute(
        text("""
        SELECT r.full_name,
               COUNT(c.sha) AS commit_count
        FROM repos r
        JOIN commits c ON c.repo_id = r.id
        WHERE c.committed_at >= NOW() - (:days || ' days')::interval
        GROUP BY r.full_name
        ORDER BY commit_count DESC
        LIMIT :limit;
        """),
        {"days": days, "limit": limit},
    ).mappings().all()

    return {"days": days, "limit": limit, "results": list(rows)}


@app.get("/repos/{full_name:path}/activity")
def repo_activity(
    full_name: str,
    days: int = Query(30, ge=1, le=365),
    db: Session = Depends(get_db),
):
    repo = db.execute(
        text("SELECT id, full_name FROM repos WHERE full_name = :full_name"),
        {"full_name": full_name},
    ).mappings().first()

    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found. Ingest it first.")

    rows = db.execute(
        text("""
        SELECT DATE_TRUNC('day', c.committed_at)::date AS day,
               COUNT(*) AS commit_count
        FROM commits c
        WHERE c.repo_id = :repo_id
          AND c.committed_at >= NOW() - (:days || ' days')::interval
        GROUP BY day
        ORDER BY day;
        """),
        {"repo_id": repo["id"], "days": days},
    ).mappings().all()

    return {"repo": repo["full_name"], "days": days, "series": list(rows)}


@app.get("/repos/{full_name:path}/contributors")
def repo_contributors(
    full_name: str,
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(10, ge=1, le=50),
    db: Session = Depends(get_db),
):
    repo = db.execute(
        text("SELECT id, full_name FROM repos WHERE full_name = :full_name"),
        {"full_name": full_name},
    ).mappings().first()

    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found. Ingest it first.")

    rows = db.execute(
        text("""
        SELECT COALESCE(u.login, c.author_name, 'unknown') AS contributor,
               COUNT(*) AS commit_count
        FROM commits c
        LEFT JOIN users u ON u.id = c.author_user_id
        WHERE c.repo_id = :repo_id
          AND c.committed_at >= NOW() - (:days || ' days')::interval
        GROUP BY contributor
        ORDER BY commit_count DESC
        LIMIT :limit;
        """),
        {"repo_id": repo["id"], "days": days, "limit": limit},
    ).mappings().all()

    return {"repo": repo["full_name"], "days": days, "limit": limit, "results": list(rows)}


@app.post("/ingest/repo")
def ingest_repo(
    full_name: str,
    per_page: int = Query(30, ge=1, le=100),
    max_pages: int = Query(1, ge=1, le=10),
    db: Session = Depends(get_db),
):
    try:
        repo = fetch_repo(full_name)

        all_commits: list[dict] = []
        for page in range(1, max_pages + 1):
            batch = fetch_commits(full_name, per_page=per_page, page=page)
            if not batch:
                break
            all_commits.extend(batch)

    except requests.HTTPError as e:
        resp = e.response
        status = resp.status_code if resp else 502

        remaining = resp.headers.get("X-RateLimit-Remaining") if resp else None
        reset = resp.headers.get("X-RateLimit-Reset") if resp else None

        if resp is not None and status in (403, 429) and remaining == "0":
            raise HTTPException(
                status_code=429,
                detail={
                    "error": "GitHub rate limit exceeded",
                    "rate_limit_remaining": remaining,
                    "rate_limit_reset_epoch": reset,
                    "tip": "Set GITHUB_TOKEN in .env to increase rate limits.",
                },
            )

        raise HTTPException(
            status_code=status,
            detail={
                "error": "GitHub API request failed",
                "status_code": status,
                "body": resp.text if resp is not None else str(e),
            },
        )

    # Use the same DB transaction for the entire ingest
    conn = db.connection()
    upsert_repo(conn, repo)
    repo_id = repo["id"]

    for item in all_commits:
        insert_commit(conn, repo_id, item)

    db.commit()

    return {
        "repo": repo["full_name"],
        "repo_id": repo_id,
        "commits_fetched": len(all_commits),
        "per_page": per_page,
        "max_pages": max_pages,
    }


# --- Repo management actions for the dashboard UI (NEW) ---

@app.patch("/repos/{full_name:path}/pin")
def set_pin(full_name: str, value: bool = Query(True), db: Session = Depends(get_db)):
    row = db.execute(
        text("UPDATE repos SET is_pinned = :v WHERE full_name = :f RETURNING full_name, is_pinned;"),
        {"v": value, "f": full_name},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Repo not found")

    db.commit()
    return dict(row)


@app.patch("/repos/{full_name:path}/active")
def set_active(full_name: str, value: bool = Query(True), db: Session = Depends(get_db)):
    row = db.execute(
        text("UPDATE repos SET is_active = :v WHERE full_name = :f RETURNING full_name, is_active;"),
        {"v": value, "f": full_name},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Repo not found")

    db.commit()
    return dict(row)


@app.delete("/repos/{full_name:path}")
def delete_repo(full_name: str, db: Session = Depends(get_db)):
    repo = db.execute(
        text("SELECT id FROM repos WHERE full_name = :f"),
        {"f": full_name},
    ).mappings().first()

    if not repo:
        raise HTTPException(status_code=404, detail="Repo not found")

    # commits.repo_id has ON DELETE CASCADE in schema, so deleting repo deletes commits too.
    db.execute(text("DELETE FROM repos WHERE id = :id"), {"id": repo["id"]})
    db.commit()
    return {"deleted": full_name}