"use client";

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const API_BASE = process.env.NEXT_PUBLIC_API_BASE ?? "http://127.0.0.1:8000";

type Summary = {
  totals: { repos: number; commits: number; commits_7d: number; commits_30d: number };
  last_ingested_at: string | null;
  top_repo_30d: { full_name: string; commit_count: number } | null;
  most_active_day_30d: { day: string; commit_count: number } | null;
};

type SeriesPoint = { day: string; commit_count: number };

type RepoRow = {
  full_name: string;
  stars: number | null;
  forks: number | null;
  open_issues: number | null;
  pushed_at: string | null;
  last_ingested_at: string | null;
  is_active: boolean;
  is_pinned: boolean;
  commit_count: number;
};

function fmt(d: string | null) {
  return d ? new Date(d).toLocaleString() : "—";
}

function encodeFullName(fullName: string) {
  // IMPORTANT: keep slashes encoded so /api/repos/{full_name:path} works reliably
  return encodeURIComponent(fullName);
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [series, setSeries] = useState<SeriesPoint[]>([]);
  const [repos, setRepos] = useState<RepoRow[]>([]);

  const [loading, setLoading] = useState(false);
  const [ingesting, setIngesting] = useState(false);

  const [repoInput, setRepoInput] = useState("fastapi/fastapi");
  const [perPage, setPerPage] = useState<number>(30);
  const [maxPages, setMaxPages] = useState<number>(1);

  const [search, setSearch] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const hasData = useMemo(() => (summary?.totals.repos ?? 0) > 0, [summary]);

  async function loadAll(opts?: { search?: string }) {
    try {
      setErr(null);
      setLoading(true);

      const qs = new URLSearchParams();
      qs.set("days", "30");
      qs.set("limit", "50");
      const s = (opts?.search ?? search).trim();
      if (s) qs.set("search", s);

      const [sRes, tRes, rRes] = await Promise.all([
        fetch(`${API_BASE}/api/summary`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/timeseries?days=30`, { cache: "no-store" }),
        fetch(`${API_BASE}/api/repos?${qs.toString()}`, { cache: "no-store" }),
      ]);

      if (!sRes.ok) throw new Error(`summary failed: ${sRes.status}`);
      if (!tRes.ok) throw new Error(`timeseries failed: ${tRes.status}`);
      if (!rRes.ok) throw new Error(`repos failed: ${rRes.status}`);

      const sJson: Summary = await sRes.json();
      const tJson: { series: SeriesPoint[] } = await tRes.json();
      const rJson: { results: RepoRow[] } = await rRes.json();

      setSummary(sJson);
      setSeries(tJson.series ?? []);
      setRepos(rJson.results ?? []);
    } catch (e: any) {
      setErr(e?.message ?? "Failed to fetch");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ingestRepo() {
    const full = repoInput.trim();
    if (!full || !full.includes("/")) {
      setErr("Enter repo as owner/repo");
      return;
    }

    setErr(null);
    setMsg(null);
    setIngesting(true);

    try {
      const url =
        `${API_BASE}/ingest/repo?full_name=${encodeURIComponent(full)}` +
        `&per_page=${encodeURIComponent(String(perPage))}` +
        `&max_pages=${encodeURIComponent(String(maxPages))}`;

      const res = await fetch(url, { method: "POST" });

      if (!res.ok) {
        const text = await res.text();
        throw new Error(`ingest failed: ${res.status} ${text}`);
      }

      const data = await res.json();
      setMsg(`Ingested ${data.repo} • commits_fetched=${data.commits_fetched}`);

      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Ingest failed");
    } finally {
      setIngesting(false);
    }
  }

  async function togglePin(full_name: string, next: boolean) {
    setErr(null);
    setMsg(null);
    try {
      const encoded = encodeFullName(full_name);
      const res = await fetch(
        `${API_BASE}/api/repos/${encoded}/pin?is_pinned=${next ? "true" : "false"}`,
        { method: "PATCH" }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`pin failed: ${res.status} ${text}`);
      }
      setMsg(`Pinned updated: ${full_name} → ${next}`);
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Pin failed");
    }
  }

  async function toggleActive(full_name: string, next: boolean) {
    setErr(null);
    setMsg(null);
    try {
      const encoded = encodeFullName(full_name);
      const res = await fetch(
        `${API_BASE}/api/repos/${encoded}/active?is_active=${next ? "true" : "false"}`,
        { method: "PATCH" }
      );
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`active failed: ${res.status} ${text}`);
      }
      setMsg(`Active updated: ${full_name} → ${next}`);
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Pause/Resume failed");
    }
  }

  async function deleteRepo(full_name: string) {
    const ok = window.confirm(`Delete ${full_name} and its commits?`);
    if (!ok) return;

    setErr(null);
    setMsg(null);

    try {
      const encoded = encodeFullName(full_name);
      const res = await fetch(`${API_BASE}/api/repos/${encoded}`, { method: "DELETE" });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`delete failed: ${res.status} ${text}`);
      }
      setMsg(`Deleted: ${full_name}`);
      await loadAll();
    } catch (e: any) {
      setErr(e?.message ?? "Delete failed");
    }
  }

  function onSearchSubmit(e: React.FormEvent) {
    e.preventDefault();
    loadAll({ search });
  }

  return (
    <main className="min-h-screen bg-slate-50 text-slate-900 p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex flex-col gap-2">
          <h1 className="text-3xl font-semibold">GitHub Activity Dashboard</h1>
          <div className="text-sm text-slate-600">
            Backend: <span className="font-mono">{API_BASE}</span>
          </div>
        </header>

        {/* Ingest controls */}
        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <div className="grid grid-cols-1 md:grid-cols-12 gap-3 items-end">
            <div className="md:col-span-6">
              <label className="block text-sm text-slate-600 mb-1">Repo (owner/repo)</label>
              <input
                className="w-full rounded-xl border px-3 py-2 font-mono text-sm"
                value={repoInput}
                onChange={(e) => setRepoInput(e.target.value)}
                placeholder="fastapi/fastapi"
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-slate-600 mb-1">per_page</label>
              <input
                type="number"
                min={1}
                max={100}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                value={perPage}
                onChange={(e) => setPerPage(Number(e.target.value))}
              />
            </div>

            <div className="md:col-span-2">
              <label className="block text-sm text-slate-600 mb-1">max_pages</label>
              <input
                type="number"
                min={1}
                max={10}
                className="w-full rounded-xl border px-3 py-2 text-sm"
                value={maxPages}
                onChange={(e) => setMaxPages(Number(e.target.value))}
              />
            </div>

            <div className="md:col-span-2 flex gap-2">
              <button
                onClick={ingestRepo}
                disabled={ingesting}
                className="flex-1 rounded-xl bg-slate-900 text-white px-4 py-2 text-sm disabled:opacity-60"
              >
                {ingesting ? "Ingesting..." : "Ingest"}
              </button>
              <button
                onClick={() => loadAll()}
                disabled={loading}
                className="rounded-xl border px-4 py-2 text-sm disabled:opacity-60"
              >
                {loading ? "..." : "Refresh"}
              </button>
            </div>
          </div>

          {msg && <div className="text-sm text-green-700">{msg}</div>}
          {err && <div className="text-sm text-red-700">Error: {err}</div>}
        </section>

        {/* KPI cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Card title="Tracked Repos" value={summary?.totals.repos ?? "—"} />
          <Card title="Total Commits" value={summary?.totals.commits ?? "—"} />
          <Card title="Commits (7d)" value={summary?.totals.commits_7d ?? "—"} />
          <Card title="Commits (30d)" value={summary?.totals.commits_30d ?? "—"} />
        </section>

        {/* Highlights */}
        <section className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Info title="Last ingested" value={fmt(summary?.last_ingested_at ?? null)} />
          <Info
            title="Top repo (30d)"
            value={
              summary?.top_repo_30d ? (
                <Link className="underline" href={`/repo/${summary.top_repo_30d.full_name}`}>
                  {summary.top_repo_30d.full_name} ({summary.top_repo_30d.commit_count})
                </Link>
              ) : (
                "—"
              )
            }
          />
          <Info
            title="Most active day (30d)"
            value={
              summary?.most_active_day_30d
                ? `${summary.most_active_day_30d.day} (${summary.most_active_day_30d.commit_count})`
                : "—"
            }
          />
        </section>

        {/* Chart */}
        <section className="rounded-2xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Commits per day (last 30 days)</h2>
            <span className="text-sm text-slate-500">{series.length} points</span>
          </div>

          <div className="w-full h-80">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="commit_count" dot={false} strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {!hasData && (
            <div className="mt-3 text-sm text-slate-600">
              No data yet — ingest a repo above.
            </div>
          )}
        </section>

        {/* Repo list + search + actions */}
        <section className="rounded-2xl border bg-white p-5 shadow-sm space-y-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <h2 className="text-lg font-medium">Repos</h2>

            <form onSubmit={onSearchSubmit} className="flex gap-2">
              <input
                className="rounded-xl border px-3 py-2 text-sm w-64"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search repos..."
              />
              <button className="rounded-xl border px-4 py-2 text-sm" type="submit" disabled={loading}>
                Search
              </button>
              <button
                type="button"
                className="rounded-xl border px-4 py-2 text-sm"
                onClick={() => {
                  setSearch("");
                  loadAll({ search: "" });
                }}
                disabled={loading}
              >
                Clear
              </button>
            </form>
          </div>

          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="text-left text-slate-500 border-b">
                <tr>
                  <th className="py-2 pr-4">Repo</th>
                  <th className="py-2 pr-4">Commits (30d)</th>
                  <th className="py-2 pr-4">Stars</th>
                  <th className="py-2 pr-4">Forks</th>
                  <th className="py-2 pr-4">Open issues</th>
                  <th className="py-2 pr-4">Pinned</th>
                  <th className="py-2 pr-4">Active</th>
                  <th className="py-2 pr-4">Actions</th>
                </tr>
              </thead>
              <tbody>
                {repos.map((r) => (
                  <tr key={r.full_name} className="border-b last:border-b-0">
                    <td className="py-2 pr-4">
                      <Link className="underline" href={`/repo/${r.full_name}`}>
                        {r.full_name}
                      </Link>
                      <div className="text-xs text-slate-500">
                        last ingested: {fmt(r.last_ingested_at)}
                      </div>
                    </td>
                    <td className="py-2 pr-4">{r.commit_count ?? 0}</td>
                    <td className="py-2 pr-4">{r.stars ?? "—"}</td>
                    <td className="py-2 pr-4">{r.forks ?? "—"}</td>
                    <td className="py-2 pr-4">{r.open_issues ?? "—"}</td>

                    <td className="py-2 pr-4">
                      <button
                        className="rounded-lg border px-2 py-1 text-xs"
                        onClick={() => togglePin(r.full_name, !r.is_pinned)}
                      >
                        {r.is_pinned ? "Unpin" : "Pin"}
                      </button>
                    </td>

                    <td className="py-2 pr-4">
                      <button
                        className="rounded-lg border px-2 py-1 text-xs"
                        onClick={() => toggleActive(r.full_name, !r.is_active)}
                      >
                        {r.is_active ? "Pause" : "Resume"}
                      </button>
                    </td>

                    <td className="py-2 pr-4">
                      <button
                        className="rounded-lg border px-2 py-1 text-xs"
                        onClick={() => deleteRepo(r.full_name)}
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}

                {!loading && repos.length === 0 && (
                  <tr>
                    <td className="py-3 text-slate-600" colSpan={8}>
                      No repos found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </main>
  );
}

function Card({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 text-2xl font-semibold">{value}</div>
    </div>
  );
}

function Info({ title, value }: { title: string; value: React.ReactNode }) {
  return (
    <div className="rounded-2xl border bg-white p-5 shadow-sm">
      <div className="text-sm text-slate-500">{title}</div>
      <div className="mt-2 font-medium">{value}</div>
    </div>
  );
}