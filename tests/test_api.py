import os
from pathlib import Path

import pytest
from dotenv import load_dotenv
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

# Load .env so TEST_DATABASE_URL is available
load_dotenv()

from app.main import app  # noqa: E402
from app.db import get_db  # noqa: E402


@pytest.fixture(scope="session")
def test_db_url() -> str:
    url = os.getenv("TEST_DATABASE_URL")
    if not url:
        raise RuntimeError("TEST_DATABASE_URL is not set in .env")
    return url


@pytest.fixture(scope="session")
def engine(test_db_url: str):
    return create_engine(test_db_url, echo=False)


@pytest.fixture(scope="session")
def SessionLocal(engine):
    return sessionmaker(bind=engine, autoflush=False, autocommit=False)


@pytest.fixture(scope="session", autouse=True)
def init_schema(engine):
    """
    Recreate schema in udp_test_db before tests (safe: it's a dedicated test DB).
    """
    project_root = Path(__file__).resolve().parents[1]
    schema_path = project_root / "sql" / "schema.sql"
    schema_sql = schema_path.read_text(encoding="utf-8")

    with engine.begin() as conn:
        # Drop in dependency order to avoid FK issues
        conn.execute(text("DROP TABLE IF EXISTS commits CASCADE;"))
        conn.execute(text("DROP TABLE IF EXISTS users CASCADE;"))
        conn.execute(text("DROP TABLE IF EXISTS repos CASCADE;"))

        # Recreate tables/indexes
        # schema.sql contains CREATE TABLE IF NOT EXISTS; that's fine after drops
        conn.exec_driver_sql(schema_sql)


@pytest.fixture()
def db_session(SessionLocal):
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()


@pytest.fixture()
def client(SessionLocal):
    """
    Override the app's DB dependency so API calls use udp_test_db during tests.
    """
    def override_get_db():
        db = SessionLocal()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    with TestClient(app) as c:
        yield c
    app.dependency_overrides.clear()


def seed_basic_data(engine):
    """
    Insert deterministic rows for analytics tests.
    """
    with engine.begin() as conn:
        # repo
        conn.execute(
            text("""
            INSERT INTO repos (id, full_name, owner_login, name, is_fork, stars, forks, open_issues)
            VALUES (1, 'fastapi/fastapi', 'fastapi', 'fastapi', FALSE, 0, 0, 0)
            ON CONFLICT (id) DO NOTHING;
            """)
        )

        # users
        conn.execute(
            text("""
            INSERT INTO users (id, login, type, site_admin)
            VALUES (10, 'alice', 'User', FALSE),
                   (11, 'bob', 'User', FALSE)
            ON CONFLICT (id) DO NOTHING;
            """)
        )

        # commits: 2 on Jan 20, 1 on Jan 21
        conn.execute(
            text("""
            INSERT INTO commits (
              sha, repo_id, author_user_id, committer_user_id,
              author_name, author_email, committer_name, committer_email,
              message, committed_at, url
            )
            VALUES
              ('sha1', 1, 10, 10, 'alice', 'a@x.com', 'alice', 'a@x.com', 'c1', '2026-01-20T10:00:00Z', 'u1'),
              ('sha2', 1, 10, 10, 'alice', 'a@x.com', 'alice', 'a@x.com', 'c2', '2026-01-20T12:00:00Z', 'u2'),
              ('sha3', 1, 11, 11, 'bob',   'b@x.com', 'bob',   'b@x.com', 'c3', '2026-01-21T09:00:00Z', 'u3')
            ON CONFLICT (sha) DO NOTHING;
            """)
        )


def test_health_ok(client):
    r = client.get("/health")
    assert r.status_code == 200
    body = r.json()
    assert body["status"] == "ok"
    assert body["db"] == 1


def test_repos_top(client, engine):
    seed_basic_data(engine)

    r = client.get("/repos/top?days=365&limit=10")
    assert r.status_code == 200
    body = r.json()

    assert body["results"][0]["full_name"] == "fastapi/fastapi"
    assert body["results"][0]["commit_count"] == 3


def test_repo_activity_daily_counts(client, engine):
    seed_basic_data(engine)

    r = client.get("/repos/fastapi/fastapi/activity?days=365")
    assert r.status_code == 200
    body = r.json()

    # Expect 2 commits on 2026-01-20 and 1 commit on 2026-01-21
    series = body["series"]
    assert {"day": "2026-01-20", "commit_count": 2} in series
    assert {"day": "2026-01-21", "commit_count": 1} in series

def test_repo_contributors(client, engine):
    seed_basic_data(engine)

    r = client.get("/repos/fastapi/fastapi/contributors?days=365&limit=10")
    assert r.status_code == 200
    body = r.json()

    results = body["results"]

    # alice has 2 commits, bob has 1 commit (based on seed_basic_data)
    assert {"contributor": "alice", "commit_count": 2} in results
    assert {"contributor": "bob", "commit_count": 1} in results

