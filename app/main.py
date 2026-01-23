from fastapi import FastAPI, Depends
from sqlalchemy import text
from sqlalchemy.orm import Session

import requests
from sqlalchemy import create_engine

from app.github_client import fetch_repo, fetch_commits
from app.github_store import upsert_repo, insert_commit

from app.db import get_db

app = FastAPI(title="Universal Data Platform")

@app.get("/health")
def health_check(db: Session = Depends(get_db)):
    value = db.execute(text("SELECT 1")).scalar_one()
    return {"status": "ok", "db": value}

from fastapi import Query, HTTPException
from sqlalchemy import text

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
    db: Session = Depends(get_db),
):
    try:
        repo = fetch_repo(full_name)
        commits = fetch_commits(full_name, per_page=per_page)
    except requests.HTTPError as e:
        # GitHub returns useful status codes; surface them cleanly
        status = e.response.status_code if e.response else 502
        detail = e.response.text if e.response else str(e)
        raise HTTPException(status_code=status, detail=detail)

    # Use the same DB transaction for the entire ingest
    conn = db.connection()
    upsert_repo(conn, repo)
    repo_id = repo["id"]

    for item in commits:
        insert_commit(conn, repo_id, item)

    db.commit()

    return {
        "repo": repo["full_name"],
        "repo_id": repo_id,
        "commits_fetched": len(commits),
    }

