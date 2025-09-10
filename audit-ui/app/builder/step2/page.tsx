"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
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

function PreviewCell({ text }: { text: string }) {
  const [expanded, setExpanded] = useState(false);
  const [overflow, setOverflow] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (expanded) { setOverflow(true); return; }
    // Measure after paint
    const id = requestAnimationFrame(() => {
      try { setOverflow(el.scrollHeight > el.clientHeight + 1); } catch {}
    });
    return () => cancelAnimationFrame(id);
  }, [text, expanded]);

  const baseTextStyle: React.CSSProperties = {
    whiteSpace: 'pre-wrap',
    lineHeight: 1.5,
  };
  const clampStyle: React.CSSProperties = expanded
    ? {}
    : { maxHeight: '3.2em', overflow: 'hidden' };

  return (
    <div style={{ position: 'relative' }}>
      <div ref={ref} style={{ ...baseTextStyle, ...clampStyle }}>{text}</div>
      {!expanded && overflow && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, textAlign: 'right',
                       background: 'linear-gradient(180deg, rgba(255,255,255,0) 0%, #fff 40%)' }}>
          <button onClick={() => setExpanded(true)} style={{ border: 'none', background: 'none', color: '#0b66c3', cursor: 'pointer', fontSize: 12 }}>… see more</button>
        </div>
      )}
      {expanded && overflow && (
        <div style={{ textAlign: 'right', marginTop: 4 }}>
          <button onClick={() => setExpanded(false)} style={{ border: 'none', background: 'none', color: '#0b66c3', cursor: 'pointer', fontSize: 12 }}>see less</button>
        </div>
      )}
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
  const router = useRouter();
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  const [uploadId, setUploadId] = useState<string | null>(null);
  const [targets, setTargets] = useState<string[]>([]);
  const [columns, setColumns] = useState<string[]>([]);
  const [cfg, setCfg] = useState<Record<string, any>>({});
  const [activeTarget, setActiveTarget] = useState<string | null>(null);
  const [panelOpen, setPanelOpen] = useState({ ai: false, wc: false, kw: false, vf: false, tf: false });
  const [valuesCache, setValuesCache] = useState<Record<string, string[]>>({});
  const [valuesLoading, setValuesLoading] = useState<Record<string, boolean>>({});
  // Text Filters editing state
  const [tfCol, setTfCol] = useState<string>("");
  const [tfNew, setTfNew] = useState<string>("");
  const [preview, setPreview] = useState<PreviewRes | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewLimit, setPreviewLimit] = useState(5);
  const [error, setError] = useState<string | null>(null);
  // When AI is enabled for any target but its prompt is blank, disallow preview to enforce determinism
  const aiPromptMissing = useMemo(() => {
    try {
      return Object.keys(cfg || {}).some((t) => cfg[t]?.ai && !(String(cfg[t]?.prompt || '').trim()));
    } catch { return false; }
  }, [cfg]);
  // Utility to show available template variables in prompt
  const _normalizeVar = (s: string) => (s || '').replace(/\W+/g, '_').replace(/^_+|_+$/g, '');
  const variableHints = useMemo(() => {
    const base = ['{Field_Name}', '{Field_Value}'];
    const cols = (columns || []).map((c) => `{${_normalizeVar(c)}}`);
    return [...base, ...cols];
  }, [columns]);
  const [editingName, setEditingName] = useState<string | null>(null);
  const workspaceRef = useRef<HTMLDivElement | null>(null);
  const leftScrollRef = useRef<HTMLDivElement | null>(null);
  const [hydrated, setHydrated] = useState(false);

  // Inbound state: uploadId, targets, and any preloaded config from sessionStorage
  useEffect(() => {
    const uid = sp.get('uploadId') || (typeof window !== 'undefined' ? sessionStorage.getItem('builder.uploadId') : null);
    const t = (typeof window !== 'undefined' ? sessionStorage.getItem('builder.selectedTargets') : null);
    setUploadId(uid);
    try { setTargets(t ? JSON.parse(t) : []); } catch { setTargets([]); }
    try {
      const raw = typeof window !== 'undefined' ? sessionStorage.getItem('builder.targetsConfig') : null;
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') setCfg(parsed);
      }
      const nm = typeof window !== 'undefined' ? sessionStorage.getItem('builder.configName') : null;
      if (nm) setEditingName(nm);
    } catch {}
    setHydrated(true);
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

  // Auto-select an existing text-filter column when opening the Filters panel or when tf_on becomes true
  useEffect(() => {
    if (!activeTarget) return;
    const c = cfg[activeTarget] || {};
    const hasTf = !!c.tf_on;
    if (!panelOpen.vf && !hasTf) return;
    if (tfCol) return;
    const tf = c.text_filters || {};
    const keys = Object.keys(tf).filter((k) => Array.isArray(tf[k]?.phrases) && (tf[k]?.phrases || []).length > 0);
    if (keys.length > 0) setTfCol(keys[0]);
  }, [panelOpen.vf, cfg, activeTarget]);

  const targetBadge = (t: string) => {
    const c = cfg[t] || {};
    const ai = c.ai ? 'AI ON' : 'AI OFF';
    const wc = c.wc ? `WC ${c.wc_min ?? 7}` : 'WC OFF';
    const kwCount = (c.kw_flag?.enabled && Array.isArray(c.kw_flag?.phrases)) ? c.kw_flag.phrases.length : 0;
    const kw = c.kw_flag?.enabled ? `KW ${kwCount}` : 'KW OFF';
    const rawValueCount = Object.keys(c.filters || {}).filter((col) => Array.isArray((c.filters || {})[col]) && ((c.filters || {})[col] as any[]).length > 0).length;
    const rawTextCount = Object.keys(c.text_filters || {}).filter((col) => Array.isArray((c.text_filters || {})[col]?.phrases) && ((c.text_filters || {})[col]?.phrases || []).length > 0).length;
    const valueOn = !!c.vf_on && rawValueCount > 0;
    const textOn = !!c.tf_on && rawTextCount > 0;
    const vf = (valueOn || textOn)
      ? `Filters: Value ${valueOn ? `ON (${rawValueCount})` : 'OFF'} | Text ${textOn ? `ON (${rawTextCount})` : 'OFF'}`
      : 'Filters OFF';
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

  // Persist config for Step 3 (skip initial mount to avoid overwriting edited config)
  useEffect(() => {
    if (!hydrated) return;
    try { sessionStorage.setItem('builder.targetsConfig', JSON.stringify(cfg || {})); } catch {}
  }, [cfg, hydrated]);

  const canGoStep3 = useMemo(() => {
    return Boolean(uploadId && targets && targets.length > 0 && Object.keys(cfg || {}).length > 0);
  }, [uploadId, targets, cfg]);

  return (
    <main style={{ padding: '2rem', fontFamily: 'Inter, ui-sans-serif, system-ui, sans-serif', maxWidth: 1100, margin: '0 auto' }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 6 }}>Edit rules</h1>
      {editingName && (
        <div style={{ background: '#eef6ff', border: '1px solid #cfe3ea', padding: '0.5rem 0.75rem', borderRadius: 8, margin: '6px 0 10px', color: '#0b4e75' }}>
          Editing preset: <strong>{editingName}</strong>
        </div>
      )}
      <Stepper active={2} />

      {(!uploadId || targets.length === 0) && (
        <div style={{ background: '#fff6e6', border: '1px solid #ffd591', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: 12, color: '#8a5a00' }}>
          Missing upload or selected targets. <Link href="/builder" style={{ textDecoration: 'underline' }}>Back to Step 1</Link>
        </div>
      )}
      {error && (
        <div style={{ background: '#ffe9e9', border: '1px solid #f5b5b5', padding: '0.75rem 1rem', borderRadius: 8, marginBottom: 12, color: '#8a1f1f' }}>{error}</div>
      )}

      {/* Workspace: fixed height; only left column scrolls */}
      <div ref={workspaceRef} style={{ display: 'grid', gridTemplateColumns: '1fr 380px', gap: 16, height: 'calc(100vh - 180px)' }}>
        {/* Left: targets with previews (scrollable) */}
        <div ref={leftScrollRef} style={{ height: '100%', overflow: 'auto', paddingRight: 8 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 8 }}>
            <button onClick={handlePreview} disabled={!uploadId || previewBusy || aiPromptMissing}>
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
            {aiPromptMissing && (
              <span style={{ fontSize: 12, color: '#8a5a00', background: '#fff6e6', border: '1px solid #ffd591', padding: '4px 6px', borderRadius: 6 }}>
                AI is enabled for at least one target, but its prompt is empty.
              </span>
            )}
          </div>

          {(targets || []).map((t) => (
            <div key={t} id={`card-${t}`} style={{ border: '1px solid #eee', borderRadius: 10, padding: 12, marginBottom: 12, background: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ fontWeight: 700 }}>{t}</div>
                <button onClick={() => { setActiveTarget(t); try { document.getElementById(`card-${t}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {} }} style={{ background: '#555', color: '#fff', padding: '4px 8px', borderRadius: 4 }}>Edit rules</button>
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
                          <tr key={i}>
                            <td style={{ padding: 6, borderBottom: '1px solid #f2f2f2' }}>
                              <PreviewCell text={String(r[t] ?? '')} />
                            </td>
                          </tr>
                        ));
                      }
                      const vals = valuesCache[t] || [];
                      if (!vals.length && !valuesLoading[t]) fetchValues(t);
                      if (valuesLoading[t]) return (<tr><td style={{ padding: 6 }}>Loading…</td></tr>);
                      if (!vals.length) return (<tr><td style={{ padding: 6, color: '#666' }}>No values available</td></tr>);
                      return vals.slice(0, previewLimit).map((v, i) => (
                        <tr key={i}>
                          <td style={{ padding: 6, borderBottom: '1px solid #f2f2f2' }}>
                            <PreviewCell text={String(v)} />
                          </td>
                        </tr>
                      ));
                    })()}
                  </tbody>
                </table>
              </div>
              <div style={{ color: '#555', fontSize: 12, marginTop: 6 }}>{targetBadge(t)}</div>
            </div>
          ))}

          <div style={{ marginTop: 12, textAlign: 'right' }}>
            <button
              onClick={() => { if (canGoStep3 && uploadId) router.push(`/builder/step3?uploadId=${encodeURIComponent(uploadId)}`); }}
              disabled={!canGoStep3}
              style={{ background: canGoStep3 ? '#b9d6df' : '#dbe7ec', padding: '10px 16px', borderRadius: 6, minWidth: 220, cursor: canGoStep3 ? 'pointer' : 'not-allowed' }}
            >
              Go to Step 3 →
            </button>
          </div>
        </div>

        {/* Right: side panel (sticky) */}
        <div style={{ borderLeft: '2px solid #ddd', paddingLeft: 12, position: 'sticky', top: 0, alignSelf: 'start', maxHeight: '100%', overflow: 'auto' }}>
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
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 6 }}>
                      <textarea rows={4} placeholder="Prompt template (required when AI is enabled)" value={cfg[activeTarget]?.prompt || ''} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].prompt = (e.target as HTMLTextAreaElement).value; })} style={{ width: '100%' }} />
                      <div style={{ fontSize: 12, color: '#666' }}>
                        Available variables: {variableHints.join(', ')}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label>Source column</label>
                        <select value={cfg[activeTarget]?.ai_source_column || activeTarget} onChange={(e)=>updateCfg((c)=>{ const v = (e.target as HTMLSelectElement).value; c[activeTarget].ai_source_column = v === activeTarget ? undefined : v; })}>
                          {[activeTarget, ...columns.filter((c)=>c!==activeTarget)].map((cname) => (
                            <option key={cname} value={cname}>{cname}</option>
                          ))}
                        </select>
                        <span style={{ fontSize: 12, color: '#666' }}>(defaults to this target column)</span>
                        {cfg[activeTarget]?.ai_source_column && !columns.includes(cfg[activeTarget]?.ai_source_column) && (
                          <span style={{ fontSize: 12, color: '#8a1f1f' }}>Selected source column not found; will fallback to target.</span>
                        )}
                      </div>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                        <label>Model</label>
                        <input style={{ width: 180 }} placeholder="gpt-4o-mini" value={cfg[activeTarget]?.ai_model || ''} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].ai_model = (e.target as HTMLInputElement).value; })} />
                        <label>Max tokens</label>
                        <input type="number" min={16} max={512} style={{ width: 90 }} value={Number(cfg[activeTarget]?.ai_max_tokens ?? 80)} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].ai_max_tokens = Math.max(1, Math.min(1024, Number((e.target as HTMLInputElement).value) || 80)); })} />
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" checked={cfg[activeTarget]?.ai_cache !== false} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].ai_cache = (e.target as HTMLInputElement).checked; })} /> Use cache
                        </label>
                      </div>
                      {cfg[activeTarget]?.ai && !(cfg[activeTarget]?.prompt || '').trim() && (
                        <div style={{ fontSize: 12, color: '#8a5a00', background: '#fff6e6', border: '1px solid #ffd591', padding: '6px 8px', borderRadius: 6 }}>
                          Provide a prompt to run AI. Default prompt is not auto-used.
                        </div>
                      )}
                    </div>
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
                  {(() => {
                    const c = cfg[activeTarget] || {} as any;
                    const rawValueCount = Object.keys(c.filters || {}).filter((col: string) => Array.isArray((c.filters || {})[col]) && ((c.filters || {})[col] as any[]).length > 0).length;
                    const rawTextCount = Object.keys(c.text_filters || {}).filter((col: string) => Array.isArray((c.text_filters || {})[col]?.phrases) && ((c.text_filters || {})[col]?.phrases || []).length > 0).length;
                    const valueOn = !!c.vf_on && rawValueCount > 0;
                    const textOn = !!c.tf_on && rawTextCount > 0;
                    const mode = (c.filter_mode === 'OR') ? 'OR' : 'AND';
                    return (
                      <div style={{ fontSize: 12, color: '#555', marginBottom: 6 }}>
                        Filters: Value {valueOn ? `ON (${rawValueCount})` : 'OFF'} | Text {textOn ? `ON (${rawTextCount})` : 'OFF'} | Mode {mode}
                      </div>
                    );
                  })()}
                  {panelOpen.vf && (
                    <div style={{ marginTop: 6 }}>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 8 }}>
                        <label>Combine across columns</label>
                        <select value={cfg[activeTarget]?.filter_mode || 'AND'} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].filter_mode = ((e.target as HTMLSelectElement).value === 'OR') ? 'OR' : 'AND'; })}>
                          <option value="AND">AND</option>
                          <option value="OR">OR</option>
                        </select>
                      </div>
                      {/* Value Filters subsection */}
                      <div style={{ fontWeight: 600, margin: '10px 0 6px' }}>Value Filters (exact match)</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                        <input type="checkbox" checked={!!cfg[activeTarget]?.vf_on} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].vf_on = (e.target as HTMLInputElement).checked; })} /> Enable
                      </label>
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                        <label>Add column</label>
                        <select defaultValue="" disabled={!cfg[activeTarget]?.vf_on} onChange={async (e) => {
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
                                <button disabled={!cfg[activeTarget]?.vf_on} onClick={() => updateCfg((c)=>{ const f = c[activeTarget].filters || {}; delete f[col]; c[activeTarget].filters = f; if (Object.keys(f).length === 0) { c[activeTarget].vf_on = false; } })}>Remove</button>
                              </div>
                            </div>
                            <div style={{ padding: 8, borderTop: '1px dashed #eee', maxHeight: 180, overflow: 'auto', background: '#fafafa' }}>
                              {(valuesCache[col] || []).map((v) => {
                                const checked = (cfg[activeTarget].filters[col] || []).includes(v);
                                return (
                                  <label key={v} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '2px 0' }}>
                                    <input type="checkbox" disabled={!cfg[activeTarget]?.vf_on} checked={checked} onChange={(e)=>updateCfg((c)=>{
                                      const arr = Array.isArray(c[activeTarget].filters[col]) ? c[activeTarget].filters[col] : [];
                                      if ((e.target as HTMLInputElement).checked) { if (!arr.includes(v)) arr.push(v); }
                                      else { c[activeTarget].filters[col] = arr.filter((x: string)=>x!==v); }
                                      const f = c[activeTarget].filters || {}; f[col] = Array.from(new Set(f[col] || []));
                                      if (!f[col] || (Array.isArray(f[col]) && (f[col] as any[]).length === 0)) { delete f[col]; }
                                      c[activeTarget].filters = f; if (Object.keys(f).length === 0) { c[activeTarget].vf_on = false; }
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

                      {/* --- Text Filters subsection --- */}
                      <div style={{ fontWeight: 600, margin: '14px 0 6px' }}>Text Filters (contains phrases)</div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <input type="checkbox" checked={!!cfg[activeTarget]?.tf_on} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].tf_on = (e.target as HTMLInputElement).checked; })} /> Enable
                      </label>
                      {/* Row 1: Active column */}
                      <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 6 }}>
                        <label>Active column</label>
                        <select value={tfCol} disabled={!cfg[activeTarget]?.tf_on} onChange={(e)=>{ const v = (e.target as HTMLSelectElement).value; setTfCol(v); if (v) updateCfg((c)=>{ c[activeTarget].text_filters = c[activeTarget].text_filters || {}; c[activeTarget].text_filters[v] = c[activeTarget].text_filters[v] || { mode: 'ANY', phrases: [], include: true, case_sensitive: false, whole_word: false }; }); }}>
                          <option value="">-- choose column --</option>
                          {columns.map((c) => (<option key={c} value={c}>{c}</option>))}
                        </select>
                      </div>
                      {/* Row 2: Options */}
                      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', marginTop: 8 }}>
                        <label>Behavior</label>
                        <select disabled={!cfg[activeTarget]?.tf_on || !tfCol} value={(cfg[activeTarget]?.text_filters?.[tfCol]?.include ? 'Include' : 'Exclude')} onChange={(e)=>updateCfg((c)=>{ const inc = ((e.target as HTMLSelectElement).value === 'Include'); c[activeTarget].text_filters = c[activeTarget].text_filters || {}; const entry = c[activeTarget].text_filters[tfCol] || { mode: 'ANY', phrases: [], include: true, case_sensitive: false, whole_word: false }; entry.include = inc; c[activeTarget].text_filters[tfCol] = entry; })}>
                          <option value="Include">Include</option>
                          <option value="Exclude">Exclude</option>
                        </select>
                        <label>Match</label>
                        <select disabled={!cfg[activeTarget]?.tf_on || !tfCol} value={(cfg[activeTarget]?.text_filters?.[tfCol]?.mode || 'ANY')} onChange={(e)=>updateCfg((c)=>{ const mode = ((e.target as HTMLSelectElement).value === 'ALL') ? 'ALL' : 'ANY'; c[activeTarget].text_filters = c[activeTarget].text_filters || {}; const entry = c[activeTarget].text_filters[tfCol] || { mode: 'ANY', phrases: [], include: true, case_sensitive: false, whole_word: false }; entry.mode = mode; c[activeTarget].text_filters[tfCol] = entry; })}>
                          <option value="ANY">ANY</option>
                          <option value="ALL">ALL</option>
                        </select>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" disabled={!cfg[activeTarget]?.tf_on || !tfCol} checked={!!cfg[activeTarget]?.text_filters?.[tfCol]?.case_sensitive} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].text_filters = c[activeTarget].text_filters || {}; const entry = c[activeTarget].text_filters[tfCol] || { mode: 'ANY', phrases: [], include: true, case_sensitive: false, whole_word: false }; entry.case_sensitive = (e.target as HTMLInputElement).checked; c[activeTarget].text_filters[tfCol] = entry; })} /> Match case
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <input type="checkbox" disabled={!cfg[activeTarget]?.tf_on || !tfCol} checked={!!cfg[activeTarget]?.text_filters?.[tfCol]?.whole_word} onChange={(e)=>updateCfg((c)=>{ c[activeTarget].text_filters = c[activeTarget].text_filters || {}; const entry = c[activeTarget].text_filters[tfCol] || { mode: 'ANY', phrases: [], include: true, case_sensitive: false, whole_word: false }; entry.whole_word = (e.target as HTMLInputElement).checked; c[activeTarget].text_filters[tfCol] = entry; })} /> Match whole word
                        </label>
                      </div>
                      {tfCol && (
                        <div style={{ marginTop: 8, border: '1px dashed #ddd', borderRadius: 6 }}>
                          <div style={{ padding: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <input disabled={!cfg[activeTarget]?.tf_on} value={tfNew} onChange={(e)=>setTfNew((e.target as HTMLInputElement).value)} placeholder="Add phrase" onKeyDown={(e)=>{ if (e.key==='Enter') { const v = tfNew.trim(); if (v) { updateCfg((c)=>{ c[activeTarget].text_filters = c[activeTarget].text_filters || {}; const entry = c[activeTarget].text_filters[tfCol] || { mode: 'ANY', phrases: [], include: true, case_sensitive: false, whole_word: false }; const setp = new Set<string>(Array.isArray(entry.phrases) ? entry.phrases : []); setp.add(v); entry.phrases = Array.from(setp); c[activeTarget].text_filters[tfCol] = entry; }); setTfNew(''); } }} } style={{ flex: 1 }} />
                            <button disabled={!cfg[activeTarget]?.tf_on} onClick={()=>{ const v = tfNew.trim(); if (v) { updateCfg((c)=>{ c[activeTarget].text_filters = c[activeTarget].text_filters || {}; const entry = c[activeTarget].text_filters[tfCol] || { mode: 'ANY', phrases: [], include: true, case_sensitive: false, whole_word: false }; const setp = new Set<string>(Array.isArray(entry.phrases) ? entry.phrases : []); setp.add(v); entry.phrases = Array.from(setp); c[activeTarget].text_filters[tfCol] = entry; }); setTfNew(''); } }}>Add</button>
                            <button disabled={!cfg[activeTarget]?.tf_on} onClick={()=>{ updateCfg((c)=>{ if (c[activeTarget].text_filters) { delete c[activeTarget].text_filters[tfCol]; const entries = c[activeTarget].text_filters || {}; const hasAny = Object.keys(entries).some((k) => Array.isArray(entries[k]?.phrases) && (entries[k]?.phrases || []).length > 0); if (!hasAny) { c[activeTarget].tf_on = false; } } }); setTfCol(''); }}>Remove column</button>
                          </div>
                          <div style={{ padding: 8, borderTop: '1px dashed #eee', display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            {(cfg[activeTarget]?.text_filters?.[tfCol]?.phrases || []).map((p: string) => (
                              <span key={p} style={{ background: '#eef', border: '1px solid #dde', borderRadius: 12, padding: '2px 8px', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                                <span>{p}</span>
                                <button disabled={!cfg[activeTarget]?.tf_on} onClick={()=>updateCfg((c)=>{ const entry = c[activeTarget].text_filters?.[tfCol]; if (!entry) return; entry.phrases = (entry.phrases || []).filter((x: string) => x!==p); if (!entry.phrases.length) { delete c[activeTarget].text_filters[tfCol]; const entries = c[activeTarget].text_filters || {}; const hasAny = Object.keys(entries).some((k) => Array.isArray(entries[k]?.phrases) && (entries[k]?.phrases || []).length > 0); if (!hasAny) { c[activeTarget].tf_on = false; } } else { c[activeTarget].text_filters[tfCol] = entry; } })} style={{ fontSize: 12 }}>x</button>
                              </span>
                            ))}
                            {!(cfg[activeTarget]?.text_filters?.[tfCol]?.phrases || []).length && (
                              <span style={{ color: '#666' }}>No phrases yet</span>
                            )}
                          </div>
                        </div>
                      )}
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
