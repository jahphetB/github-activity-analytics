-- =========================
-- GitHub Activity Analytics
-- Database Schema
-- =========================

CREATE TABLE IF NOT EXISTS repos (
  id BIGINT PRIMARY KEY,
  full_name TEXT NOT NULL UNIQUE,
  owner_login TEXT NOT NULL,
  name TEXT NOT NULL,

  is_fork BOOLEAN NOT NULL DEFAULT FALSE,
  stars INT NOT NULL DEFAULT 0,
  forks INT NOT NULL DEFAULT 0,
  open_issues INT NOT NULL DEFAULT 0,

  default_branch TEXT,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ,
  pushed_at TIMESTAMPTZ,

  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  is_pinned BOOLEAN NOT NULL DEFAULT FALSE,

  last_ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS users (
  id BIGINT PRIMARY KEY,
  login TEXT NOT NULL UNIQUE,
  type TEXT,
  site_admin BOOLEAN,

  last_ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS commits (
  sha TEXT PRIMARY KEY,

  repo_id BIGINT NOT NULL REFERENCES repos(id) ON DELETE CASCADE,

  author_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,
  committer_user_id BIGINT REFERENCES users(id) ON DELETE SET NULL,

  author_name TEXT,
  author_email TEXT,
  committer_name TEXT,
  committer_email TEXT,

  message TEXT,
  committed_at TIMESTAMPTZ NOT NULL,
  url TEXT,

  ingested_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_commits_repo_committed_at
  ON commits (repo_id, committed_at DESC);

CREATE INDEX IF NOT EXISTS idx_commits_committed_at
  ON commits (committed_at DESC);

CREATE INDEX IF NOT EXISTS idx_commits_author_user_id
  ON commits (author_user_id);
