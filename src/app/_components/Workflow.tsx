"use client";
/**
 * Guided demo of the full workflow. Each action signs in as the persona whose role it needs, so the
 * separation of duties is visible: ops imports and sets permissions, a reviewer decides and publishes.
 */
import { useCallback, useEffect, useState } from "react";
import { DRIVEDESK_DICTIONARY, DRIVEDESK_SAMPLE, nexonRequest } from "@/lib/demo/dictionary";

type Json = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const PID = "pub_drivedesk";
const OPS = "ops.drivedesk";
const REVIEWER = "reviewer.drivedesk";

const READERS = [
  { key: "eu-consented", label: "Germany, full consent" },
  { key: "eu-no-profiles", label: "Germany, no profiling consent (purposes 3 and 4 off)" },
  { key: "india", label: "India, no consent framework" },
] as const;

async function call(persona: string, path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
  const s = await fetch("/v1/demo/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona }) });
  if (!s.ok) return { ok: false, status: s.status, data: await s.json().catch(() => ({})) };
  const res = await fetch(path, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  });
  return { ok: res.ok, status: res.status, data: (await res.json().catch(() => ({}))) as Json };
}

function Codes({ codes }: { codes: string[] }) {
  return <>{codes.map((c) => <code key={c} className="code-chip">{c}</code>)}</>;
}

function OutcomeTag({ o }: { o: string }) {
  const cls = o === "REMOVED" ? "bad" : o === "KEPT_RAW" ? "warn" : "ok";
  return <span className={cls}>{o}</span>;
}

export function Workflow({ current }: { current: string | null }) {
  const [proposals, setProposals] = useState<Json[]>([]);
  const [grant, setGrant] = useState<Json | null>(null);
  const [versions, setVersions] = useState<Json>({ versions: [], active_version: null });
  const [audit, setAudit] = useState<Json[]>([]);
  const [msg, setMsg] = useState<{ text: string; bad?: boolean } | null>(null);
  const [busy, setBusy] = useState(false);
  const [actingAs, setActingAs] = useState<string | null>(null);
  const [reader, setReader] = useState<(typeof READERS)[number]["key"]>("eu-consented");
  const [dsp, setDsp] = useState("ttd");
  const [result, setResult] = useState<Json | null>(null);
  const [dspList, setDspList] = useState("ttd");
  const [unmapped, setUnmapped] = useState("drop");

  const refresh = useCallback(async () => {
    const [p, g, v, a] = await Promise.all([
      call(REVIEWER, `/v1/publishers/${PID}/proposals`),
      call(REVIEWER, `/v1/publishers/${PID}/grant`),
      call(REVIEWER, `/v1/publishers/${PID}/mapping-versions`),
      call(REVIEWER, `/v1/publishers/${PID}/audit`),
    ]);
    if (p.ok) setProposals(p.data.proposals);
    if (g.ok) {
      setGrant(g.data.grant);
      setDspList((g.data.grant.dsp_allowlist ?? []).join(", ") || "ttd");
      setUnmapped(g.data.grant.level === "G0" ? "drop" : g.data.grant.unmapped_handling);
    }
    if (v.ok) setVersions(v.data);
    if (a.ok) setAudit(a.data.events);
    // Put back the persona chosen in the header, so the guided demo does not change who the rest of the page acts as.
    await (current
      ? fetch("/v1/demo/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ persona: current }) })
      : fetch("/v1/demo/sessions", { method: "DELETE" }));
  }, [current]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  async function run(persona: string, label: string, fn: () => Promise<{ ok: boolean; status: number; data: Json }>) {
    setBusy(true);
    setActingAs(persona);
    setMsg(null);
    try {
      const r = await fn();
      setMsg(r.ok ? { text: `${label}: done (HTTP ${r.status})` } : { text: `${label}: HTTP ${r.status} ${r.data.code ?? ""}. ${r.data.detail ?? ""}`, bad: true });
      await refresh();
      return r;
    } finally {
      setBusy(false);
    }
  }

  const importDict = () =>
    run(OPS, "Import DriveDesk dictionary", () =>
      call(OPS, `/v1/publishers/${PID}/imports`, { method: "POST", body: { entries: DRIVEDESK_DICTIONARY, samples: [DRIVEDESK_SAMPLE] }, headers: { "idempotency-key": `ui-${Date.now()}` } }),
    );
  const decide = (p: Json, body: Json) =>
    run(REVIEWER, `Decision on ${p.raw_id}`, () => call(REVIEWER, `/v1/publishers/${PID}/proposals/${p.id}/decision`, { method: "POST", body: { ...body, row_version: p.row_version } }));
  const saveGrant = () =>
    run(OPS, "Save permissions", () =>
      call(OPS, `/v1/publishers/${PID}/grant`, {
        method: "PUT",
        body: { level: "G1", dsp_allowlist: dspList.split(",").map((s) => s.trim()).filter(Boolean), unmapped_handling: unmapped },
      }),
    );
  const publish = () => run(REVIEWER, "Publish new version", () => call(REVIEWER, `/v1/publishers/${PID}/mapping-versions`, { method: "POST" }));
  const activate = (n: number) => run(REVIEWER, `Activate version ${n}`, () => call(REVIEWER, `/v1/publishers/${PID}/active-version`, { method: "PUT", body: { version: n } }));
  const reset = () => run("admin", "Reset demo", () => call("admin", "/v1/demo/reset", { method: "POST" })).then(() => setResult(null));
  const resolve = async () => {
    const r = await run("curator.select", "Resolve bid request", () =>
      call("curator.select", "/api/lab/resolve", { method: "POST", body: { publisher_id: PID, dsp, bid_request: nexonRequest(reader) } }),
    );
    if (r.ok) setResult(r.data);
  };

  const pending = proposals.filter((p) => p.status === "PENDING_REVIEW").length;
  const approved = proposals.filter((p) => p.status === "APPROVED").length;

  return (
    <>
      <section className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>Guided demo: DriveDesk onboarding <span className="chip synthetic">Synthetic publisher</span></h2>
          <button onClick={reset} disabled={busy}>Reset demo</button>
        </div>
        <p className="muted">
          DriveDesk is a fictional car-review site that sends its own segment IDs (like <code>ev_research</code>) with no IAB
          taxonomy. Follow steps 1 to 4. Each button signs in as the person whose role the step needs, so you can see who may do what.
        </p>
        <div className="row">
          {actingAs && <span className="muted">Last action as <strong>{actingAs}</strong></span>}
          {msg && <span className={msg.bad ? "bad" : "ok"}>{msg.text}</span>}
        </div>
      </section>

      <section className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2>1. Import dictionary and review mappings</h2>
          <button className="primary" onClick={importDict} disabled={busy}>Import dictionary (as publisher ops)</button>
        </div>
        <p className="muted">
          The system suggests an IAB node for each publisher ID. Only exact name matches are approved automatically. Broader
          matches, purchase intent and fuzzy matches wait for a reviewer. Sensitive topics are blocked and cannot be overridden.
          {proposals.length > 0 && ` ${approved} approved, ${pending} waiting for review.`}
        </p>
        {proposals.length > 0 && (
          <div className="table-scroll">
            <table>
              <thead><tr><th>Publisher ID</th><th>Label</th><th>Status</th><th>Suggested IAB node</th><th>Reason codes</th><th>Reviewer actions</th></tr></thead>
              <tbody>
                {proposals.map((p) => (
                  <tr key={p.id}>
                    <td><code>{p.raw_id}</code><div className="muted small">{p.field} · {p.signal_class ?? "unknown"}</div></td>
                    <td>{p.label ?? <span className="muted">(not in dictionary)</span>}</td>
                    <td><span className={p.status === "APPROVED" ? "ok" : p.status === "BLOCKED" || p.status === "REVOKED" ? "bad" : "warn"}>{p.status}</span>{p.decided_by && <div className="muted small">{p.decided_by}</div>}</td>
                    <td>
                      {p.target ? <><code>{p.target.segtax}/{p.target.id}</code> {(p.candidates as Json[] | undefined)?.find((c) => c.id === p.target.id)?.name ?? ""}{p.match_type && <div className="muted small">{p.match_type} match</div>}</> : <span className="muted">none</span>}
                      {!p.target && p.candidates?.length > 0 && <div className="muted small">Candidates: {p.candidates.map((c: Json) => `${c.id} ${c.name}`).join("; ")}</div>}
                    </td>
                    <td><Codes codes={p.reason_codes} /></td>
                    <td>
                      <div className="row">
                        {p.status === "PENDING_REVIEW" && p.target && p.signal_class !== "PURCHASE_INTENT" && (
                          <button onClick={() => decide(p, { action: "approve" })} disabled={busy}>Approve</button>
                        )}
                        {p.status === "PENDING_REVIEW" && p.signal_class === "PURCHASE_INTENT" && (
                          <button onClick={() => decide(p, { action: "choose_other", target: { segtax: 4, id: "253" }, reclassify_to: "AUDIENCE_INTEREST", note: "Reading behaviour shows interest, not purchase intent" })} disabled={busy}>
                            Reclassify as interest → 253
                          </button>
                        )}
                        {p.status === "PENDING_REVIEW" && <button onClick={() => decide(p, { action: "abstain" })} disabled={busy}>Leave unmapped</button>}
                        {p.status === "BLOCKED" && <button onClick={() => decide(p, { action: "approve" })} disabled={busy} title="Shows that the override is refused">Try to approve</button>}
                        {p.status === "APPROVED" && <button onClick={() => decide(p, { action: "revoke", note: "Revoked in demo" })} disabled={busy}>Revoke</button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid2">
        <section className="card">
          <h2>2. Publisher permissions</h2>
          <p className="muted">
            Set by publisher ops. Translation only happens for the buyers (DSPs) listed here. Current level:{" "}
            <strong>{grant?.level ?? "?"}</strong>{grant?.level === "G0" && " (not onboarded: own IDs are passed on untouched)"}.
          </p>
          <div className="row">
            <label>Allowed DSPs <input value={dspList} onChange={(e) => setDspList(e.target.value)} size={14} /></label>
            <label>IDs with no mapping{" "}
              <select value={unmapped} onChange={(e) => setUnmapped(e.target.value)}>
                <option value="drop">remove</option>
                <option value="pass_raw">pass on unchanged</option>
              </select>
            </label>
            <button className="primary" onClick={saveGrant} disabled={busy}>Save (as publisher ops)</button>
          </div>
        </section>

        <section className="card">
          <h2>3. Publish and activate a version</h2>
          <p className="muted">Publishing freezes the approved mappings into a numbered, hashed version. Activating an older version is an instant rollback.</p>
          <button className="primary" onClick={publish} disabled={busy}>Publish approved mappings (as reviewer)</button>
          {versions.versions.length > 0 && (
            <table style={{ marginTop: 8 }}>
              <thead><tr><th>Version</th><th>Mappings</th><th>Hash</th><th></th></tr></thead>
              <tbody>
                {versions.versions.map((v: Json) => (
                  <tr key={v.version}>
                    <td>v{v.version} {v.active && <span className="chip real">active</span>}</td>
                    <td>{v.entries}</td>
                    <td><code>{String(v.snapshot_hash).slice(0, 12)}…</code></td>
                    <td>{!v.active && <button onClick={() => activate(v.version)} disabled={busy}>{versions.active_version && v.version < versions.active_version ? "Roll back to this" : "Activate"}</button>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>

      <section className="card">
        <h2>4. Bid request lab <span className="chip illustrative">Illustrative consent rules</span></h2>
        <p className="muted">
          A synthetic bid request for a reader of DriveDesk&apos;s Tata Nexon EV review. It carries DriveDesk&apos;s own IDs plus
          Metro Daily&apos;s already-standard IAB audience IDs. Choose who the reader is and which buyer receives it.
        </p>
        <div className="row">
          <label>Reader <select value={reader} onChange={(e) => setReader(e.target.value as typeof reader)}>{READERS.map((r) => <option key={r.key} value={r.key}>{r.label}</option>)}</select></label>
          <label>DSP <select value={dsp} onChange={(e) => setDsp(e.target.value)}><option value="ttd">ttd</option><option value="xandr">xandr</option></select></label>
          <button className="primary" onClick={resolve} disabled={busy}>Resolve</button>
        </div>
        {result && (
          <>
            <p>
              Status <strong>{result.status}</strong> · version <code>{result.mapping_version ?? "none"}</code> · rule{" "}
              <code>{result.policy?.rule}</code> ({result.policy?.jurisdiction}) · content{" "}
              <span className={result.policy?.content.allowed ? "ok" : "bad"}>{result.policy?.content.allowed ? "allowed" : "denied"}</span> · audience{" "}
              <span className={result.policy?.audience.allowed ? "ok" : "bad"}>{result.policy?.audience.allowed ? "allowed" : "denied"}</span>
              {result.timing && <> · {result.timing.resolver_ms_local} ms in resolver</>}
            </p>
            <div className="table-scroll">
              <table>
                <thead><tr><th>Where</th><th>Provider</th><th>ID in</th><th>Outcome</th><th>ID out</th><th>Reason codes</th></tr></thead>
                <tbody>
                  {(result.decisions as Json[]).map((d, i) => (
                    <tr key={i}>
                      <td><code>{d.path}</code></td>
                      <td>{d.provider}</td>
                      <td><code>{d.raw_id}</code></td>
                      <td><OutcomeTag o={d.outcome} /></td>
                      <td>{d.to ? <><code>{d.to.segtax}/{d.to.id}</code> {d.to.name}</> : ""}</td>
                      <td><Codes codes={d.reason_codes} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="grid2">
              <div><h3>Data sent in</h3><pre>{JSON.stringify(pickData(nexonRequest(reader)), null, 2)}</pre></div>
              <div><h3>Data sent to the DSP</h3><pre>{JSON.stringify(pickData(result.bid_request), null, 2)}</pre></div>
            </div>
            <h3>Same call from a bidder service</h3>
            <pre>{`curl -X POST https://segment-manager.vercel.app/v1/resolve \\
  -H "Authorization: Bearer <service key>" -H "Content-Type: application/json" \\
  -d '{"publisher_id":"${PID}","dsp":"${dsp}","bid_request":{...}}'`}</pre>
          </>
        )}
      </section>

      <section className="card">
        <h2>Audit log <span className="muted small">(no user IDs, consent strings or IP addresses are stored)</span></h2>
        {audit.length === 0 ? (
          <p className="muted">No events yet.</p>
        ) : (
          <div className="table-scroll">
            <table>
              <thead><tr><th>When (UTC)</th><th>Who</th><th>What</th><th>Item</th><th>Version</th></tr></thead>
              <tbody>
                {audit.slice(0, 40).map((e, i) => (
                  <tr key={i}>
                    <td>{String(e.at).slice(11, 19)}</td>
                    <td>{e.actor}</td>
                    <td><code>{e.action}</code></td>
                    <td className="muted small">{e.entity}</td>
                    <td>{e.mapping_version ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}

function pickData(br: Json) {
  return { "site.content.data": br?.site?.content?.data ?? null, "user.data": br?.user?.data ?? null };
}
