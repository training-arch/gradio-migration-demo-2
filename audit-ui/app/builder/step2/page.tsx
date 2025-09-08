"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import axios from "axios";

type PreviewRes = {
  rows_total: number;
  rows_kept: number;
  per_target_counts: Record<string, number>;
  sample_rows: any[];
};

function Stepper({ active }: { active: 1 | 2 | 3 }) {
  const base = { padding: '4px 10px', borderRadius: 6, border: '1px solid #ddd', background: '#f7f7f7', fontWeight: 500 as const };
  const activeStyle = { ...base, background: '#eef6ff', fontWeight: 700 as const };
  const disabled = { ...base, opacity: 0.5, cursor: 'not-allowed' as const };
  return (
    <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 10 }}>
      <div style={active === 1 ? activeStyle : base}>Step 1</div>
      <div style={active === 2 ? activeStyle : base}>Step 2</div>
      <div style={active === 3 ? activeStyle : disabled}>Step 3</div>
    </div>
  );
}

function KeywordEditor({ phrases, onAdd, onRemove }: { phrases: string[]; onAdd: (p: string) => void; onRemove: (p: string) => void }) {
  const [text, setText] = useState("");
  return (
    <div>
      <div style={{ display: 'flex', gap: 8 }}>
        <input value={text} onChange={(e) => setText((e.target as HTMLInputElement).value)} placeholder="Add phrase" onKeyDown={(e) => { if (e.key === 'Enter') { const v = text.trim(); if (v) { onAdd(v); setText(''); } } }} style={{ flex: 1 }} />
        <button onClick={() => { const v = text.trim(); if (v) { onAdd(v); setText(''); } }}>Add</button>
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

const defaultTarget = () => ({
  ai: false,
  prompt: "",
  wc: false,
  wc_min: 7,
  kw_flag: { enabled: false, mode: 'ANY', phrases: [], case_sensitive: false, whole_word: false },
  vf_on: false,
  filters: {} as Record<string, string[]>,
  filter_mode: 'AND' as 'AND' | 'OR',
  tf_on: false,
  text_filters: {} as Record<string, { mode: 'ANY' | 'ALL'; phrases: string[]; include: boolean; case_sensitive?: boolean; whole_word?: boolean }>,
});

export default function BuilderStep2() {
  const sp = useSearchParams();
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  const [uploadId, setUploadId] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [cfg, setCfg] = useState<Record<string, any>>({});
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState({ ai: false, wc: false, kw: false, vf: false, tf: false });
  const [valuesCache, setValuesCache] = useState<Record<string, string[]>>({});
  const [valuesLoading, setValuesLoading] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<PreviewRes | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewLimit, setPreviewLimit] = useState(5);
  const [error, setError] = useState<string | null>(null);

  // Inbound state: uploadId, targets from sessionStorage
  useEffect(() => {
    const uid = sp.get('uploadId') || (typeof window !== 'undefined' ? sessionStorage.getItem('builder.uploadId') : null);
    const t = (typeof window !== 'undefined' ? sessionStorage.getItem('builder.selectedTargets') : null);
    setUploadId(uid);
    try { setTargets(t ? JSON.parse(t) : []); } catch { setTargets([]); }
  }, [sp]);

  // Initialize defaults when targets change
  useEffect(() => {
    if (!targets || targets.length === 0) return;
    setCfg((prev) => {
      const next: Record<string, any> = { ...prev };
      for (const t of targets) if (!next[t]) next[t] = defaultTarget();
      // remove stale targets
      Object.keys(next).forEach((k) => { if (!targets.includes(k)) delete next[k]; });
      return next;
    });
    if (!activeTarget) setActiveTarget(targets[0] || null);
  }, [targets]);

  // Load columns
  useEffect(() => {
    if (!uploadId) return;
    (async () => {
      try {
        const res = await axios.get(`${API}/uploads/${uploadId}/columns`);
        setColumns(res.data?.columns || []);
      } catch (e) { setError('Failed to load columns'); }
    })();
  }, [API, uploadId]);

  const fetchValues = async (col: string) => {
    if (!uploadId || !col) return;
    try {
      setValuesLoading((m) => ({ ...m, [col]: true }));
      const res = await axios.get(`${API}/uploads/${uploadId}/values`, { params: { column: col, limit: 200 } });
      setValuesCache((c) => ({ ...c, [col]: res.data?.values || [] }));
    } catch (e) { setError(`Failed to load values for ${col}`); }
    finally { setValuesLoading((m) => ({ ...m, [col]: false })); }
  };

  const targetBadge = (t: string) => {
    const c = cfg[t] || {};
    const ai = c.ai ? 'AI ON' : 'AI OFF';
    const wc = c.wc ? `WC ${c.wc_min ?? 7}` : 'WC OFF';
    const kwCount = (c.kw_flag?.enabled && Array.isArray(c.kw_flag?.phrases)) ? c.kw_flag.phrases.length : 0;
    const kw = c.kw_flag?.enabled ? `KW ${kwCount}` : 'KW OFF';
    const vf = c.vf_on ? `Filters ${Object.keys(c.filters || {}).length}` : 'Filters OFF';
    const mode = (c.filter_mode === 'OR') ? 'Mode OR' : 'Mode AND';
    return `${ai} | ${wc} | ${kw} | ${vf} | ${mode}`;
  };

  const handlePreview = async () => {
    if (!uploadId) return;
    setPreview(null); setPreviewBusy(true); setError(null);
    try {
      const res = await axios.get(`${API}/uploads/${uploadId}/preview`, {
        params: { targets_config: JSON.stringify(cfg), limit: previewLimit },
      });
      setPreview(res.data as PreviewRes);
    } catch (e: any) { setError(e?.response?.data?.detail || e?.message || 'Preview failed'); }
    finally { setPreviewBusy(false); }
  };

  const updateCfg = (updater: (c: Record<string, any>) => void) => {
    setCfg((prev) => { const next = { ...prev }; updater(next); return next; });
  };

  return (
    <main style={{ padding: '2rem', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Edit rules</h1>
      <Stepper active={2} />

      {(!uploadId || targets.length === 0) && (
        <div style={{ background: '#fff6e6', border: '1px solid #ffd591', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: 12, color: '#8a5a00' }}>
          Missing upload or selected targets. <Link href="/builder" style={{ textDecoration: 'underline' }}>Back to Step 1</Link>
        </div>
      )}
      {error && (
        <div style={{ background: '#ffe9e9', border: '1px solid #f5b5b5', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: 12, color: '#8a1f1f' }}>{error}</div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16 }}>
        {/* Left: targets with previews */}
        <div>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <button onClick={handlePreview} disabled={!uploadId || previewBusy}>
              {previewBusy ? 'Previewing…' : `Preview (top ${previewLimit})`}
            </button>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              Size
              <select value={String(previewLimit)} onChange={(e) => setPreviewLimit(Math.max(1, Number((e.target as HTMLSelectElement).value) || 5))}>
                <option value="5">5</option>
                <option value="10">10</option>
                <option value="20">20</option>
              </select>
            </label>
            {preview && (<span>Kept {preview.rows_kept} of {preview.rows_total}</span>)}
          </div>

          {(targets || []).map((t) => (
            <div key={t} style={{ border: '1px solid #eee', borderRadius: 10, padding: 12, marginBottom: 12 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>{t}</div>
                <button onClick={() => setActiveTarget(t)} style={{ background: '#555', color: '#fff', padding: '4px 8px', borderRadius: 4 }}>Edit rules</button>
              </div>
              <div style={{ color: '#666', fontSize: 12, margin: '6px 0 8px' }}>Preview of {previewLimit} rows</div>
              <div style={{ border: '1px solid #ddd', borderRadius: 6, overflow: 'hidden' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                  <tbody>
                    {(() => {
                      // Prefer preview sample rows; fallback to distinct values
                      const rows = (preview?.sample_rows || []).slice(0, previewLimit);
                      if (rows.length > 0) {
                        return rows.map((r, i) => (
                          <tr key={i}><td style={{ padding: 6, borderBottom: '1px solid #f2f2f2' }}>{String(r[t] ?? '')}</td></tr>
                        ));
                      }
                      const vals = valuesCache[t] || [];
                      if (!vals.length && !valuesLoading[t]) fetchValues(t);
                      if (valuesLoading[t]) return (<tr><td style={{ padding: 6 }}>Loading…</td></tr>);
                      if (!vals.length) return (<tr><td style={{ padding: 6, color: '#666' }}>No values available</td></tr>);
                      return vals.slice(0, previewLimit).map((v, i) => (<tr key={i}><td style={{ padding: 6, borderBottom: '1px solid #f2f2f2' }}>{String(v)}</td></tr>));
                    })()}
                  </tbody>
                </table>
              </div>
              <div style={{ color: '#555', fontSize: 12, marginTop: 6 }}>{targetBadge(t)}</div>
            </div>
          ))}

          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <button disabled style={{ background: '#dbe7ec', padding: '10px 16px', borderRadius: 6, minWidth: 220, cursor: 'not-allowed' }}>Go to Step 3 →</button>
          </div>
        </div>

        {/* Right: side panel */}
        <div style={{ borderLeft: '2px solid #ddd', paddingLeft: 12 }}>
          {!activeTarget && <div style={{ color: '#666' }}>Choose a target on the left and click “Edit rules”.</div>}
          {activeTarget && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 6 }}>Audit for {activeTarget}</div>
              <div style={{ fontSize: 12, color: '#333', marginBottom: 8 }}>{targetBadge(activeTarget)}</div>

              {/* AI prompt */}
              <div style={{ border: '1px solid #eee', borderRadius: 8, marginBottom: 10 }}>
                <div style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setPanelOpen((p)=>({...p, ai: !p.ai}))}>
                  <div>AI prompt</div>
                  <div>▾</div>
                </div>
                <div style={{ padding: 8, borderTop: '1px solid #f5f5f5' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={!!cfg[activeTarget]?.ai} onChange={(e) => updateCfg((c) => { c[activeTarget].ai = (e.target as HTMLInputElement).checked; })} /> Enable
                  </label>
                  {panelOpen.ai && (
                    <textarea rows={4} placeholder="Prompt template" value={cfg[activeTarget]?.prompt || ''} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].prompt = (e.target as HTMLTextAreaElement).value; })} style={{ width: '100%', marginTop: 6 }} />
                  )}
                </div>
              </div>

              {/* Word count */}
              <div style={{ border: '1px solid #eee', borderRadius: 8, marginBottom: 10 }}>
                <div style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setPanelOpen((p)=>({...p, wc: !p.wc}))}>
                  <div>Word count rule</div>
                  <div>▾</div>
                </div>
                <div style={{ padding: 8, borderTop: '1px solid #f5f5f5' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={!!cfg[activeTarget]?.wc} onChange={(e) => updateCfg((c) => { c[activeTarget].wc = (e.target as HTMLInputElement).checked; })} /> Enable
                  </label>
                  {panelOpen.wc && (
                    <div style={{ marginTop: 6 }}>
                      <input type="range" min={1} max={20} value={Number(cfg[activeTarget]?.wc_min ?? 7)} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].wc_min = Math.max(1, Math.min(20, Number((e.target as HTMLInputElement).value) || 7)); })} />
                      <div style={{ fontSize: 12, color: '#555' }}>Minimum words: <strong>{Number(cfg[activeTarget]?.wc_min ?? 7)}</strong></div>
                    </div>
                  )}
                </div>
              </div>

              {/* Keyword flag */}
              <div style={{ border: '1px solid #eee', borderRadius: 8, marginBottom: 10 }}>
                <div style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setPanelOpen((p)=>({...p, kw: !p.kw}))}>
                  <div>Keyword flag</div>
                  <div>▾</div>
                </div>
                <div style={{ padding: 8, borderTop: '1px solid #f5f5f5' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={!!cfg[activeTarget]?.kw_flag?.enabled} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].kw_flag.enabled = (e.target as HTMLInputElement).checked; })} /> Enable
                  </label>
                  {panelOpen.kw && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 6 }}>
                        <label>Mode</label>
                        <select value={cfg[activeTarget]?.kw_flag?.mode || 'ANY'} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].kw_flag.mode = ((e.target as HTMLSelectElement).value === 'ALL') ? 'ALL' : 'ANY'; })}>
                          <option value="ANY">ANY</option>
                          <option value="ALL">ALL</option>
                        </select>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Case-sensitive matching">
                          <input type="checkbox" checked={!!cfg[activeTarget]?.kw_flag?.case_sensitive} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].kw_flag.case_sensitive = (e.target as HTMLInputElement).checked; })} /> Match case
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }} title="Word boundary matching">
                          <input type="checkbox" checked={!!cfg[activeTarget]?.kw_flag?.whole_word} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].kw_flag.whole_word = (e.target as HTMLInputElement).checked; })} /> Match whole word
                        </label>
                      </div>
                      <KeywordEditor
                        phrases={Array.isArray(cfg[activeTarget]?.kw_flag?.phrases) ? cfg[activeTarget].kw_flag.phrases : []}
                        onAdd={(p)=>updateCfg((c)=>{ const arr = Array.isArray(c[activeTarget].kw_flag.phrases) ? c[activeTarget].kw_flag.phrases : []; if (p.trim() && !arr.includes(p.trim())) arr.push(p.trim()); })}
                        onRemove={(p)=>updateCfg((c)=>{ c[activeTarget].kw_flag.phrases = (c[activeTarget].kw_flag.phrases || []).filter((x: string)=>x!==p); })}
                      />
                    </div>
                  )}
                </div>
              </div>

              {/* Filters (value only for now) */}
              <div style={{ border: '1px solid #eee', borderRadius: 8, marginBottom: 10 }}>
                <div style={{ padding: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center', cursor: 'pointer' }} onClick={() => setPanelOpen((p)=>({...p, vf: !p.vf}))}>
                  <div>Filter</div>
                  <div>▾</div>
                </div>
                <div style={{ padding: 8, borderTop: '1px solid #f5f5f5' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <input type="checkbox" checked={!!cfg[activeTarget]?.vf_on} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].vf_on = (e.target as HTMLInputElement).checked; })} /> Enable
                  </label>
                  {panelOpen.vf && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <label>Combine across columns</label>
                        <select value={cfg[activeTarget]?.filter_mode || 'AND'} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].filter_mode = ((e.target as HTMLSelectElement).value === 'OR') ? 'OR' : 'AND'; })}>
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                        </select>
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <label>Add column</label>
                        <select defaultValue="" onChange={async (e) => {
                          const col = (e.target as HTMLSelectElement).value; if (!col) return;
                          await fetchValues(col);
                          updateCfg((c)=>{ const f = c[activeTarget].filters || {}; if (!f[col]) f[col] = []; c[activeTarget].filters = f; });
                          (e.target as HTMLSelectElement).value = '';
                        }}>
                          <option value="">-- choose column --</option>
                          {columns.map((c) => (<option key={c} value={c}>{c}</option>))}
                        </select>
                      </div>
                      <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {Object.keys(cfg[activeTarget]?.filters || {}).map((col) => (
                          <div key={col} style={{ border: '1px dashed #ddd', borderRadius: 6 }}>
                            <div style={{ padding: 6, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                              <div style={{ fontWeight: 600 }}>{col}</div>
                              <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span style={{ fontSize: 12, color: '#555' }}>{(cfg[activeTarget].filters[col] || []).length} selected</span>
                                <button onClick={() => updateCfg((c)=>{ const f = c[activeTarget].filters || {}; delete f[col]; c[activeTarget].filters = f; })}>Remove</button>
                              </div>
                            </div>
                            <div style={{ padding: 8, borderTop: '1px dashed #eee', maxHeight: 180, overflow: 'auto', background: '#fafafa' }}>
                              {(valuesCache[col] || []).map((v) => {
                                const checked = (cfg[activeTarget].filters[col] || []).includes(v);
                                return (
                                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                                    <input type="checkbox" checked={checked} onChange={(e)=>updateCfg((c)=>{
                                      const arr = Array.isArray(c[activeTarget].filters[col]) ? c[activeTarget].filters[col] : [];
                                      if ((e.target as HTMLInputElement).checked) { if (!arr.includes(v)) arr.push(v); }
                                      else { c[activeTarget].filters[col] = arr.filter((x: string)=>x!==v); }
                                      const f = c[activeTarget].filters || {}; f[col] = Array.from(new Set(f[col] || [])); c[activeTarget].filters = f;
                                    })} />
                                    <span>{String(v)}</span>
                                  </label>
                                );
                              })}
                              {valuesLoading[col] && (<div style={{ color: '#666' }}>Loading…</div>)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Link href="/builder" style={{ textDecoration: 'underline' }}>Back to Step 1</Link>
      </div>
    </main>
  );
}

