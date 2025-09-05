"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";

type JobStatus = {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | string;
  progress?: number;
  error?: string | null;
};

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "job" | "poll">(null);
  const [error, setError] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [configText, setConfigText] = useState<string>("{}");
  const [preview, setPreview] = useState<null | {
    rows_total: number;
    rows_kept: number;
    per_target_counts: Record<string, number>;
    sample_rows: any[];
  }>(null);
  const [previewBusy, setPreviewBusy] = useState<boolean>(false);

  // Backend base URL: change here or set NEXT_PUBLIC_API_BASE
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  // Keep a polling interval so we can clear it on unmount
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => {
      if (pollTimer.current) clearInterval(pollTimer.current);
    };
  }, []);

  const resetStateForNewUpload = () => {
    setJobId(null);
    setStatus(null);
    setDownloadUrl(null);
    setError(null);
    setColumns([]);
    setTargets([]);
    setConfigText("{}");
    if (pollTimer.current) {
      clearInterval(pollTimer.current);
      pollTimer.current = null;
    }
  };

  const handleUpload = async () => {
    try {
      setBusy("upload");
      setError(null);
      if (!file) return;

      const formData = new FormData();
      formData.append("file", file);

      const res = await axios.post(`${API}/uploads`, formData, {
        // Let axios set the multipart boundary automatically
        headers: { "Accept": "application/json" },
      });

      setUploadId(res.data.upload_id);
      resetStateForNewUpload();
      try {
        const colsRes = await axios.get(`${API}/uploads/${res.data.upload_id}/columns`);
        setColumns(colsRes.data.columns || []);
      } catch (e: any) {
        console.warn("Failed to fetch columns", e?.message);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Upload failed");
    } finally {
      setBusy(null);
    }
  };
  // Build default config from selected targets and allow editing as JSON
  const buildDefaults = (cols: string[]) => {
    const cfg: Record<string, any> = {};
    for (const c of cols) {
      cfg[c] = {
        ai: false,
        prompt: "",
        wc: true,
        wc_min: 3,
        kw_flag: { enabled: false, mode: "ANY", phrases: [] },
        vf_on: false,
        filters: {},
        filter_mode: "AND",
        tf_on: false,
        text_filters: {},
      };
    }
    return cfg;
  };

  const initConfigFromTargets = () => {
    const cfg = buildDefaults(targets || []);
    setConfigText(JSON.stringify(cfg, null, 2));
  };

  const handlePreview = async () => {
    try {
      if (!uploadId) return;
      setPreviewBusy(true);
      setError(null);
      setPreview(null);

      let parsed: any = {};
      try {
        parsed = JSON.parse(configText || "{}");
      } catch (e: any) {
        throw new Error("Invalid targets_config JSON");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("targets_config must be a JSON object");
      }

      const params = { targets_config: JSON.stringify(parsed), limit: 10 } as any;
      const res = await axios.get(`${API}/uploads/${uploadId}/preview`, { params });
      setPreview(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Preview failed");
    } finally {
      setPreviewBusy(false);
    }
  };

  const handleJob = async () => {
    try {
      if (!uploadId) return;
      setBusy("job");
      setError(null);

      let parsed: any = {};
      try {
        parsed = JSON.parse(configText || "{}");
      } catch (e: any) {
        throw new Error("Invalid targets_config JSON");
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error("targets_config must be a JSON object");
      }

      const res = await axios.post(`${API}/jobs`, { upload_id: uploadId, targets_config: parsed });
      const id: string = res.data.job_id;
      setJobId(id);
      setStatus({ status: "PENDING", progress: 0 });

      // Start auto-polling every 1s until finished
      if (pollTimer.current) clearInterval(pollTimer.current);
      pollTimer.current = setInterval(() => {
        pollOnce(id).catch((err) => {
          console.error(err);
          setError(err?.message || "Polling failed");
          if (pollTimer.current) {
            clearInterval(pollTimer.current);
            pollTimer.current = null;
          }
        });
      }, 1000);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Job creation failed");
    } finally {
      setBusy(null);
    }
  };

  const pollOnce = async (id: string) => {
    const res = await axios.get<JobStatus>(`${API}/jobs/${id}`);
    const js = res.data;
    setStatus(js);

    if (js.status === "SUCCEEDED") {
      setDownloadUrl(`${API}/jobs/${id}/download`);
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    } else if (js.status === "FAILED") {
      setError(js.error || "Job failed");
      if (pollTimer.current) {
        clearInterval(pollTimer.current);
        pollTimer.current = null;
      }
    }
  };

  const manualPoll = async () => {
    if (!jobId) return;
    try {
      setBusy("poll");
      await pollOnce(jobId);
    } catch (e: any) {
      setError(e?.message || "Poll failed");
    } finally {
      setBusy(null);
    }
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", maxWidth: 800, margin: "0 auto" }}>
      <h1 style={{ fontSize: "1.75rem", fontWeight: 700, marginBottom: "0.5rem" }}>
        Audit Wizard
      </h1>
      <p style={{ color: "#555" }}>
        Backend: <code>{API}</code>
      </p>

      {/* Errors */}
      {error && (
        <div style={{ background: "#ffe9e9", border: "1px solid #f5b5b5", padding: "0.75rem 1rem", borderRadius: 8, marginTop: "1rem", color: "#8a1f1f" }}>
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      <section style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid #eee", borderRadius: 10 }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Step 1 — Upload Excel
        </h2>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ minWidth: 260 }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Select Target Columns</label>
            <select multiple value={targets} onChange={(e) => {
              const opts = Array.from((e.target as HTMLSelectElement).selectedOptions).map(o => (o as HTMLOptionElement).value);
              setTargets(opts);
            }} style={{ width: "100%", minHeight: 120 }}>
              {(columns || []).map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </select>
            <button onClick={initConfigFromTargets} disabled={!uploadId || (targets.length === 0)} style={{ marginTop: 8 }}>
              Initialize Config From Selection
            </button>
          </div>
          <div style={{ flex: 1, minWidth: 320 }}>
            <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>targets_config (JSON)</label>
            <textarea
              value={configText}
              onChange={(e) => setConfigText((e.target as HTMLTextAreaElement).value)}
              rows={14}
              style={{ width: "100%", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
              placeholder={'{ "ColumnName": { "wc": true } }'}
            />
          </div>
        </div>
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <button onClick={handlePreview} disabled={!uploadId || previewBusy}>
            {previewBusy ? "Previewing…" : "Preview (top 10)"}
          </button>
          {preview && (
            <span>
              Kept {preview.rows_kept} of {preview.rows_total} rows
            </span>
          )}
        </div>
        {preview && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Per‑target counts</div>
            <pre style={{ background: "#fafafa", padding: 8, border: "1px solid #eee", borderRadius: 8 }}>
              {JSON.stringify(preview.per_target_counts, null, 2)}
            </pre>
            <div style={{ fontWeight: 600, margin: "6px 0 4px" }}>Sample rows</div>
            <div style={{ overflowX: "auto", border: "1px solid #eee", borderRadius: 8 }}>
              <table style={{ width: "100%", borderCollapse: "collapse" }}>
                <thead>
                  <tr>
                    {Object.keys(preview.sample_rows[0] || {}).map((k) => (
                      <th key={k} style={{ textAlign: "left", borderBottom: "1px solid #eee", padding: 6 }}>{k}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(preview.sample_rows || []).map((row, idx) => (
                    <tr key={idx}>
                      {Object.keys(preview.sample_rows[0] || {}).map((k) => (
                        <td key={k} style={{ borderBottom: "1px solid #f5f5f5", padding: 6 }}>{String(row[k])}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
        <button
          onClick={handleUpload}
          disabled={!file || busy === "upload"}
          style={{ marginLeft: 8 }}
        >
          {busy === "upload" ? "Uploading…" : "Upload"}
        </button>
        {uploadId && (
          <p style={{ marginTop: 8 }}>
            ✅ Uploaded: <code>{uploadId}</code>
          </p>
        )}
      </section>

      {/* Step 2: Create Job */}
      <section style={{ marginTop: "1rem", padding: "1rem", border: "1px solid #eee", borderRadius: 10 }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Step 2 — Create Job
        </h2>
        <button
          onClick={handleJob}
          disabled={!uploadId || busy === "job"}
        >
          {busy === "job" ? "Creating…" : "Create Job"}
        </button>
        {jobId && (
          <p style={{ marginTop: 8 }}>
            📌 Job ID: <code>{jobId}</code>
          </p>
        )}
      </section>

      {/* Step 3: Status + Download */}
      <section style={{ marginTop: "1rem", padding: "1rem", border: "1px solid #eee", borderRadius: 10 }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Step 3 — Status
        </h2>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={manualPoll} disabled={!jobId || busy === "poll"}>
            {busy === "poll" ? "Polling…" : "Poll Now"}
          </button>
          {status?.progress !== undefined && (
            <span>Progress: {Math.min(100, Math.max(0, Number(status.progress) || 0))}%</span>
          )}
          {status?.status && <span>Status: <strong>{status.status}</strong></span>}
        </div>

        {status && (
          <pre style={{ marginTop: 10, background: "#fafafa", padding: 10, borderRadius: 8, border: "1px solid #eee" }}>
            {JSON.stringify(status, null, 2)}
          </pre>
        )}

        {/* Download */}
        {downloadUrl && (
          <div style={{ marginTop: 12 }}>
            <a href={downloadUrl} download="mistakes_only.xlsx">
              ⬇️ Download Result
            </a>
          </div>
        )}
      </section>
    </main>
  );
}
