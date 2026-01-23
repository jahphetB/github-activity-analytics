import os
import requests
from dotenv import load_dotenv

load_dotenv()

GITHUB_API = "https://api.github.com"
GITHUB_TOKEN = os.getenv("GITHUB_TOKEN")

def _headers() -> dict:
    h = {"Accept": "application/vnd.github+json"}
    if GITHUB_TOKEN:
        h["Authorization"] = f"Bearer {GITHUB_TOKEN}"
    return h

def _get(url: str, params: dict | None = None) -> requests.Response:
    r = requests.get(url, params=params, headers=_headers(), timeout=30)
    return r

def fetch_repo(full_name: str) -> dict:
    url = f"{GITHUB_API}/repos/{full_name}"
    r = _get(url)
    r.raise_for_status()
    return r.json()

def fetch_commits(full_name: str, per_page: int = 30, page: int = 1) -> list[dict]:
    url = f"{GITHUB_API}/repos/{full_name}/commits"
    r = _get(url, params={"per_page": per_page, "page": page})
    r.raise_for_status()
    return r.json()

