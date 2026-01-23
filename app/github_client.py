import requests

GITHUB_API = "https://api.github.com"

def fetch_repo(full_name: str) -> dict:
    url = f"{GITHUB_API}/repos/{full_name}"
    r = requests.get(url, timeout=30)
    r.raise_for_status()
    return r.json()

def fetch_commits(full_name: str, per_page: int = 30) -> list[dict]:
    url = f"{GITHUB_API}/repos/{full_name}/commits"
    r = requests.get(url, params={"per_page": per_page}, timeout=30)
    r.raise_for_status()
    return r.json()
