"use client";
import { useState } from "react";

export function TaxonomyLookup({ signedIn }: { signedIn: boolean }) {
  const [tax, setTax] = useState("content/3.0");
  const [id, setId] = useState("22");
  const [out, setOut] = useState<string>("");
  async function run() {
    const res = await fetch(`/v1/taxonomies/${tax}/nodes/${encodeURIComponent(id)}`);
    setOut(`HTTP ${res.status}\n${JSON.stringify(await res.json(), null, 2)}`);
  }
  return (
    <section className="card">
      <h2>Taxonomy lookup <span className="chip real">Official IAB files</span></h2>
      <p className="muted">
        <code>GET /v1/taxonomies/{"{taxonomy}/{version}"}/nodes/{"{id}"}</code>. Try <code>content/3.0</code> 22, or <code>audience/1.1</code> 253 and 824.
      </p>
      <div className="row">
        <select aria-label="Taxonomy" value={tax} onChange={(e) => setTax(e.target.value)}>
          <option value="content/3.0">Content 3.0 (segtax 7)</option>
          <option value="content/3.1">Content 3.1 (segtax 9)</option>
          <option value="content/2.2">Content 2.2 (segtax 6)</option>
          <option value="audience/1.1">Audience 1.1 (segtax 4)</option>
        </select>
        <input aria-label="Node ID" value={id} onChange={(e) => setId(e.target.value)} onFocus={(e) => e.target.select()} size={10} />
        <button className="primary" onClick={run} disabled={!signedIn}>Look up</button>
      </div>
      {out && <pre>{out}</pre>}
    </section>
  );
}
