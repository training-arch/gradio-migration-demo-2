"use client";

import { useEffect, useRef, useState } from "react";
import axios from "axios";

type JobStatus = {
  status: "PENDING" | "RUNNING" | "SUCCEEDED" | "FAILED" | string;
  progress?: number;
  error?: string | null;
};

function KeywordEditor({ phrases, onAdd, onRemove }: { phrases: string[]; onAdd: (p: string) => void; onRemove: (p: string) => void }) {
  const [text, setText] = useState<string>("");
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={text}
          onChange={(e) => setText((e.target as HTMLInputElement).value)}
          placeholder="Add phrase"
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              const v = text.trim();
              if (v) { onAdd(v); setText(""); }
            }
          }}
          style={{ flex: 1 }}
        />
        <button onClick={() => { const v = text.trim(); if (v) { onAdd(v); setText(""); } }}>Add</button>
      </div>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: 8 }}>
        {(phrases || []).map((p) => (
          <span key={p} style={{ background: '#eef', border: '1px solid #dde', borderRadius: 12, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span>{p}</span>
            <button onClick={() => onRemove(p)} style={{ fontSize: 12 }}>x</button>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [uploadId, setUploadId] = useState<string | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [status, setStatus] = useState<JobStatus | null>(null);
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const [busy, setBusy] = useState<null | "upload" | "job" | "poll">(null);
  const [error, setError] = useState<string | null>(null);
  const [backendCfg, setBackendCfg] = useState<null | { job_runner: string; storage_backend: string }>(null);
  const [columns, setColumns] = useState<string[]>([]);
  const [targets, setTargets] = useState<string[]>([]);
  const [configText, setConfigText] = useState<string>("{}");
  const [configError, setConfigError] = useState<string | null>(null);
  const [configEmpty, setConfigEmpty] = useState<boolean>(true);
  const [mode, setMode] = useState<'preset' | 'builder'>('preset');
  const [presets, setPresets] = useState<Array<{ name: string; description?: string; updated_at?: string }>>([]);
  const [presetName, setPresetName] = useState<string>("");
  const [presetDesc, setPresetDesc] = useState<string>("");
  const [preview, setPreview] = useState<null | {
    rows_total: number;
    rows_kept: number;
    per_target_counts: Record<string, number>;
    sample_rows: any[];
  }>(null);
  const [previewBusy, setPreviewBusy] = useState<boolean>(false);
  const [previewLimit, setPreviewLimit] = useState<number>(10);
  // Phase 2 builder state
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState<Record<string, boolean>>({
    ai: true,
    wc: true,
    kw: false,
    vf: false,
    tf: false,
  });
  const [valuesCache, setValuesCache] = useState<Record<string, string[]>>({});
  const [valuesLoading, setValuesLoading] = useState<Record<string, boolean>>({});
  const [vfExpander, setVfExpander] = useState<Record<string, boolean>>({});
  const [tfExpander, setTfExpander] = useState<Record<string, boolean>>({});
  const statusLabel = status?.status || null;
  const statusBg = statusLabel === 'SUCCEEDED' ? '#e6f6ea' : statusLabel === 'FAILED' ? '#ffe9e9' : '#f3f3f3';
  const statusFg = statusLabel === 'SUCCEEDED' ? '#05620e' : statusLabel === 'FAILED' ? '#8a1f1f' : '#555';

  // Backend base URL: change here or set NEXT_PUBLIC_API_BASE
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  // Keep a polling interval so we can clear it on unmount
  const pollTimer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    // fetch backend runtime config for quick visibility
    try {
      axios.get(`${API}/config`).then((r) => {
        const b = r.data || {};
        setBackendCfg({ job_runner: String(b.job_runner || ''), storage_backend: String(b.storage_backend || '') });
      }).catch(() => {});
    } catch {}
    // load saved presets list
    try {
      axios.get(`${API}/configs`).then((r) => {
        const items = (r.data?.items || []) as Array<any>;
        setPresets(items);
      }).catch(() => {});
    } catch {}
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
    if (mode === 'builder') {
      setConfigText("{}");
      setConfigEmpty(true);
      setConfigError('targets_config cannot be empty');
    }
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
    setConfigError(null);
    setConfigEmpty(Object.keys(cfg).length === 0);
    if ((targets || []).length > 0) setActiveTarget(targets[0]);
  };

  // When active target changes, try to prefetch distinct values for mini-preview
  useEffect(() => {
    if (activeTarget && uploadId && !valuesCache[activeTarget] && !valuesLoading[activeTarget]) {
      fetchValuesForColumn(activeTarget);
    }
  }, [activeTarget, uploadId]);

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

      const params = { targets_config: JSON.stringify(parsed), limit: previewLimit } as any;
      const res = await axios.get(`${API}/uploads/${uploadId}/preview`, { params });
      setPreview(res.data);
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Preview failed");
    } finally {
      setPreviewBusy(false);
    }
  };

  // Helpers to parse and update the JSON in a single place
  const parseConfigSafe = (): { ok: true; data: any } | { ok: false; err: string } => {
    try {
      const parsed = JSON.parse(configText || "{}");
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, err: 'targets_config must be a JSON object' };
      }
      return { ok: true, data: parsed };
    } catch (e: any) {
      return { ok: false, err: e?.message || 'Invalid targets_config JSON' };
    }
  };

  const stringifyAndSetConfig = (cfg: any) => {
    const isEmpty = !cfg || Object.keys(cfg).length === 0;
    setConfigText(JSON.stringify(cfg || {}, null, 2));
    setConfigEmpty(isEmpty);
    setConfigError(isEmpty ? 'targets_config cannot be empty' : null);
  };

  const updateConfig = (updater: (cfg: any) => void) => {
    const res = parseConfigSafe();
    if (!res.ok) {
      setConfigError(res.err);
      return;
    }
    const cfg = res.data || {};
    updater(cfg);
    stringifyAndSetConfig(cfg);
  };

  const ensureTargetDefaults = (cfg: any, t: string) => {
    if (!cfg[t]) {
      cfg[t] = {
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
    } else {
      // add missing keys without overriding
      cfg[t].ai = Boolean(cfg[t].ai);
      cfg[t].prompt = typeof cfg[t].prompt === 'string' ? cfg[t].prompt : '';
      cfg[t].wc = cfg[t].wc === false ? false : true;
      cfg[t].wc_min = Math.max(1, Math.min(20, Number(cfg[t].wc_min ?? 3)));
      cfg[t].kw_flag = cfg[t].kw_flag || { enabled: false, mode: 'ANY', phrases: [] };
      cfg[t].kw_flag.enabled = Boolean(cfg[t].kw_flag.enabled);
      cfg[t].kw_flag.mode = (cfg[t].kw_flag.mode === 'ALL') ? 'ALL' : 'ANY';
      cfg[t].kw_flag.phrases = Array.isArray(cfg[t].kw_flag.phrases) ? cfg[t].kw_flag.phrases : [];
      cfg[t].vf_on = Boolean(cfg[t].vf_on);
      cfg[t].filters = cfg[t].filters && typeof cfg[t].filters === 'object' ? cfg[t].filters : {};
      cfg[t].filter_mode = (cfg[t].filter_mode === 'OR') ? 'OR' : 'AND';
      cfg[t].tf_on = Boolean(cfg[t].tf_on);
      cfg[t].text_filters = cfg[t].text_filters && typeof cfg[t].text_filters === 'object' ? cfg[t].text_filters : {};
    }
  };

  const fetchValuesForColumn = async (col: string) => {
    if (!uploadId || !col) return;
    try {
      setValuesLoading((p) => ({ ...p, [col]: true }));
      const res = await axios.get(`${API}/uploads/${uploadId}/values`, { params: { column: col, limit: 200 } });
      const vals: string[] = res.data?.values || [];
      setValuesCache((prev) => ({ ...prev, [col]: vals }));
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || `Failed to load values for ${col}`);
    }
    finally {
      setValuesLoading((p) => ({ ...p, [col]: false }));
    }
  };

  const targetBadge = (cfg: any, t: string) => {
    const c = (cfg && cfg[t]) || {};
    const ai = c.ai ? 'AI ON' : 'AI OFF';
    const wc = c.wc ? `WC ${c.wc_min ?? 3}` : 'WC OFF';
    const kwCount = (c.kw_flag?.enabled && Array.isArray(c.kw_flag?.phrases)) ? c.kw_flag.phrases.length : 0;
    const kw = (c.kw_flag?.enabled) ? (kwCount ? `KW ${kwCount}` : 'KW 0') : 'KW OFF';
    const vf = c.vf_on ? `Filters ${Object.keys(c.filters || {}).length}` : 'Filters OFF';
    const mode = (c.filter_mode === 'OR') ? 'Mode OR' : 'Mode AND';
    return `${ai} | ${wc} | ${kw} | ${vf} | ${mode}`;
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
      {backendCfg && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
          <span style={{ background: '#f3f3f3', border: '1px solid #e5e5e5', padding: '2px 8px', borderRadius: 12 }}>
            Runner: <strong>{backendCfg.job_runner}</strong>
          </span>
          <span style={{ background: '#f3f3f3', border: '1px solid #e5e5e5', padding: '2px 8px', borderRadius: 12 }}>
            Storage: <strong>{backendCfg.storage_backend}</strong>
          </span>
        </div>
      )}

      {/* Errors */}
      {error && (
        <div style={{ background: "#ffe9e9", border: "1px solid #f5b5b5", padding: "0.75rem 1rem", borderRadius: 8, marginTop: "1rem", color: "#8a1f1f" }}>
          {error}
        </div>
      )}

      {/* Step 1: Upload */}
      <section style={{ marginTop: "1.5rem", padding: "1rem", border: "1px solid #eee", borderRadius: 10 }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Step 1 - Upload Excel
        </h2>
        <div style={{ display: "flex", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
          <div style={{ minWidth: 260 }}>
            {mode === 'builder' && (
              <>
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
              </>
            )}
            {/* Presets chooser */}
            <div style={{ marginTop: 14 }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>Choose config</label>
              <select value={presetName} onChange={async (e) => {
                const name = (e.target as HTMLSelectElement).value;
                setPresetName(name);
                if (!name) return;
                try {
                  const res = await axios.get(`${API}/configs/${encodeURIComponent(name)}`);
                  const tc = res.data?.targets_config || {};
                  setPresetDesc(res.data?.description || "");
                  setConfigText(JSON.stringify(tc, null, 2));
                  const isEmpty = Object.keys(tc || {}).length === 0;
                  setConfigEmpty(isEmpty);
                  setConfigError(isEmpty ? 'targets_config cannot be empty' : null);
                  setMode('preset');
                } catch (err: any) {
                  setError(err?.response?.data?.detail || err?.message || 'Failed to load config');
                }
              }} style={{ width: '100%' }}>
                <option value="">-- Select saved config --</option>
                {presets.map((p) => (
                  <option key={p.name} value={p.name}>{p.name}</option>
                ))}
              </select>
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button onClick={() => { setPresetName(""); setPresetDesc(""); setConfigText("{}"); setMode('builder'); setConfigEmpty(true); setConfigError('targets_config cannot be empty'); }}>
                  + Create new
                </button>
                <button onClick={async () => {
                  try {
                    const parsed = JSON.parse(configText || "{}");
                    if (!presetName.trim()) throw new Error('Please enter a config name below');
                    await axios.post(`${API}/configs`, { name: presetName.trim(), description: presetDesc || "", targets_config: parsed });
                    // refresh list
                    const rl = await axios.get(`${API}/configs`);
                    setPresets(rl.data?.items || []);
                  } catch (e: any) {
                    setError(e?.response?.data?.detail || e?.message || 'Save failed');
                  }
                }} disabled={!!configError || configEmpty}>
                  Save config
                </button>
                <button onClick={async () => {
                  try {
                    if (!presetName.trim()) throw new Error('Choose a config to delete');
                    await axios.delete(`${API}/configs/${encodeURIComponent(presetName.trim())}`);
                    const rl = await axios.get(`${API}/configs`);
                    setPresets(rl.data?.items || []);
                    // move to builder, keep current JSON for editing
                    setMode('builder');
                    setPresetName("");
                  } catch (e: any) {
                    setError(e?.response?.data?.detail || e?.message || 'Delete failed');
                  }
                }} disabled={!presetName}>
                  Delete config
                </button>
              </div>
              <div style={{ marginTop: 6 }}>
                <input placeholder="Config name" value={presetName} onChange={(e) => setPresetName((e.target as HTMLInputElement).value)} style={{ width: '100%', marginBottom: 6 }} />
                <input placeholder="Description (optional)" value={presetDesc} onChange={(e) => setPresetDesc((e.target as HTMLInputElement).value)} style={{ width: '100%' }} />
              </div>
              {mode === 'preset' && (
                <div style={{ marginTop: 12 }}>
                  <button
                    onClick={handleJob}
                    disabled={!uploadId || !presetName || !!configError || configEmpty || busy === 'job'}
                    style={{ background: '#b9d6df', padding: '8px 14px', borderRadius: 6 }}
                  >
                    Let's process
                  </button>
                </div>
              )}
            </div>
          </div>
          {mode === 'builder' && (
          <div style={{ flex: 1, minWidth: 320, display: 'flex', gap: 12 }}>
            {/* Left: targets list + mini preview */}
            <div style={{ width: 260 }}>
              <label style={{ display: 'block', fontWeight: 600, marginBottom: 6 }}>Selected targets</label>
              <div style={{ border: '1px solid #eee', borderRadius: 8, overflow: 'hidden' }}>
                {(() => {
                  const res = parseConfigSafe();
                  const cfg = res.ok ? res.data : {};
                  const keys = Object.keys(cfg || {});
                  if (keys.length === 0) return <div style={{ padding: 8, color: '#666' }}>No targets yet</div>;
                  return (
                    <div>
                      {keys.map((t) => (
                        <div key={t} style={{ borderBottom: '1px solid #f5f5f5', padding: 8, background: activeTarget === t ? '#eef6ff' : '#fff', cursor: 'pointer' }} onClick={() => setActiveTarget(t)}>
                          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div style={{ fontWeight: 600 }}>{t}</div>
                            <div style={{ display: 'flex', gap: 6 }}>
                              <button onClick={(e) => { e.stopPropagation(); setActiveTarget(t); }} style={{ fontSize: 12 }}>Edit rules</button>
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  updateConfig((c) => { delete c[t]; });
                                  if (activeTarget === t) {
                                    const rest = keys.filter((k) => k !== t);
                                    setActiveTarget(rest[0] || null);
                                  }
                                }}
                                style={{ fontSize: 12, color: '#8a1f1f' }}
                              >
                                Remove
                              </button>
                            </div>
                          </div>
                          <div style={{ color: '#555', fontSize: 12, marginTop: 4 }}>{targetBadge(cfg, t)}</div>
                        </div>
                      ))}
                    </div>
                  );
                })()}
              </div>
              {/* Simple mini preview of active target values (from last preview) */}
              {activeTarget && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontWeight: 600, marginBottom: 4 }}>Values: {activeTarget}</div>
                  <div style={{ border: '1px solid #eee', borderRadius: 8, padding: 6, maxHeight: 160, overflow: 'auto', background: '#fafafa' }}>
                    {valuesLoading[activeTarget] ? (
                      <div style={{ fontSize: 12, color: '#555' }}>Loading…</div>
                    ) : (valuesCache[activeTarget]?.length ? (
                      valuesCache[activeTarget].slice(0, 50).map((v, i) => (
                        <div key={i} style={{ fontSize: 12, borderBottom: '1px dashed #eee', padding: '2px 0' }}>{String(v)}</div>
                      ))
                    ) : (
                      <button onClick={() => fetchValuesForColumn(activeTarget)} disabled={!uploadId}>Load values</button>
                    ))}
                  </div>
                </div>
              )}
              {/* Add target */}
              <div style={{ marginTop: 8 }}>
                <label style={{ display: 'block', fontWeight: 600, marginBottom: 4 }}>Add target</label>
                {(() => {
                  const res = parseConfigSafe();
                  const cfg = res.ok ? res.data : {};
                  const existing = new Set(Object.keys(cfg || {}));
                  const options = (columns || []).filter((c) => !existing.has(c));
                  if (options.length === 0) return <div style={{ fontSize: 12, color: '#666' }}>All columns already added</div>;
                  return (
                    <select defaultValue="" onChange={(e) => {
                      const col = (e.target as HTMLSelectElement).value;
                      if (!col) return;
                      updateConfig((c) => { ensureTargetDefaults(c, col); });
                      setActiveTarget(col);
                      (e.target as HTMLSelectElement).value = '';
                    }} style={{ width: '100%' }}>
                      <option value="">-- choose column --</option>
                      {options.map((c) => (<option key={c} value={c}>{c}</option>))}
                    </select>
                  );
                })()}
              </div>
            </div>
            {/* Right: side panel for active target */}
            <div style={{ flex: 1 }}>
              {!activeTarget && (
                <div style={{ color: '#666' }}>Pick a target from the left to edit rules.</div>
              )}
              {activeTarget && (() => {
                const res = parseConfigSafe();
                if (!res.ok) return <div style={{ color: '#8a1f1f' }}>Invalid JSON: {res.err}</div>;
                const cfg = res.data;
                ensureTargetDefaults(cfg, activeTarget);
                const tcfg = cfg[activeTarget];
                const toggle = (key: keyof typeof panelOpen) => setPanelOpen((p) => ({ ...p, [key]: !p[key] }));

                return (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {/* AI prompt */}
                    <div style={{ border: '1px solid #eee', borderRadius: 8 }}>
                      <div style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggle('ai')}>
                        <div style={{ fontWeight: 600 }}>AI prompt</div>
                        <div>{panelOpen.ai ? '▾' : '▸'}</div>
                      </div>
                      {panelOpen.ai && (
                        <div style={{ padding: 8, borderTop: '1px solid #f5f5f5' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="checkbox" checked={!!tcfg.ai} onChange={(e) => { const on = (e.target as HTMLInputElement).checked; setPanelOpen((p)=>({...p, ai:true})); updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].ai = on; }); }} />
                            Enable AI rule
                          </label>
                          <div style={{ marginTop: 6 }}>
                            <textarea
                              value={tcfg.prompt || ''}
                              onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].prompt = (e.target as HTMLTextAreaElement).value; })}
                              rows={4}
                              placeholder="Write a check for the field. Supports {Field_Name}, {Field_Value}, {Normalized_Column_Name}"
                              style={{ width: '100%' }}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Word count */}
                    <div style={{ border: '1px solid #eee', borderRadius: 8 }}>
                      <div style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggle('wc')}>
                        <div style={{ fontWeight: 600 }}>Word count</div>
                        <div>{panelOpen.wc ? '▾' : '▸'}</div>
                      </div>
                      {panelOpen.wc && (
                        <div style={{ padding: 8, borderTop: '1px solid #f5f5f5' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="checkbox" checked={!!tcfg.wc} onChange={(e) => { const on = (e.target as HTMLInputElement).checked; setPanelOpen((p)=>({...p, wc:true})); updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].wc = on; }); }} />
                            Enable word count
                          </label>
                          <div style={{ marginTop: 6 }}>
                            <input type="range" min={1} max={20} value={Number(tcfg.wc_min ?? 3)} onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].wc_min = Math.max(1, Math.min(20, Number((e.target as HTMLInputElement).value) || 1)); })} />
                            <div style={{ fontSize: 12, color: '#555' }}>Minimum words: <strong>{Number(tcfg.wc_min ?? 3)}</strong></div>
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Keyword flag */}
                    <div style={{ border: '1px solid #eee', borderRadius: 8 }}>
                      <div style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggle('kw')}>
                        <div style={{ fontWeight: 600 }}>Keyword flag</div>
                        <div>{panelOpen.kw ? '▾' : '▸'}</div>
                      </div>
                      {panelOpen.kw && (
                        <div style={{ padding: 8, borderTop: '1px solid #f5f5f5' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="checkbox" checked={!!tcfg.kw_flag?.enabled} onChange={(e) => { const on = (e.target as HTMLInputElement).checked; setPanelOpen((p)=>({...p, kw:true})); updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].kw_flag.enabled = on; }); }} />
                            Enable keyword flag
                          </label>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                            <label>Mode</label>
                            <select value={tcfg.kw_flag?.mode || 'ANY'} onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].kw_flag.mode = ((e.target as HTMLSelectElement).value === 'ALL') ? 'ALL' : 'ANY'; })}>
                              <option value="ANY">ANY</option>
                              <option value="ALL">ALL</option>
                            </select>
                          </div>
                          <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input type="checkbox" checked={!!tcfg.kw_flag?.case_sensitive} onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].kw_flag.case_sensitive = (e.target as HTMLInputElement).checked; })} />
                              Match case
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <input type="checkbox" checked={!!tcfg.kw_flag?.whole_word} onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].kw_flag.whole_word = (e.target as HTMLInputElement).checked; })} />
                              Match whole word
                            </label>
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <KeywordEditor
                              phrases={Array.isArray(tcfg.kw_flag?.phrases) ? tcfg.kw_flag.phrases : []}
                              onAdd={(p) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const arr = Array.isArray(c[activeTarget].kw_flag.phrases) ? c[activeTarget].kw_flag.phrases : []; if (p.trim() && !arr.includes(p.trim())) { arr.push(p.trim()); } })}
                              onRemove={(p) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].kw_flag.phrases = (c[activeTarget].kw_flag.phrases || []).filter((x: string) => x !== p); })}
                            />
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Value filters */}
                    <div style={{ border: '1px solid #eee', borderRadius: 8 }}>
                      <div style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggle('vf')}>
                        <div style={{ fontWeight: 600 }}>Value filters</div>
                        <div>{panelOpen.vf ? '▾' : '▸'}</div>
                      </div>
                      {panelOpen.vf && (
                        <div style={{ padding: 8, borderTop: '1px solid #f5f5f5' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="checkbox" checked={!!tcfg.vf_on} onChange={(e) => { const on = (e.target as HTMLInputElement).checked; setPanelOpen((p)=>({...p, vf:true})); updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].vf_on = on; }); }} />
                            Enable value filters
                          </label>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                            <label>Combine across columns</label>
                            <select value={tcfg.filter_mode || 'AND'} onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].filter_mode = ((e.target as HTMLSelectElement).value === 'OR') ? 'OR' : 'AND'; })}>
                              <option value="AND">AND</option>
                              <option value="OR">OR</option>
                            </select>
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <label>Add column</label>
                            <select defaultValue="" onChange={async (e) => {
                              const col = (e.target as HTMLSelectElement).value;
                              if (!col) return;
                              await fetchValuesForColumn(col);
                              setVfExpander((p) => ({ ...p, [col]: true }));
                              updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const f = c[activeTarget].filters || {}; if (!f[col]) f[col] = []; c[activeTarget].filters = f; });
                              (e.target as HTMLSelectElement).value = '';
                            }}>
                              <option value="">-- choose column --</option>
                              {columns.map((c) => (<option key={c} value={c}>{c}</option>))}
                            </select>
                          </div>
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {Object.keys(tcfg.filters || {}).map((col) => (
                              <div key={col} style={{ border: '1px dashed #ddd', borderRadius: 6 }}>
                                <div style={{ padding: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={async () => { if (!valuesCache[col]) await fetchValuesForColumn(col); setVfExpander((p) => ({ ...p, [col]: !p[col] })); }}>
                                  <div style={{ fontWeight: 600 }}>{col}</div>
                                  <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                    <span style={{ fontSize: 12, color: '#555' }}>{(tcfg.filters?.[col] || []).length} selected</span>
                                    <button onClick={(e) => { e.stopPropagation(); updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const f = c[activeTarget].filters || {}; delete f[col]; c[activeTarget].filters = f; }); }}>Remove</button>
                                    <span>{vfExpander[col] ? '▾' : '▸'}</span>
                                  </div>
                                </div>
                                {vfExpander[col] && (
                                  <div style={{ padding: 8, borderTop: '1px dashed #eee', maxHeight: 180, overflow: 'auto', background: '#fafafa' }}>
                                    {(valuesCache[col] || []).map((v) => {
                                      const checked = (tcfg.filters?.[col] || []).includes(v);
                                      return (
                                        <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                                          <input type="checkbox" checked={checked} onChange={(e) => updateConfig((c) => {
                                            ensureTargetDefaults(c, activeTarget);
                                            const arr = Array.isArray(c[activeTarget].filters?.[col]) ? c[activeTarget].filters[col] : [];
                                            if ((e.target as HTMLInputElement).checked) {
                                              if (!arr.includes(v)) arr.push(v);
                                            } else {
                                              c[activeTarget].filters[col] = arr.filter((x: string) => x !== v);
                                            }
                                            const f = c[activeTarget].filters || {};
                                            f[col] = Array.from(new Set(f[col] || []));
                                            c[activeTarget].filters = f;
                                          })} />
                                          <span>{String(v)}</span>
                                        </label>
                                      );
                                    })}
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>

                    {/* Text filters */}
                    <div style={{ border: '1px solid #eee', borderRadius: 8 }}>
                      <div style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => toggle('tf')}>
                        <div style={{ fontWeight: 600 }}>Text filters</div>
                        <div>{panelOpen.tf ? '▾' : '▸'}</div>
                      </div>
                      {panelOpen.tf && (
                        <div style={{ padding: 8, borderTop: '1px solid #f5f5f5' }}>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <input type="checkbox" checked={!!tcfg.tf_on} onChange={(e) => { const on = (e.target as HTMLInputElement).checked; setPanelOpen((p)=>({...p, tf:true})); updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].tf_on = on; }); }} />
                            Enable text filters
                          </label>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                            <label>Combine across columns</label>
                            <select value={tcfg.filter_mode || 'AND'} onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); c[activeTarget].filter_mode = ((e.target as HTMLSelectElement).value === 'OR') ? 'OR' : 'AND'; })}>
                              <option value="AND">AND</option>
                              <option value="OR">OR</option>
                            </select>
                          </div>
                          <div style={{ marginTop: 8 }}>
                            <label>Add column</label>
                            <select defaultValue="" onChange={(e) => {
                              const col = (e.target as HTMLSelectElement).value;
                              if (!col) return;
                              setTfExpander((p) => ({ ...p, [col]: true }));
                              updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const tf = c[activeTarget].text_filters || {}; if (!tf[col]) tf[col] = { mode: 'ANY', phrases: [], include: true }; c[activeTarget].text_filters = tf; });
                              (e.target as HTMLSelectElement).value = '';
                            }}>
                              <option value="">-- choose column --</option>
                              {columns.map((c) => (<option key={c} value={c}>{c}</option>))}
                            </select>
                          </div>
                          <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {Object.keys(tcfg.text_filters || {}).map((col) => {
                              const row = tcfg.text_filters[col] || { mode: 'ANY', phrases: [], include: true };
                              const phrases = Array.isArray(row.phrases) ? row.phrases : [];
                              return (
                                <div key={col} style={{ border: '1px dashed #ddd', borderRadius: 6 }}>
                                  <div style={{ padding: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setTfExpander((p) => ({ ...p, [col]: !p[col] }))}>
                                    <div style={{ fontWeight: 600 }}>{col}</div>
                                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                      <span style={{ fontSize: 12, color: '#555' }}>{phrases.length} phrases</span>
                                      <button onClick={(e) => { e.stopPropagation(); updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const tf = c[activeTarget].text_filters || {}; delete tf[col]; c[activeTarget].text_filters = tf; }); }}>Remove</button>
                                      <span>{tfExpander[col] ? '▾' : '▸'}</span>
                                    </div>
                                  </div>
                                  {tfExpander[col] && (
                                    <div style={{ padding: 8, borderTop: '1px dashed #eee', background: '#fafafa' }}>
                                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <input type="checkbox" checked={!!row.include} onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const tf = c[activeTarget].text_filters || {}; const r = tf[col] || { mode: 'ANY', phrases: [], include: true }; r.include = (e.target as HTMLInputElement).checked; tf[col] = r; c[activeTarget].text_filters = tf; })} />
                                          Include (unchecked = exclude)
                                        </label>
                                        <label>Mode</label>
                                        <select value={row.mode || 'ANY'} onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const tf = c[activeTarget].text_filters || {}; const r = tf[col] || { mode: 'ANY', phrases: [], include: true }; r.mode = ((e.target as HTMLSelectElement).value === 'ALL') ? 'ALL' : 'ANY'; tf[col] = r; c[activeTarget].text_filters = tf; })}>
                                          <option value="ANY">ANY</option>
                                          <option value="ALL">ALL</option>
                                        </select>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <input type="checkbox" checked={!!row.case_sensitive} onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const tf = c[activeTarget].text_filters || {}; const r = tf[col] || { mode: 'ANY', phrases: [], include: true }; r.case_sensitive = (e.target as HTMLInputElement).checked; tf[col] = r; c[activeTarget].text_filters = tf; })} />
                                          Match case
                                        </label>
                                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                          <input type="checkbox" checked={!!row.whole_word} onChange={(e) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const tf = c[activeTarget].text_filters || {}; const r = tf[col] || { mode: 'ANY', phrases: [], include: true }; r.whole_word = (e.target as HTMLInputElement).checked; tf[col] = r; c[activeTarget].text_filters = tf; })} />
                                          Match whole word
                                        </label>
                                      </div>
                                      <div style={{ marginTop: 8 }}>
                                        <KeywordEditor
                                          phrases={phrases}
                                          onAdd={(p) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const tf = c[activeTarget].text_filters || {}; const r = tf[col] || { mode: 'ANY', phrases: [], include: true }; if (p.trim() && !r.phrases.includes(p.trim())) r.phrases.push(p.trim()); tf[col] = r; c[activeTarget].text_filters = tf; })}
                                          onRemove={(p) => updateConfig((c) => { ensureTargetDefaults(c, activeTarget); const tf = c[activeTarget].text_filters || {}; const r = tf[col] || { mode: 'ANY', phrases: [], include: true }; r.phrases = (r.phrases || []).filter((x: string) => x !== p); tf[col] = r; c[activeTarget].text_filters = tf; })}
                                        />
                                        {(!phrases || phrases.length === 0) && (
                                          <div style={{ color: '#8a1f1f', fontSize: 12, marginTop: 6 }}>Add phrases for this column or remove the column from text filters.</div>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })()}
            </div>
          </div>
          )}
          {/* Keep the raw JSON editor visible for now (developer aid) */}
          {mode === 'builder' && (
            <div style={{ marginTop: 10, width: '100%' }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 6 }}>targets_config (JSON)</label>
              <textarea
                value={configText}
                onChange={(e) => {
                  const v = (e.target as HTMLTextAreaElement).value;
                  setConfigText(v);
                  try {
                    const parsed = JSON.parse(v || '{}');
                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                      throw new Error('targets_config must be a JSON object');
                    }
                    const isEmpty = Object.keys(parsed).length === 0;
                    setConfigEmpty(isEmpty);
                    setConfigError(isEmpty ? 'targets_config cannot be empty' : null);
                  } catch (err: any) {
                    setConfigEmpty(true);
                    setConfigError(err?.message || 'Invalid targets_config JSON');
                  }
                }}
                rows={14}
                style={{ width: "100%", fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}
                placeholder={'{ "ColumnName": { "wc": true } }'}
              />
              {configError ? (
                <div style={{ color: '#8a1f1f', marginTop: 6 }}>Warning: {configError}</div>
              ) : (
                <div style={{ color: '#05620e', marginTop: 6 }}>JSON looks valid</div>
              )}
            </div>
          )}
        </div>
        <input
          type="file"
          accept=".xlsx"
          onChange={(e) => setFile(e.target.files?.[0] || null)}
        />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8 }}>
          <button onClick={handlePreview} disabled={!uploadId || previewBusy || !!configError || configEmpty}>
            {previewBusy ? "Previewing..." : `Preview (top ${previewLimit})`}
          </button>
          <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <span style={{ color: '#555' }}>Size</span>
            <select value={String(previewLimit)} onChange={(e) => setPreviewLimit(Math.max(1, Number((e.target as HTMLSelectElement).value) || 10))}>
              <option value="5">5</option>
              <option value="10">10</option>
              <option value="20">20</option>
            </select>
          </label>
          {preview && (
            <span>
              Kept {preview.rows_kept} of {preview.rows_total} rows
            </span>
          )}
        </div>
        {preview && (
          <div style={{ marginBottom: 12 }}>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>Per-target counts</div>
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
          {busy === "upload" ? "Uploading..." : "Upload"}
        </button>
        {uploadId && (
          <p style={{ marginTop: 8 }}>
            Uploaded: <code>{uploadId}</code>
          </p>
        )}
      </section>

      {/* Step 2: Create Job */}
      <section style={{ marginTop: "1rem", padding: "1rem", border: "1px solid #eee", borderRadius: 10 }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Step 2 - Create Job
        </h2>
        <button
          onClick={handleJob}
          disabled={!uploadId || busy === "job" || !!configError}
          >
          {busy === "job" ? "Creating..." : "Create Job"}
        </button>
        {jobId && (
          <p style={{ marginTop: 8 }}>
            Job ID: <code>{jobId}</code>
          </p>
        )}
      </section>

      {/* Step 3: Status + Download */}
      <section style={{ marginTop: "1rem", padding: "1rem", border: "1px solid #eee", borderRadius: 10 }}>
        <h2 style={{ fontSize: "1.1rem", fontWeight: 600, marginBottom: "0.75rem" }}>
          Step 3 - Status
        </h2>

        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button onClick={manualPoll} disabled={!jobId || busy === "poll"}>
            {busy === "poll" ? "Polling..." : "Poll Now"}
          </button>
          {status?.progress !== undefined && (
            <span>Progress: {Math.min(100, Math.max(0, Number(status.progress) || 0))}%</span>
          )}
          {status?.status && (
            <span>
              Status: <span style={{ background: statusBg, color: statusFg, padding: '2px 8px', borderRadius: 12, border: '1px solid #ddd' }}>{status.status}</span>
            </span>
          )}
        </div>

        {status && (
          <pre style={{ marginTop: 10, background: "#fafafa", padding: 10, borderRadius: 8, border: "1px solid #eee" }}>
            {JSON.stringify(status, null, 2)}
          </pre>
        )}
        {status?.error && (
          <div style={{ background: '#ffe9e9', border: '1px solid #f5b5b5', padding: '0.75rem 1rem', borderRadius: 8, marginTop: 8, color: '#8a1f1f' }}>
            {String(status.error)}
          </div>
        )}

        {/* Download */}
        {downloadUrl && (
          <div style={{ marginTop: 12 }}>
            <a href={downloadUrl} download="mistakes_only.xlsx">
              Download Result
            </a>
          </div>
        )}
      </section>
    </main>
  );
}

