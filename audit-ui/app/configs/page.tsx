"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import axios from "axios";
import { useRouter } from "next/navigation";

type Preset = { name: string; description?: string; updated_at?: string };

export default function ConfigsPage() {
  const router = useRouter();
  const API = process.env.NEXT_PUBLIC_API_BASE || "http://localhost:8000";

  const [items, setItems] = useState<Preset[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [active, setActive] = useState<Preset | null>(null);
  const [busyName, setBusyName] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((i) => i.name.toLowerCase().includes(q));
  }, [items, query]);

  const load = async () => {
    try {
      setLoading(true);
      setError(null);
      const r = await axios.get(`${API}/configs`);
      const list = (r.data?.items || []) as Preset[];
      setItems(list);
      if (active) {
        const found = list.find((x) => x.name === active.name) || null;
        setActive(found);
      }
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to load configs");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [API]);

  const handleEdit = async (name: string) => {
    try {
      setBusyName(name);
      const r = await axios.get(`${API}/configs/${encodeURIComponent(name)}`);
      const cfg = r.data?.targets_config || {};
      const desc = r.data?.description || "";
      const targets = Object.keys(cfg || {});
      if (typeof window !== "undefined") {
        try {
          sessionStorage.setItem("builder.targetsConfig", JSON.stringify(cfg));
          sessionStorage.setItem("builder.selectedTargets", JSON.stringify(targets));
          sessionStorage.setItem("builder.configName", name);
          sessionStorage.setItem("builder.configDesc", desc);
        } catch {}
      }
      router.push("/builder/step2");
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Failed to open config");
    } finally {
      setBusyName(null);
    }
  };

  const handleDelete = async (name: string) => {
    if (!confirm(`Delete config "${name}"?`)) return;
    try {
      setBusyName(name);
      await axios.delete(`${API}/configs/${encodeURIComponent(name)}`);
      await load();
    } catch (e: any) {
      setError(e?.response?.data?.detail || e?.message || "Delete failed");
    } finally {
      setBusyName(null);
    }
  };

  return (
    <main
      style={{
        padding: "2rem",
        fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
        maxWidth: 900,
        margin: "0 auto",
      }}
    >
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Manage configs</h1>

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

      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 12 }}>
        <input
          value={query}
          onChange={(e) => setQuery((e.target as HTMLInputElement).value)}
          placeholder="Filter by name"
          style={{ flex: 1, minWidth: 240 }}
        />
        <button onClick={load} disabled={loading}>
          {loading ? "Refreshing…" : "Refresh"}
        </button>
        <Link href="/builder" style={{ background: "#b9d6df", padding: "6px 10px", borderRadius: 6 }}>
          + Create new
        </Link>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        {/* List */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          {filtered.length === 0 && <div style={{ color: "#666" }}>No configs found.</div>}
          {filtered.map((c) => (
            <div
              key={c.name}
              style={{
                padding: "8px 6px",
                borderTop: "1px dashed #eee",
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
              }}
            >
              <div onClick={() => setActive(c)} style={{ cursor: "pointer" }}>
                <div style={{ fontWeight: 700 }}>{c.name}</div>
                {c.updated_at && (
                  <div style={{ fontSize: 12, color: "#666" }}>Updated {c.updated_at}</div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8 }}>
                <button
                  onClick={() => handleEdit(c.name)}
                  disabled={busyName === c.name}
                  style={{ background: busyName === c.name ? "#dbe7ec" : "#b9d6df", padding: "4px 10px", borderRadius: 6 }}
                >
                  Edit
                </button>
                <button
                  onClick={() => handleDelete(c.name)}
                  disabled={busyName === c.name}
                  style={{ background: "#f5d6d6", padding: "4px 10px", borderRadius: 6 }}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>

        {/* Details */}
        <div style={{ border: "1px solid #eee", borderRadius: 10, padding: 12 }}>
          {!active && <div style={{ color: "#666" }}>Select a config to view details.</div>}
          {active && (
            <div>
              <div style={{ fontWeight: 700, marginBottom: 4 }}>{active.name}</div>
              <div style={{ whiteSpace: "pre-wrap", color: "#333" }}>
                {active.description || "(no description)"}
              </div>
            </div>
          )}
        </div>
      </div>

      <div style={{ marginTop: 16 }}>
        <Link href="/start" style={{ textDecoration: "underline" }}>
          Back to Start
        </Link>
      </div>
    </main>
  );
}
