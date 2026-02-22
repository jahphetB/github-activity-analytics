"use client";

import React, { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
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

type ActivityPoint = { day: string; commit_count: number };
type ActivityResponse = { repo: string; days: number; series: ActivityPoint[] };

type ContributorRow = { contributor: string; commit_count: number };
type ContributorsResponse = {
  repo: string;
  days: number;
  limit: number;
  results: ContributorRow[];
};

export default function RepoPage() {
  // In newer Next.js, for Client Components, useParams() is the safest way to read dynamic route params.
  const params = useParams();

  // For a catch-all route [...full_name], Next returns either:
  // - string[] (most common): ["fastapi", "fastapi"]
  // - or string (edge cases)
  const fullName = useMemo(() => {
    const raw = params?.full_name;

    if (Array.isArray(raw)) return raw.join("/");
    if (typeof raw === "string") return raw;

    return "";
  }, [params]);

  const [series, setSeries] = useState<ActivityPoint[]>([]);
  const [contributors, setContributors] = useState<ContributorRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      // If fullName isn't ready yet, don't fetch.
      if (!fullName) return;

      try {
        setLoading(true);
        setError(null);

        // IMPORTANT:
        // encodeURIComponent(fullName) turns "fastapi/fastapi" into "fastapi%2Ffastapi"
        // Your FastAPI route uses {full_name:path}, so it can accept slashes directly.
        // We'll build the URL without encoding the slash structure.
        const activityUrl = `${API_BASE}/repos/${fullName}/activity?days=30`;
        const contribUrl = `${API_BASE}/repos/${fullName}/contributors?days=30&limit=15`;

        const [aRes, cRes] = await Promise.all([fetch(activityUrl), fetch(contribUrl)]);

        if (!aRes.ok) throw new Error(`activity failed: ${aRes.status}`);
        if (!cRes.ok) throw new Error(`contributors failed: ${cRes.status}`);

        const aJson: ActivityResponse = await aRes.json();
        const cJson: ContributorsResponse = await cRes.json();

        if (!cancelled) {
          setSeries(aJson.series ?? []);
          setContributors(cJson.results ?? []);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [fullName]);

  return (
    <main className="min-h-screen p-6 md:p-10">
      <div className="max-w-6xl mx-auto space-y-6">
        <header className="flex items-center justify-between gap-4">
          <div>
            <a className="text-sm underline text-gray-600" href="/">
              ← Back
            </a>
            <h1 className="text-2xl md:text-3xl font-semibold mt-2">
              {fullName || "Loading..."}
            </h1>
            <p className="text-sm text-gray-600">Repo drilldown: activity + contributors</p>
          </div>
        </header>

        {error && (
          <div className="rounded-xl border p-4 bg-red-50 text-red-800">
            Error: {error}
          </div>
        )}

        <section className="rounded-2xl border bg-white p-4 md:p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-medium">Commits over last 30 days</h2>
            <span className="text-sm text-gray-500">{series.length} points</span>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={series}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="day" />
                <YAxis allowDecimals={false} />
                <Tooltip />
                <Line type="monotone" dataKey="commit_count" strokeWidth={2} dot={false} />
              </LineChart>
            </ResponsiveContainer>
          </div>

          {!loading && series.length === 0 && (
            <div className="text-sm text-gray-500 mt-3">
              No commits found in this window. Try ingesting more pages.
            </div>
          )}
        </section>

        <section className="rounded-2xl border bg-white p-4 md:p-6 shadow-sm">
          <h2 className="text-lg font-medium mb-4">Top contributors (30 days)</h2>

          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-gray-600 border-b">
                <tr>
                  <th className="py-2 pr-4">Contributor</th>
                  <th className="py-2 pr-4">Commits</th>
                </tr>
              </thead>
              <tbody>
                {contributors.map((c) => (
                  <tr key={c.contributor} className="border-b last:border-b-0">
                    <td className="py-2 pr-4 font-medium">{c.contributor}</td>
                    <td className="py-2 pr-4">{c.commit_count}</td>
                  </tr>
                ))}
                {!loading && contributors.length === 0 && (
                  <tr>
                    <td className="py-4 text-gray-500" colSpan={2}>
                      No contributor data yet.
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