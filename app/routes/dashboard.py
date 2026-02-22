from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db import get_db

router = APIRouter(prefix="/api", tags=["dashboard"])


@router.get("/summary")
def dashboard_summary(db: Session = Depends(get_db)):
    """
    Dashboard KPI cards.
    Why this exists:
    - Frontend needs ONE endpoint to render the top "overview" section quickly.
    - Keeps the UI simple (UI should not run multiple queries and stitch results).
    """

    # Total repos tracked
    total_repos = db.execute(text("SELECT COUNT(*) FROM repos WHERE is_active = TRUE;")).scalar_one()

    # Total commits stored
    total_commits = db.execute(text("SELECT COUNT(*) FROM commits;")).scalar_one()

    # Commits in last 7 and 30 days
    commits_7d = db.execute(
        text("SELECT COUNT(*) FROM commits c JOIN repos r ON r.id = c.repo_id WHERE r.is_active = TRUE AND c.committed_at >= NOW() - INTERVAL '7 days';")
    ).scalar_one()

    commits_30d = db.execute(
        text("SELECT COUNT(*) FROM commits c JOIN repos r ON r.id = c.repo_id WHERE r.is_active = TRUE AND c.committed_at >= NOW() - INTERVAL '30 days';")
    ).scalar_one()

    # Latest ingestion timestamp (max across repos)
    last_ingested_at = db.execute(text("SELECT MAX(last_ingested_at) FROM repos WHERE is_active = TRUE;")).scalar_one()

    # Top repo by commits in last 30 days
    top_repo = db.execute(
        text("""
        SELECT r.full_name, COUNT(c.sha) AS commit_count
        FROM repos r
        JOIN commits c ON c.repo_id = r.id
        WHERE c.committed_at >= NOW() - INTERVAL '30 days'
        GROUP BY r.full_name
        ORDER BY commit_count DESC
        LIMIT 1;
        """)
    ).mappings().first()

    # Most active day in last 30 days (across all repos)
    most_active_day = db.execute(
        text("""
        SELECT DATE_TRUNC('day', c.committed_at)::date AS day,
            COUNT(*) AS commit_count
        FROM commits c
        JOIN repos r ON r.id = c.repo_id
        WHERE r.is_active = TRUE
        AND c.committed_at >= NOW() - (:days || ' days')::interval
        GROUP BY day
        ORDER BY commit_count DESC
        LIMIT 1;
        """),
        {"days": 30},
    ).mappings().first()

    return {
        "totals": {
            "repos": total_repos,
            "commits": total_commits,
            "commits_7d": commits_7d,
            "commits_30d": commits_30d,
        },
        "last_ingested_at": last_ingested_at,
        "top_repo_30d": dict(top_repo) if top_repo else None,
        "most_active_day_30d": dict(most_active_day) if most_active_day else None,
    }


@router.get("/timeseries")
def commits_timeseries(
    days: int = Query(30, ge=1, le=365),
    full_name: str | None = Query(
        None,
        description="Optional repo full_name like 'fastapi/fastapi'. If omitted, returns totals across all repos.",
    ),
    db: Session = Depends(get_db),
):
    """
    Timeseries for charts.
    Solves:
    - Frontend wants commits-per-day for a line chart.
    - Optionally, allow drilling into one repo using the same endpoint.
    """

    params: dict = {"days": days}

    if full_name:
        repo = db.execute(
            text("SELECT id, full_name FROM repos WHERE full_name = :full_name;"),
            {"full_name": full_name},
        ).mappings().first()

        if not repo:
            raise HTTPException(status_code=404, detail="Repo not found. Ingest it first.")

        params["repo_id"] = repo["id"]

        rows = db.execute(
            text("""
            SELECT DATE_TRUNC('day', c.committed_at)::date AS day,
                COUNT(*) AS commit_count
            FROM commits c
            JOIN repos r ON r.id = c.repo_id
            WHERE r.is_active = TRUE
                AND c.committed_at >= NOW() - (:days || ' days')::interval
            GROUP BY day
            ORDER BY day;
            """),
            params,
        ).mappings().all()

        return {"scope": {"repo": repo["full_name"]}, "days": days, "series": list(rows)}

    # All repos (global totals)
    rows = db.execute(
        text("""
        SELECT DATE_TRUNC('day', c.committed_at)::date AS day,
            COUNT(*) AS commit_count
        FROM commits c
        JOIN repos r ON r.id = c.repo_id
        WHERE r.is_active = TRUE
        AND c.committed_at >= NOW() - (:days || ' days')::interval
        GROUP BY day
        ORDER BY day;
        """),
        params,
    ).mappings().all()

    return {"scope": {"repo": None, "active_only": True}, "days": days, "series": list(rows)}


@router.get("/repos")
def repos_table(
    days: int = Query(30, ge=1, le=365),
    limit: int = Query(50, ge=1, le=200),
    search: str | None = Query(None, description="Case-insensitive search against repo full_name"),
    db: Session = Depends(get_db),
):
    """
    Repo table for the dashboard (Plan B).
    Solves:
    - Gives the frontend a list view with activity + metadata in one call.
    """

    # We compute commit_count for the given window (days), and join it to repos.
    # If the repo has no commits in that window, count defaults to 0.
    sql = """
    WITH activity AS (
      SELECT repo_id, COUNT(*) AS commit_count
      FROM commits
      WHERE committed_at >= NOW() - (:days || ' days')::interval
      GROUP BY repo_id
    )
    SELECT
      r.full_name,
      r.stars,
      r.forks,
      r.open_issues,
      r.pushed_at,
      r.last_ingested_at,
      r.is_active,
      r.is_pinned,
      COALESCE(a.commit_count, 0) AS commit_count
    FROM repos r
    LEFT JOIN activity a ON a.repo_id = r.id
    WHERE r.full_name ILIKE ('%' || COALESCE(:search, '') || '%')
    ORDER BY r.is_pinned DESC, r.is_active DESC, commit_count DESC, r.stars DESC
    LIMIT :limit;
    """

    rows = db.execute(
        text(sql),
        {"days": days, "limit": limit, "search": search},
    ).mappings().all()

    return {"days": days, "limit": limit, "search": search, "results": list(rows)}

@router.delete("/repos/{full_name:path}")
def untrack_repo(full_name: str, db: Session = Depends(get_db)):
    """
    Untrack a repo by deleting it from repos.
    Because the schema has: commits.repo_id REFERENCES repos(id) ON DELETE CASCADE
    deleting the repo automatically deletes its commits.
    """
    deleted = db.execute(
        text("""
        DELETE FROM repos
        WHERE full_name = :full_name
        RETURNING id, full_name;
        """),
        {"full_name": full_name},
    ).mappings().first()

    if not deleted:
        raise HTTPException(status_code=404, detail="Repo not found.")

    db.commit()
    return {"deleted": dict(deleted)}

@router.patch("/repos/{full_name:path}/active")
def set_repo_active(
    full_name: str,
    is_active: bool = Query(..., description="true to track, false to hide without deleting"),
    db: Session = Depends(get_db),
):
    row = db.execute(
        text("""
        UPDATE repos
        SET is_active = :is_active
        WHERE full_name = :full_name
        RETURNING full_name, is_active;
        """),
        {"full_name": full_name, "is_active": is_active},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Repo not found.")

    db.commit()
    return {"updated": dict(row)}


@router.patch("/repos/{full_name:path}/pin")
def set_repo_pinned(
    full_name: str,
    is_pinned: bool = Query(..., description="true to pin, false to unpin"),
    db: Session = Depends(get_db),
):
    row = db.execute(
        text("""
        UPDATE repos
        SET is_pinned = :is_pinned
        WHERE full_name = :full_name
        RETURNING full_name, is_pinned;
        """),
        {"full_name": full_name, "is_pinned": is_pinned},
    ).mappings().first()

    if not row:
        raise HTTPException(status_code=404, detail="Repo not found.")

    db.commit()
    return {"updated": dict(row)}
