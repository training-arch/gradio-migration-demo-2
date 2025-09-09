"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { useRouter } from "next/navigation";

type Preset = { name: string; description?: string; updated_at?: string };

export default function StartPage() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "upload">(null);
  const [error, setError] = useState<string | null>(null);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [presetName, setPresetName] = useState<string>("");
  const router = useRouter();

  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  useEffect(() => {
    // load saved presets list for dropdown
    try {
      axios
        .get(`${API}/configs`)
        .then((r) => {
          const items = (r.data?.items || []) as Preset[];
          setPresets(items);
        })
        .catch(() => {});
    } catch {}
  }, [API]);

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
      setUploadId(res.data?.upload_id || null);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Upload failed");
    } finally {
      setBusy(null);
    }
  };

  const canProcess = Boolean(uploadId && presetName);

  const handleProcess = async () => {
    if (!uploadId || !presetName) return;
    try {
      setError(null);
      const cfgRes = await axios.get(
        `${API}/configs/${encodeURIComponent(presetName)}`
      );
      const targets_config = cfgRes.data?.targets_config || {};
      const jobRes = await axios.post(`${API}/jobs`, {
        upload_id: uploadId,
        targets_config,
      });
      const jobId = jobRes.data?.job_id as string | undefined;
      if (!jobId) throw new Error("Job creation failed");
      router.push(`/jobs/${jobId}`);
    } catch (e: any) {
      setError(
        e?.response?.data?.detail || e?.message || "Failed to start job"
      );
    }
  };

  return (
    <main
      style={{
        padding: "2rem",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        maxWidth: 720,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>
        Upload our excel sheet to start auditing
      </h1>
      <div
        style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8 }}
      >
        <Link
          href="/configs"
          style={{ background: "#b9d6df", padding: "6px 10px", borderRadius: 6 }}
        >
          manage configs
        </Link>
      </div>

      {error && (
        <div
          style={{
            background: "#ffe9e9",
            border: "1px solid #f5b5b5",
            padding: "0.75rem 1rem",
            borderRadius: 8,
            marginBottom: 12,
            color: "#8a1f1f",
          }}
        >
          {error}
        </div>
      )}

      <section
        style={{
          padding: "1rem",
          border: "1px dashed #bbb",
          borderRadius: 12,
          textAlign: "center",
          marginBottom: 16,
        }}
      >
        <div style={{ marginBottom: 8, color: "#666" }}>Select an .xlsx file</div>
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <div style={{ marginTop: 8 }}>
          <button
            onClick={handleUpload}
            disabled={!file || busy === "upload"}
            style={{ padding: "6px 12px" }}
          >
            {busy === "upload" ? "Uploading…" : "Upload"}
          </button>
        </div>
        {uploadId && (
          <div style={{ marginTop: 8, color: "#333" }}>
            Uploaded: <code>{uploadId}</code>
          </div>
        )}
      </section>

      <section style={{ padding: "0.5rem 0" }}>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            marginBottom: 6,
          }}
        >
          <label style={{ fontWeight: 600 }}>Choose config</label>
          <Link
            href="/builder"
            style={{ background: "#b9d6df", padding: "4px 8px", borderRadius: 6 }}
          >
            + Create new
          </Link>
        </div>
        <select
          value={presetName}
          onChange={(e) => setPresetName((e.target as HTMLSelectElement).value)}
          style={{ width: 320, padding: "6px 8px" }}
        >
          <option value="">-- Select saved config --</option>
          {presets.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
            </option>
          ))}
        </select>
      </section>

      <div style={{ marginTop: 24 }}>
        <button
          onClick={handleProcess}
          disabled={!canProcess}
          style={{
            background: canProcess ? "#b9d6df" : "#dbe7ec",
            padding: "10px 16px",
            borderRadius: 6,
            minWidth: 220,
            cursor: canProcess ? "pointer" : "not-allowed",
          }}
        >
          Let’s process →
        </button>
        {!canProcess && (
          <div style={{ color: "#666", marginTop: 6, fontSize: 12 }}>
            Upload a file and select a config to continue.
          </div>
        )}
      </div>
    </main>
  );
}

