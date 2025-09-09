"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";

function Stepper({ active }: { active: 1 | 2 | 3 }) {
  const base = { padding: "4px 10px", borderRadius: 6, border: "1px solid #ddd", background: "#f7f7f7", fontWeight: 500 as const };
  const activeStyle = { ...base, background: "#eef6ff", fontWeight: 700 as const };
  return (
    <div style={{ display: "flex", gap: 8, justifyContent: "center", marginBottom: 10 }}>
      <div style={active === 1 ? activeStyle : base}>Step 1</div>
      <div style={active === 2 ? activeStyle : base}>Step 2</div>
      <div style={active === 3 ? activeStyle : base}>Step 3</div>
    </div>
  );
}

export default function BuilderStep3() {
  const sp = useSearchParams();
  const router = useRouter();
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  const [uploadId, setUploadId] = useState<string | null>(null);
  const [cfg, setCfg] = useState<Record<string, any>>({});
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [saving, setSaving] = useState(false);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [okMsg, setOkMsg] = useState<string | null>(null);

  useEffect(() => {
    const fromQuery = sp.get("uploadId");
    let id: string | null = fromQuery;
    try {
      if (!id && typeof window !== "undefined") {
        id = sessionStorage.getItem("builder.uploadId");
      }
      if (id && typeof window !== "undefined") {
        sessionStorage.setItem("builder.uploadId", id);
      }
    } catch {}
    setUploadId(id);
    try {
      const raw = typeof window !== "undefined" ? sessionStorage.getItem("builder.targetsConfig") : null;
      setCfg(raw ? JSON.parse(raw) : {});
    } catch {
      setCfg({});
    }
  }, [sp]);

  const targets = useMemo(() => Object.keys(cfg || {}), [cfg]);
  const badge = (t: string) => {
    const c = cfg[t] || {};
    const ai = c.ai ? "AI ON" : "AI OFF";
    const wc = c.wc ? `WC ${c.wc_min ?? 7}` : "WC OFF";
    const kwCount = c.kw_flag?.enabled && Array.isArray(c.kw_flag?.phrases) ? c.kw_flag.phrases.length : 0;
    const kw = c.kw_flag?.enabled ? `KW ${kwCount}` : "KW OFF";
    const vf = c.vf_on ? `Filters ${Object.keys(c.filters || {}).length}` : "Filters OFF";
    const mode = c.filter_mode === "OR" ? "Mode OR" : "Mode AND";
    return `${ai} | ${wc} | ${kw} | ${vf} | ${mode}`;
  };

  const canSave = useMemo(() => name.trim().length > 0 && targets.length > 0, [name, targets]);
  const canRun = useMemo(() => !!uploadId && targets.length > 0, [uploadId, targets]);

  const saveConfig = async () => {
    if (!canSave) return;
    try {
      setSaving(true);
      setError(null);
      setOkMsg(null);
      await axios.post(`${API}/configs`, { name: name.trim(), description: desc || "", targets_config: cfg });
      setOkMsg("Config saved");
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Save failed");
    } finally {
      setSaving(false);
    }
  };

  const runJob = async () => {
    if (!canRun || !uploadId) return;
    try {
      setRunning(true);
      setError(null);
      const res = await axios.post(`${API}/jobs`, {
        upload_id: uploadId,
        targets_config: cfg,
      });
      const jobId: string | undefined = res.data?.job_id;
      if (!jobId) throw new Error("Job creation failed");
      router.push(`/jobs/${jobId}`);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to start job");
    } finally {
      setRunning(false);
    }
  };

  return (
    <main style={{ padding: "2rem", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", maxWidth: 900, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Summary</h1>
      <Stepper active={3} />

      {error && (
        <div style={{ background: "#ffe9e9", border: "1px solid #f5b5b5", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: 12, color: "#8a1f1f" }}>{error}</div>
      )}
      {okMsg && (
        <div style={{ background: "#e6f6ea", border: "1px solid #b5e5c1", padding: "0.75rem 1rem", borderRadius: 8, marginBottom: 12, color: "#05620e" }}>{okMsg}</div>
      )}

      <section style={{ marginBottom: 12 }}>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <input placeholder="Config name" value={name} onChange={(e) => setName((e.target as HTMLInputElement).value)} style={{ flex: 1, minWidth: 220 }} />
          <input placeholder="Description (optional)" value={desc} onChange={(e) => setDesc((e.target as HTMLInputElement).value)} style={{ flex: 2, minWidth: 320 }} />
          <button onClick={saveConfig} disabled={!canSave || saving} style={{ background: !canSave || saving ? "#dbe7ec" : "#b9d6df", padding: "6px 12px", borderRadius: 6 }}>
            {saving ? "Saving…" : "Save config"}
          </button>
          <button onClick={runJob} disabled={!canRun || running} style={{ background: !canRun || running ? "#dbe7ec" : "#b9d6df", padding: "6px 12px", borderRadius: 6 }}>
            {running ? "Starting…" : "Run job"}
          </button>
        </div>
        {!uploadId && (
          <div style={{ marginTop: 6, color: "#666", fontSize: 12 }}>Upload ID missing. Go back to Step 1 to upload your file.</div>
        )}
      </section>

      <section style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
        {targets.length === 0 && <div style={{ color: "#666" }}>No targets configured.</div>}
        {targets.map((t) => (
          <div key={t} style={{ padding: "8px 0", borderTop: "1px dashed #e8e8e8" }}>
            <div style={{ fontWeight: 700 }}>{t}</div>
            <div style={{ fontSize: 12, color: "#333" }}>{badge(t)}</div>
          </div>
        ))}
      </section>

      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <button
          onClick={() => {
            if (uploadId) router.push(`/builder/step2?uploadId=${encodeURIComponent(uploadId)}`);
            else router.push("/builder/step2");
          }}
        >
          ← Back to Step 2
        </button>
        <Link href="/start" style={{ textDecoration: "underline" }}>
          Back to Start
        </Link>
      </div>
    </main>
  );
}
