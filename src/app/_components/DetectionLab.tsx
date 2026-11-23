"use client";
import { useState } from "react";
import { PRESETS } from "./presets";

type Seg = { path: string; raw_id: string | null; status: string; next_step: string; signal_class: string | null; reason_codes: string[]; node?: { taxonomy: string; id: string; path: string[] } };
type Obj = { path: string; provider_name: string | null; segtax: number | null; segtax_name: string | null; next_step: string; reason_codes: string[]; warnings: string[]; segments: Seg[] };
type Detection = { data_objects: Obj[]; location_errors: { path: string; reason_codes: string[] }[]; info: { code: string; detail: string }[]; summary: Record<string, number> };

const STEP_LABEL: Record<string, [string, string]> = {
  PASS_THROUGH_SUBJECT_TO_POLICY: ["Pass through (after policy checks)", "ok"],
  TRANSLATION_CANDIDATE: ["Needs an approved mapping", "warn"],
  REMOVE: ["Remove", "bad"],
};

export function DetectionLab({ signedIn }: { signedIn: boolean }) {
  const [text, setText] = useState(JSON.stringify(PRESETS[0]!.body, null, 2));
  const [result, setResult] = useState<Detection | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function run() {
    setBusy(true);
    setError(null);
    setResult(null);
    const res = await fetch("/api/lab/inspect", { method: "POST", headers: { "content-type": "application/json" }, body: text });
    const body = await res.json();
    setBusy(false);
    if (!res.ok) {
      setError(`${res.status} ${body.code}: ${body.detail}${body.errors ? " " + body.errors.map((e: { path: string; message: string }) => `${e.path}: ${e.message}`).join("; ") : ""}`);
      return;
    }
    setResult(body.detection);
  }

  return (
    <section className="card">
      <h2>Detection lab</h2>
      <p className="muted">
        Paste an OpenRTB 2.6 bid request (wrapped as <code>{"{ publisher_id, dsp, bid_request }"}</code>). The detector checks every
        Data object in <code>site/app/dooh.content.data</code> and <code>user.data</code> against the official IAB files. It does not
        change the request yet: mapping, consent and grants arrive in Checkpoint 2. <span className="chip synthetic">Synthetic samples</span>
      </p>
      <div className="row" style={{ marginBottom: 8 }}>
        <select aria-label="Sample request" onChange={(e) => setText(JSON.stringify(PRESETS.find((p) => p.key === e.target.value)!.body, null, 2))}>
          {PRESETS.map((p) => (
            <option key={p.key} value={p.key}>{p.label}</option>
          ))}
        </select>
        <button className="primary" onClick={run} disabled={busy || !signedIn}>{busy ? "Checking…" : "Check signals"}</button>
        {!signedIn && <span className="warn">Pick a persona above first.</span>}
      </div>
      <textarea aria-label="Request body" value={text} onChange={(e) => setText(e.target.value)} spellCheck={false} />
      {error && <p className="bad">{error}</p>}
      {result && (
        <div style={{ marginTop: 12 }}>
          <p>
            {result.summary.segments} segments in {result.summary.data_objects} Data objects: {result.summary.valid_standard} valid IAB,{" "}
            {result.summary.proprietary} proprietary, {result.summary.other_pass_through} other standard, {result.summary.removed} to remove.
          </p>
          {result.info.map((i) => <p key={i.code} className="muted">ℹ {i.code}: {i.detail}</p>)}
          {result.location_errors.map((l) => <p key={l.path} className="bad">{l.path}: {l.reason_codes.join(", ")}</p>)}
          <div className="table-scroll">
            <table>
              <thead>
                <tr><th>Where</th><th>Provider / segtax</th><th>Segment ID</th><th>Result</th><th>Reason codes</th><th>IAB node</th></tr>
              </thead>
              <tbody>
                {result.data_objects.flatMap((o) =>
                  (o.segments.length ? o.segments : [null]).map((s, j) => {
                    const step = s ? STEP_LABEL[s.next_step]! : ["Remove object", "bad"];
                    return (
                      <tr key={`${o.path}-${j}`}>
                        <td><code>{s?.path ?? o.path}</code></td>
                        <td>{o.provider_name ?? <span className="muted">(no name)</span>}<br /><span className="muted">{o.segtax === null ? "no segtax" : `${o.segtax}: ${o.segtax_name}`}</span></td>
                        <td><code>{s?.raw_id ?? "—"}</code></td>
                        <td className={step[1]}>{step[0]}</td>
                        <td><code>{[...(s?.reason_codes ?? o.reason_codes), ...o.warnings].join(", ")}</code></td>
                        <td>{s?.node ? `${s.node.taxonomy} #${s.node.id}: ${s.node.path.join(" › ")}` : ""}</td>
                      </tr>
                    );
                  }),
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
