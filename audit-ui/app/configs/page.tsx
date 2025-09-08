"use client";

import Link from "next/link";

export default function ConfigsPage() {
  return (
    <main style={{ padding: "2rem", fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif", maxWidth: 720, margin: "0 auto" }}>
      <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>Manage configs</h1>
      <p style={{ color: '#555' }}>Coming soon — list, edit, and delete saved configs.</p>
      <div style={{ marginTop: 16 }}>
        <Link href="/start" style={{ textDecoration: 'underline' }}>Back to Start</Link>
      </div>
    </main>
  );
}

