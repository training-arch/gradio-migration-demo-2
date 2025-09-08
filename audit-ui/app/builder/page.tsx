"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { useSearchParams } from "next/navigation";
import { useRouter } from "next/navigation";


function Stepper({ active }: { active: 1 | 2 | 3 }) {
  const base = {
    padding: "4px 10px",
    borderRadius: 6,
    border: "1px solid #ddd",
    background: "#f7f7f7",
    fontWeight: 500 as const,
  };
  const activeStyle = { ...base, background: "#eef6ff", fontWeight: 700 as const };
  const disabledStyle = { ...base, opacity: 0.5, cursor: "not-allowed" as const };
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 10 }}>
      <div style={active === 1 ? activeStyle : base}>Step 1</div>
      <div style={active === 2 ? activeStyle : disabledStyle}>Step 2</div>
      <div style={active === 3 ? activeStyle : disabledStyle}>Step 3</div>
    </div>
  );
}

export default function BuilderStep1() {
  const sp = useSearchParams();
  const router = useRouter();
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState<null | "upload" | "columns">(null);
  const [error, setError] = useState<string | null>(null);

  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  // pick uploadId from query if present (so Start can pass it)
  const initialUploadId = useMemo(() => sp.get('uploadId'), [sp]);

  useEffect(() => {
    if (initialUploadId && !uploadId) {
      setUploadId(initialUploadId);
    }
  }, [initialUploadId, uploadId]);

  useEffect(() => {
    const fetchColumns = async (uid: string) => {
      try {
        setBusy("columns");
        setError(null);
        const res = await axios.get(`${API}/uploads/${uid}/columns`);
        const cols = (res.data?.columns || []) as string[];
        setColumns(cols);
      } catch (e) {
        setError("Failed to load columns");
      } finally {
        setBusy(null);
      }
    };
    if (uploadId) fetchColumns(uploadId);
  }, [API, uploadId]);

  const handleUpload = async () => {
    if (!file) return;
    try {
      setBusy("upload");
      setError(null);
      const formData = new FormData();
      formData.append("file", file);
      const res = await axios.post(`${API}/uploads`, formData, {
        headers: { Accept: "application/json" },
      });
      const uid: string = res.data?.upload_id;
      setUploadId(uid || null);
    } catch (e) {
      setError("Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const toggle = (col: string) => {
    setSelected((prev) => (prev.includes(col) ? prev.filter((c) => c !== col) : [...prev, col]));
  };

  // Persist to sessionStorage so Step 2 can pick it up later
  useEffect(() => {
    try {
      if (uploadId) sessionStorage.setItem('builder.uploadId', uploadId);
      sessionStorage.setItem('builder.selectedTargets', JSON.stringify(selected || []));
    } catch {}
  }, [uploadId, selected]);

  return (
    <main style={{ padding: "2rem", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Upload Excel sheet</h1>
      <Stepper active={1} />

      {error && (
        <div style={{ background: "#ffe9e9", border: "1px solid #f5b5b5", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: 12, color: "#8a1f1f" }}>
          {error}
        </div>
      )}

      {/* Upload area */}
      <section style={{ padding: "1rem", border: "1px dashed #bbb", borderRadius: 12, textAlign: "center", marginBottom: 16 }}>
        <div style={{ marginBottom: 8, color: "#666" }}>Select an .xlsx file</div>
        <input type="file" accept=".xlsx" onChange={(e) => setFile(e.target.files?.[0] || null)} />
        <div style={{ marginTop: 8 }}>
          <button onClick={handleUpload} disabled={!file || busy === "upload"} style={{ padding: "6px 12px" }}>
            {busy === "upload" ? "Uploading…" : "Upload"}
          </button>
        </div>
        {uploadId && <div style={{ marginTop: 8 }}>Uploaded: <code>{uploadId}</code></div>}
      </section>

      {/* Columns checklist */}
      <section>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>Select Target Columns to check</div>
        {!uploadId && <div style={{ color: "#666", marginBottom: 8 }}>Upload a file first to load columns.</div>}
        {busy === "columns" && <div style={{ color: "#666", marginBottom: 8 }}>Loading columns…</div>}
        {uploadId && columns.length === 0 && busy !== "columns" && (
          <div style={{ color: "#666", marginBottom: 8 }}>No columns found.</div>
        )}
        <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
          {columns.map((c) => (
            <label key={c} style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 160 }}>
              <input type="checkbox" checked={selected.includes(c)} onChange={() => toggle(c)} />
              {c}
            </label>
          ))}
        </div>
      </section>

      <div style={{ marginTop: 20, display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={() => {
            if (!uploadId || selected.length === 0) return;
            // sessionStorage already populated; pass uploadId in query
            router.push(`/builder/step2?uploadId=${encodeURIComponent(uploadId)}`);
          }}
          disabled={!uploadId || selected.length === 0}
          style={{
            background: (!uploadId || selected.length === 0) ? "#dbe7ec" : "#b9d6df",
            padding: "10px 16px",
            borderRadius: 6,
            minWidth: 220,
            cursor: (!uploadId || selected.length === 0) ? "not-allowed" : "pointer",
          }}
        >
          Continue to Step 2 →
        </button>
      </div>

      <div style={{ marginTop: 20 }}>
        <Link href="/start" style={{ textDecoration: "underline" }}>Back to Start</Link>
      </div>
    </main>
  );
}
