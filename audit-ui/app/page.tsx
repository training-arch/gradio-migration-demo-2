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
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const handleJob = async () => {
    try {
      if (!uploadId) return;
      setBusy("job");
      setError(null);

      const payload = {
        upload_id: uploadId,
        targets_config: {
          Enquiry: {
            wc: true,
            wc_min: 3,
            kw_flag: { enabled: true, mode: "ANY", phrases: ["urgent", "help"] },
          },
        },
      };

      const res = await axios.post(`${API}/jobs`, payload);
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
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
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
