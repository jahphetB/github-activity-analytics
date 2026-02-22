"use client";

import React, { useEffect, useMemo, useState } from "react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

type SummaryResponse = {
  totals: {
    repos: number;
    commits: number;
    commits_7d: number;
    commits_30d: number;
  };
  last_ingested_at: string | null;
  top_repo_30d: { full_name: string; commit_count: number } | null;
  most_active_day_30d: { day: string; commit_count: number } | null;
};

type TimeseriesPoint = { day: string; commit_count: number };
type TimeseriesResponse = {
  days: number;
  series: TimeseriesPoint[];
};

type RepoRow = {
  full_name: string;
  stars: number | null;
  forks: number | null;
  open_issues: number | null;
  pushed_at: string | null;
  last_ingested_at: string | null;
  commit_count: number;
  is_active: boolean;
  is_pinned: boolean;
};

type ReposResponse = {
  days: number;
  limit: number;
  search: string | null;
  results: RepoRow[];
};

type IngestResponse = {
  repo: string;
  repo_id: number;
  commits_fetched: number;
  per_page: number;
  max_pages: number;
};

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

function fmtDate(x: string | null) {
  if (!x) return "—";
  const d = new Date(x);
  return Number.isNaN(d.getTime()) ? x : d.toLocaleString();
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    cache: "no-store", // prevent stale GETs (important for timeseries updates)
    ...init,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`${res.status} ${res.statusText}${text ? ` — ${text}` : ""}`);
  }
  return res.json() as Promise<T>;
}

export default function Page() {
  // UI state
  const [search, setSearch] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  // Data state
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [series, setSeries] = useState<TimeseriesPoint[]>([]);
  const [repos, setRepos] = useState<RepoRow[]>([]);

  // Loading + errors
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  // Ingestion form state
  const [fullNameInput, setFullNameInput] = useState("fastapi/fastapi");
  const [perPage, setPerPage] = useState(30);
  const [maxPages, setMaxPages] = useState(2);
  const [ingesting, setIngesting] = useState(false);
  const [ingestError, setIngestError] = useState<string | null>(null);
  const [ingestResult, setIngestResult] = useState<IngestResponse | null>(null);

  // Repo actions state
  const [busyRepo, setBusyRepo] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  const reposUrl = useMemo(() => {
    const qs = new URLSearchParams();
    qs.set("days", "30");
    qs.set("limit", "50");
    if (search.trim()) qs.set("search", search.trim());
    return `${API_BASE}/api/repos?${qs.toString()}`;
  }, [search]);

  async function reloadDashboard() {
    setLoading(true);
    setLoadError(null);

    try {
      // cache-buster for every reload so chart reflects pause/resume immediately
      const t = Date.now();

      const [sJson, tJson, rJson] = await Promise.all([
        fetchJson<SummaryResponse>(`${API_BASE}/api/summary?_t=${t}`),
        fetchJson<TimeseriesResponse>(`${API_BASE}/api/timeseries?days=30&_t=${t}`),
        fetchJson<ReposResponse>(`${reposUrl}&_t=${t}`),
      ]);

      setSummary(sJson);
      setSeries(tJson.series ?? []);
      setRepos(rJson.results ?? []);
    } catch (e: any) {
      setLoadError(e?.message ?? "Failed to load dashboard data");
    } finally {
      setLoading(false);
    }
  }

  // ✅ Hooks must be top-level (never inside functions)
  useEffect(() => {
    reloadDashboard();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reposUrl, refreshKey]);

  async function ingestRepo() {
    const value = fullNameInput.trim();

    // Basic input validation
    if (!value || !value.includes("/") || value.split("/").length !== 2) {
      setIngestError("Enter a repo in the format owner/repo (example: fastapi/fastapi).");
      return;
    }

    try {
      setIngesting(true);
      setIngestError(null);
      setIngestResult(null);

      const qs = new URLSearchParams();
      qs.set("full_name", value);
      qs.set("per_page", String(perPage));
      qs.set("max_pages", String(maxPages));

      const url = `${API_BASE}/ingest/repo?${qs.toString()}`;
      const result = await fetchJson<IngestResponse>(url, { method: "POST" });

      setIngestResult(result);
      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setIngestError(e?.message ?? "Ingestion failed");
    } finally {
      setIngesting(false);
    }
  }

  async function untrackRepo(fullName: string) {
    const ok = window.confirm(
      `Delete ${fullName}?\n\nThis will remove the repo and its commits from your database.`
    );
    if (!ok) return;

    try {
      setBusyRepo(fullName);
      setActionError(null);

      await fetchJson(`${API_BASE}/api/repos/${fullName}`, { method: "DELETE" });

      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setActionError(e?.message ?? "Failed to delete repo");
    } finally {
      setBusyRepo(null);
    }
  }

  async function toggleActive(fullName: string, next: boolean) {
    try {
      setBusyRepo(fullName);
      setActionError(null);

      const url = `${API_BASE}/api/repos/${fullName}/active?is_active=${next ? "true" : "false"}`;
      await fetchJson(url, { method: "PATCH" });

      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setActionError(e?.message ?? "Failed to update active state");
    } finally {
      setBusyRepo(null);
    }
  }

  async function togglePin(fullName: string, next: boolean) {
    try {
      setBusyRepo(fullName);
      setActionError(null);

      const url = `${API_BASE}/api/repos/${fullName}/pin?is_pinned=${next ? "true" : "false"}`;
      await fetchJson(url, { method: "PATCH" });

      setRefreshKey((k) => k + 1);
    } catch (e: any) {
      setActionError(e?.message ?? "Failed to update pin state");
    } finally {
      setBusyRepo(null);
    }
  }

  return (
    <main className="min-h-screen bg-slate-50">
      {/* Top bar */}
      <div className="border-b bg-white">
        <div className="max-w-6xl mx-auto px-6 py-5 flex flex-col gap-1">
          <h1 className="text-2xl md:text-3xl font-semibold tracking-tight">
            GitHub Activity Tracker
          </h1>
          <p className="text-sm text-slate-600">
            Track repositories you ingest, then explore activity trends and contributors.
          </p>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-6 py-8 space-y-6">
        {loadError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
            <div className="font-medium">Dashboard error</div>
            <div className="text-sm mt-1">{loadError}</div>
          </div>
        )}

        {actionError && (
          <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-red-800">
            <div className="font-medium">Action error</div>
            <div className="text-sm mt-1">{actionError}</div>
          </div>
        )}

        {/* Controls row */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Ingest card */}
          <div className="rounded-2xl border bg-white p-5 shadow-sm">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold">Ingest a repo</h2>
                <p className="text-sm text-slate-600 mt-1">
                  Add data to your database (commits + repo metadata).
                </p>
              </div>
              <button
                onClick={() => setRefreshKey((k) => k + 1)}
                className="text-sm rounded-xl border px-3 py-2 hover:bg-slate-50"
                title="Reload dashboard data"
              >
                Refresh
              </button>
            </div>

            <div className="mt-4 space-y-3">
              <div>
                <label className="text-xs font-medium text-slate-700">Repo (owner/repo)</label>
                <input
                  className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                  placeholder="fastapi/fastapi"
                  value={fullNameInput}
                  onChange={(e) => setFullNameInput(e.target.value)}
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="text-xs font-medium text-slate-700">Per page</label>
                  <input
                    type="number"
                    min={1}
                    max={100}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                    value={perPage}
                    onChange={(e) => setPerPage(Number(e.target.value))}
                  />
                </div>
                <div>
                  <label className="text-xs font-medium text-slate-700">Max pages</label>
                  <input
                    type="number"
                    min={1}
                    max={10}
                    className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                    value={maxPages}
                    onChange={(e) => setMaxPages(Number(e.target.value))}
                  />
                </div>
              </div>

              <button
                onClick={ingestRepo}
                disabled={ingesting}
                className="w-full rounded-xl bg-slate-900 text-white px-4 py-2.5 text-sm font-medium hover:bg-slate-800 disabled:opacity-60"
              >
                {ingesting ? "Ingesting..." : "Ingest repo"}
              </button>

              {ingestError && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  {ingestError}
                </div>
              )}

              {ingestResult && (
                <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">
                  <div className="font-medium">Ingest complete</div>
                  <div className="mt-1">
                    Repo: <span className="font-medium">{ingestResult.repo}</span>
                    <br />
                    Commits fetched:{" "}
                    <span className="font-medium">{ingestResult.commits_fetched}</span>
                    <br />
                    Pages: {ingestResult.max_pages} • Per page: {ingestResult.per_page}
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* KPI cards */}
          <div className="lg:col-span-2 grid grid-cols-1 md:grid-cols-4 gap-4">
            <KpiCard title="Repos (active)" value={summary?.totals.repos ?? (loading ? "…" : "—")} />
            <KpiCard title="Commits (all stored)" value={summary?.totals.commits ?? (loading ? "…" : "—")} />
            <KpiCard title="Commits (7d, active)" value={summary?.totals.commits_7d ?? (loading ? "…" : "—")} />
            <KpiCard title="Commits (30d, active)" value={summary?.totals.commits_30d ?? (loading ? "…" : "—")} />
          </div>
        </section>

        {/* Overview cards */}
        <section className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <InfoCard title="Last ingested (active repos)" value={fmtDate(summary?.last_ingested_at ?? null)} />
          <InfoCard
            title="Top repo (30d, active)"
            value={
              summary?.top_repo_30d
                ? `${summary.top_repo_30d.full_name} (${summary.top_repo_30d.commit_count})`
                : loading
                ? "…"
                : "—"
            }
          />
          <InfoCard
            title="Most active day (30d, active)"
            value={
              summary?.most_active_day_30d
                ? `${summary.most_active_day_30d.day} (${summary.most_active_day_30d.commit_count})`
                : loading
                ? "…"
                : "—"
            }
          />
        </section>

        {/* Chart */}
        <section className="rounded-2xl border bg-white p-5 md:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base md:text-lg font-semibold">
              Commits over last 30 days (active repos)
            </h2>
            <span className="text-xs md:text-sm text-slate-500">{series.length} days</span>
          </div>

          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart key={`${refreshKey}-${series.length}`} data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="commit_count" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {!loading && series.length === 0 && (
            <div className="text-sm text-slate-500 mt-3">
              No active tracked data in this window. Resume a repo or ingest more pages.
            </div>
          )}
        </section>

        {/* Repo table */}
        <section className="rounded-2xl border bg-white p-5 md:p-6 shadow-sm">
          <div className="flex flex-col md:flex-row md:items-end md:justify-between gap-3 mb-4">
            <div>
              <h2 className="text-base md:text-lg font-semibold">Tracked repos</h2>
              <p className="text-sm text-slate-600 mt-1">
                Table shows all repos (active + paused). Metrics/charts use active repos only.
              </p>
            </div>

            <div className="w-full md:w-80">
              <label className="text-xs font-medium text-slate-700">Search</label>
              <input
                className="mt-1 w-full rounded-xl border px-3 py-2 text-sm"
                placeholder="Type to filter (e.g., fastapi)"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>

          <div className="overflow-x-auto rounded-xl border">
            <table className="w-full text-sm">
              <thead className="text-left text-slate-600 bg-slate-50 border-b">
                <tr>
                  <th className="py-3 px-3">Repo</th>
                  <th className="py-3 px-3">Commits (30d)</th>
                  <th className="py-3 px-3">Stars</th>
                  <th className="py-3 px-3">Forks</th>
                  <th className="py-3 px-3">Open issues</th>
                  <th className="py-3 px-3">Pushed</th>
                  <th className="py-3 px-3">Ingested</th>
                  <th className="py-3 px-3">Action</th>
                </tr>
              </thead>

              <tbody>
                {repos.map((r, idx) => (
                  <tr
                    key={r.full_name}
                    className={`border-b last:border-b-0 ${
                      idx % 2 === 0 ? "bg-white" : "bg-slate-50/40"
                    } ${!r.is_active ? "opacity-60" : ""}`}
                  >
                    <td className="py-3 px-3 font-medium">
                      <div className="flex items-center gap-2">
                        <a className="underline underline-offset-2" href={`/repo/${r.full_name}`}>
                          {r.full_name}
                        </a>

                        {r.is_pinned && (
                          <span className="text-[10px] px-2 py-1 rounded-full border bg-slate-50 text-slate-700">
                            PINNED
                          </span>
                        )}

                        {!r.is_active && (
                          <span className="text-[10px] px-2 py-1 rounded-full border bg-amber-50 text-amber-800">
                            PAUSED
                          </span>
                        )}
                      </div>
                    </td>

                    <td className="py-3 px-3">{r.commit_count}</td>
                    <td className="py-3 px-3">{r.stars ?? "—"}</td>
                    <td className="py-3 px-3">{r.forks ?? "—"}</td>
                    <td className="py-3 px-3">{r.open_issues ?? "—"}</td>
                    <td className="py-3 px-3">{fmtDate(r.pushed_at)}</td>
                    <td className="py-3 px-3">{fmtDate(r.last_ingested_at)}</td>

                    <td className="py-3 px-3">
                      <div className="flex gap-2">
                        <button
                          onClick={() => togglePin(r.full_name, !r.is_pinned)}
                          disabled={busyRepo === r.full_name}
                          className="rounded-xl border px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-60"
                          title={r.is_pinned ? "Unpin repo" : "Pin repo"}
                        >
                          {r.is_pinned ? "Unpin" : "Pin"}
                        </button>

                        <button
                          onClick={() => toggleActive(r.full_name, !r.is_active)}
                          disabled={busyRepo === r.full_name}
                          className="rounded-xl border px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-60"
                          title={r.is_active ? "Hide from metrics (keep data)" : "Resume tracking"}
                        >
                          {r.is_active ? "Pause" : "Resume"}
                        </button>

                        <button
                          onClick={() => untrackRepo(r.full_name)}
                          disabled={busyRepo === r.full_name}
                          className="rounded-xl border px-3 py-2 text-xs hover:bg-slate-50 disabled:opacity-60"
                          title="Delete repo + commits from database"
                        >
                          {busyRepo === r.full_name ? "..." : "Delete"}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}

                {!loading && repos.length === 0 && (
                  <tr>
                    <td className="py-6 px-3 text-slate-500" colSpan={8}>
                      No repos tracked yet. Use “Ingest a repo” above to get started.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>

        <footer className="text-xs text-slate-500 pb-6">
          Tip: Ingest 2–5 repos you want to showcase, pin your best one, and use drilldowns to demo insights.
        </footer>
      </div>
    </main>
  );
}

function KpiCard({ title, value }: { title: string; value: any }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="text-xs font-medium text-slate-600">{title}</div>
      <div className="mt-2 text-2xl font-semibold text-slate-900">{value}</div>
    </div>
  );
}

function InfoCard({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="text-xs font-medium text-slate-600">{title}</div>
      <div className="mt-2 text-sm font-semibold text-slate-900">{value}</div>
    </div>
  );
}