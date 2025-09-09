"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";

type JobState = {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | string;
  progress: number;
  error?: string | null;
};

export default function JobStatusPage() {
  const { jobId } = useParams<{ jobId: string }>();
  const router = useRouter();
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  const [state, setState] = useState<JobState>({
    status: "PENDING",
    progress: 0,
    error: null,
  });
  const [polling, setPolling] = useState<boolean>(true);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const [builderUploadId, setBuilderUploadId] = useState<string | null>(null);
  const [hasBuilderConfig, setHasBuilderConfig] = useState<boolean>(false);

  const downloadUrl = useMemo(() => `${API}/jobs/${jobId}/download`, [API, jobId]);

  const poll = async () => {
    try {
      const r = await axios.get(`${API}/jobs/${jobId}`);
      const next: JobState = {
        status: r.data?.status || "PENDING",
        progress: Number(r.data?.progress ?? 0),
        error: r.data?.error ?? null,
      };
      setState(next);
      if (next.status === "SUCCEEDED" || next.status === "FAILED") {
        setPolling(false);
      }
    } catch (e: any) {
      setState((prev) => ({ ...prev, error: e?.response?.data?.detail || e?.message || "Failed to fetch job" }));
    }
  };

  useEffect(() => {
    if (!jobId) return;
    // initial fetch
    poll();
    // start interval
    if (polling) {
      timerRef.current = setInterval(poll, 1000);
    }
    // read session data for navigation back to Step 3
    try {
      if (typeof window !== "undefined") {
        const id = sessionStorage.getItem("builder.uploadId");
        const cfg = sessionStorage.getItem("builder.targetsConfig");
        setBuilderUploadId(id);
        setHasBuilderConfig(Boolean(cfg && cfg.length > 2));
      }
    } catch {}
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, polling, API]);

  const progressPct = Math.max(0, Math.min(100, Number(state.progress || 0)));

  return (
    <main
      style={{
        padding: "2rem",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 12 }}>Processing your file</h1>
      <div style={{ color: "#555", marginBottom: 16 }}>Job ID: <code>{jobId}</code></div>

      {/* Status Panel */}
      <section style={{ border: "1px solid #ddd", borderRadius: 10, padding: 16, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ fontWeight: 600 }}>Status: {state.status}</div>
          <div style={{ color: "#666" }}>{progressPct}%</div>
        </div>
        <div style={{ height: 10, background: "#eef3f6", borderRadius: 6, overflow: "hidden", marginTop: 8 }}>
          <div style={{ width: `${progressPct}%`, height: "100%", background: "#b9d6df" }} />
        </div>
        {state.error && (
          <div style={{ marginTop: 10, color: "#8a1f1f" }}>Error: {state.error}</div>
        )}

        {state.status === "FAILED" && (
          <div style={{ marginTop: 12, display: "flex", gap: 10 }}>
            <button onClick={() => setPolling(true)} style={{ padding: "6px 12px", background: "#f0f4f6", borderRadius: 6 }}>
              Poll now
            </button>
            <Link href="/start" style={{ padding: "6px 12px", background: "#f0f4f6", borderRadius: 6 }}>Go back home</Link>
          </div>
        )}

        {state.status === "SUCCEEDED" && (
          <div style={{ marginTop: 14, padding: 12, border: "1px solid #cfe3ea", background: "#f3f9fb", borderRadius: 8 }}>
            <div style={{ fontWeight: 600, marginBottom: 8 }}>Your file is ready</div>
            <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <a href={downloadUrl} style={{ padding: "8px 12px", background: "#b9d6df", borderRadius: 6 }}>
                Download result
              </a>
              <Link href="/start" style={{ padding: "8px 12px", background: "#f0f4f6", borderRadius: 6 }}>
                Go back home
              </Link>
              <button
                onClick={() => {
                  const id = builderUploadId;
                  if (id) router.push(`/builder/step3?uploadId=${encodeURIComponent(id)}`);
                  else router.push(`/builder/step3`);
                }}
                disabled={!hasBuilderConfig}
                style={{ padding: "8px 12px", background: hasBuilderConfig ? "#f0f4f6" : "#dbe7ec", borderRadius: 6 }}
              >
                Edit/Save config
              </button>
            </div>
          </div>
        )}
      </section>

      {state.status !== "SUCCEEDED" && state.status !== "FAILED" && (
        <div style={{ color: "#666" }}>We’ll refresh the status every second…</div>
      )}
    </main>
  );
}
