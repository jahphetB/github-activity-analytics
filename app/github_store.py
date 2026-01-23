from dateutil import parser as dateparser
from sqlalchemy import text

def upsert_repo(conn, repo: dict) -> None:
    conn.execute(
        text("""
        INSERT INTO repos (
          id, full_name, owner_login, name, is_fork, stars, forks, open_issues,
          default_branch, created_at, updated_at, pushed_at, last_ingested_at
        )
        VALUES (
          :id, :full_name, :owner_login, :name, :is_fork, :stars, :forks, :open_issues,
          :default_branch, :created_at, :updated_at, :pushed_at, NOW()
        )
        ON CONFLICT (id) DO UPDATE SET
          full_name = EXCLUDED.full_name,
          owner_login = EXCLUDED.owner_login,
          name = EXCLUDED.name,
          is_fork = EXCLUDED.is_fork,
          stars = EXCLUDED.stars,
          forks = EXCLUDED.forks,
          open_issues = EXCLUDED.open_issues,
          default_branch = EXCLUDED.default_branch,
          created_at = EXCLUDED.created_at,
          updated_at = EXCLUDED.updated_at,
          pushed_at = EXCLUDED.pushed_at,
          last_ingested_at = NOW();
        """),
        {
            "id": repo["id"],
            "full_name": repo["full_name"],
            "owner_login": repo["owner"]["login"],
            "name": repo["name"],
            "is_fork": repo["fork"],
            "stars": repo["stargazers_count"],
            "forks": repo["forks_count"],
            "open_issues": repo["open_issues_count"],
            "default_branch": repo.get("default_branch"),
            "created_at": dateparser.parse(repo["created_at"]) if repo.get("created_at") else None,
            "updated_at": dateparser.parse(repo["updated_at"]) if repo.get("updated_at") else None,
            "pushed_at": dateparser.parse(repo["pushed_at"]) if repo.get("pushed_at") else None,
        }
    )

def upsert_user(conn, user: dict | None) -> int | None:
    if not user:
        return None
    conn.execute(
        text("""
        INSERT INTO users (id, login, type, site_admin, last_ingested_at)
        VALUES (:id, :login, :type, :site_admin, NOW())
        ON CONFLICT (id) DO UPDATE SET
          login = EXCLUDED.login,
          type = EXCLUDED.type,
          site_admin = EXCLUDED.site_admin,
          last_ingested_at = NOW();
        """),
        {
            "id": user["id"],
            "login": user["login"],
            "type": user.get("type"),
            "site_admin": user.get("site_admin"),
        }
    )
    return user["id"]

def insert_commit(conn, repo_id: int, item: dict) -> None:
    sha = item["sha"]
    commit = item["commit"]

    author_user_id = upsert_user(conn, item.get("author"))
    committer_user_id = upsert_user(conn, item.get("committer"))

    author = commit.get("author") or {}
    committer = commit.get("committer") or {}

    committed_at_raw = committer.get("date")
    committed_at = dateparser.parse(committed_at_raw) if isinstance(committed_at_raw, str) else None

    conn.execute(
        text("""
        INSERT INTO commits (
          sha, repo_id, author_user_id, committer_user_id,
          author_name, author_email, committer_name, committer_email,
          message, committed_at, url, ingested_at
        )
        VALUES (
          :sha, :repo_id, :author_user_id, :committer_user_id,
          :author_name, :author_email, :committer_name, :committer_email,
          :message, :committed_at, :url, NOW()
        )
        ON CONFLICT (sha) DO NOTHING;
        """),
        {
            "sha": sha,
            "repo_id": repo_id,
            "author_user_id": author_user_id,
            "committer_user_id": committer_user_id,
            "author_name": author.get("name"),
            "author_email": author.get("email"),
            "committer_name": committer.get("name"),
            "committer_email": committer.get("email"),
            "message": commit.get("message"),
            "committed_at": committed_at,
            "url": item.get("html_url") or item.get("url"),
        }
    )
