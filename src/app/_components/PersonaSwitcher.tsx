"use client";
import { useState } from "react";

type Persona = { persona: string; displayName: string; role: string; publishers: string[] };

export function PersonaSwitcher({ personas, current }: { personas: Persona[]; current: string | null }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  async function choose(persona: string) {
    setBusy(true);
    setError(null);
    const res = persona
      ? await fetch("/v1/demo/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona }) })
      : await fetch("/v1/demo/sessions", { method: "DELETE" });
    setBusy(false);
    if (!res.ok) {
      setError((await res.json()).detail ?? "Sign-in failed");
      return;
    }
    window.location.reload();
  }
  return (
    <div className="row">
      <label htmlFor="persona" className="muted">Signed in as</label>
      <select id="persona" value={current ?? ""} disabled={busy} onChange={(e) => choose(e.target.value)}>
        <option value="">Nobody (signed out)</option>
        {personas.map((p) => (
          <option key={p.persona} value={p.persona}>
            {p.displayName} ({p.role}{p.publishers.length ? `, ${p.publishers.join(", ")}` : ""})
          </option>
        ))}
      </select>
      {error && <span className="bad">{error}</span>}
    </div>
  );
}
