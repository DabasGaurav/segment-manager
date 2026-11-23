"use client";
import { useEffect, useState } from "react";
import { AccessState, PageHeader, PID, REVIEWER, OPS, RoleButton, Tag, useApp } from "../App";
import { api, lookupNode, type Json } from "../client";
import { explainCodes, MATCH, PROPOSAL_STATUS, SIGNAL_CLASS } from "../explain";
import { DRIVEDESK_DICTIONARY, DRIVEDESK_SAMPLE } from "@/lib/demo/dictionary";

/** Interest-branch equivalents a reviewer can pick when rejecting a purchase-intent claim (Audience 1.1). */
const INTEREST_FOR: Record<string, { segtax: number; id: string; name: string }> = {
  "Green Vehicles": { segtax: 4, id: "253", name: "Green Vehicles" },
};

export function NodeName({ segtax, id, fallback }: { segtax: number; id: string; fallback?: string }) {
  const [name, setName] = useState<string | null>(fallback ?? null);
  useEffect(() => {
    if (fallback) return;
    let live = true;
    lookupNode(segtax, id).then((n) => live && setName(n ? n.name : "Not a valid IAB ID"));
    return () => {
      live = false;
    };
  }, [segtax, id, fallback]);
  return <>{name ?? "…"}</>;
}

const FILTERS = [
  { key: "all", label: "All" },
  { key: "PENDING_REVIEW", label: "Needs review" },
  { key: "APPROVED", label: "Approved" },
  { key: "BLOCKED", label: "Blocked" },
  { key: "OTHER", label: "Unmapped / revoked" },
] as const;

export function importDictionary() {
  return api(`/v1/publishers/${PID}/imports`, {
    method: "POST",
    body: { entries: DRIVEDESK_DICTIONARY, samples: [DRIVEDESK_SAMPLE] },
    headers: { "idempotency-key": `ui-${Date.now()}-${Math.random().toString(36).slice(2, 8)}` },
  });
}

export function decide(p: Json, body: Json) {
  return api(`/v1/publishers/${PID}/proposals/${p.id}/decision`, { method: "POST", body: { ...body, row_version: p.row_version } });
}

export function ReviewView() {
  const { data, loaded, act } = useApp();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]["key"]>("all");
  const list = data.proposals.filter((p) => p.status !== "SUPERSEDED");
  const count = (k: string) => (k === "all" ? list.length : k === "OTHER" ? list.filter((p) => ["ABSTAINED", "REVOKED", "REJECTED"].includes(p.status)).length : list.filter((p) => p.status === k).length);
  const shown = list.filter((p) => filter === "all" || (filter === "OTHER" ? ["ABSTAINED", "REVOKED", "REJECTED"].includes(p.status) : p.status === filter));
  const pending = count("PENDING_REVIEW");

  const doImport = () => act("Imported DriveDesk's signal dictionary. Suggestions are ready for review.", importDictionary, OPS);

  return (
    <div className="stack">
      <PageHeader
        step="Step 1 of 3"
        title="Import & review signals"
        lead="DriveDesk sends its own IDs, like ev_research, that buyers can't read. Import its dictionary, check each suggested IAB category, and decide. Only exact name matches are approved automatically."
      >
        {list.length > 0 && (
          <RoleButton role="publisher_ops" onClick={doImport}>
            Re-import dictionary
          </RoleButton>
        )}
      </PageHeader>

      {data.denied ? (
        <AccessState />
      ) : !loaded ? (
        <div className="skeleton" aria-busy="true">Loading DriveDesk&apos;s signals…</div>
      ) : list.length === 0 ? (
        <div className="empty">
          <h3>No signals imported yet</h3>
          <p className="muted">DriveDesk&apos;s dictionary describes {DRIVEDESK_DICTIONARY.length} of its signals. Importing it creates a suggested IAB category for each, plus one for an ID seen in its traffic that the dictionary doesn&apos;t mention.</p>
          <table className="table compact">
            <thead><tr><th>DriveDesk ID</th><th>What it means</th><th>Type</th></tr></thead>
            <tbody>
              {DRIVEDESK_DICTIONARY.map((d) => (
                <tr key={d.raw_id}><td><code>{d.raw_id}</code></td><td>{d.label}<div className="muted small">{d.description}</div></td><td>{SIGNAL_CLASS[d.declared_class]}</td></tr>
              ))}
            </tbody>
          </table>
          <div className="row">
            <RoleButton role="publisher_ops" className="btn primary" onClick={doImport}>Import DriveDesk&apos;s dictionary</RoleButton>
            <span className="muted small">Done by publisher ops. A reviewer approves afterwards (separation of duties).</span>
          </div>
        </div>
      ) : (
        <>
          <div className="filters" role="tablist" aria-label="Filter signals">
            {FILTERS.map((f) => (
              <button key={f.key} role="tab" aria-selected={filter === f.key} className={`filter ${filter === f.key ? "active" : ""}`} onClick={() => setFilter(f.key)}>
                {f.label} <span className="count">{count(f.key)}</span>
              </button>
            ))}
          </div>
          {pending > 0 && filter !== "PENDING_REVIEW" && (
            <div className="callout warn">
              <strong>{pending} signal{pending === 1 ? "" : "s"} need{pending === 1 ? "s" : ""} your decision.</strong> Nothing reaches buyers until it&apos;s approved and published.
            </div>
          )}
          <div className="signal-list">
            {shown.length === 0 && <div className="empty small">Nothing in this filter.</div>}
            {shown.map((p) => (
              <SignalRow key={p.id} p={p} />
            ))}
          </div>
          {pending === 0 && (
            <div className="next-step">
              <div>
                <strong>Review complete.</strong> <span className="muted">Next, choose which buyers may receive these signals and publish them.</span>
              </div>
              <NextButton />
            </div>
          )}
        </>
      )}
    </div>
  );
}

function NextButton() {
  const { go } = useApp();
  return <button className="btn primary" onClick={() => go("publish")}>Continue to Configure & publish →</button>;
}

function SignalRow({ p }: { p: Json }) {
  const { act } = useApp();
  const [open, setOpen] = useState(false);
  const [choice, setChoice] = useState("");
  const st = PROPOSAL_STATUS[p.status] ?? { label: p.status, tone: "muted" };
  const ex = explainCodes(p.reason_codes ?? []);
  const cands: Json[] = p.candidates ?? [];
  const targetName = p.target ? cands.find((c) => c.id === p.target.id && c.segtax === p.target.segtax)?.name : undefined;
  const intent = p.signal_class === "PURCHASE_INTENT";
  const topName: string | undefined = cands[0]?.name;
  const reclass = intent && topName ? INTEREST_FOR[topName] : undefined;
  const label = p.label ?? "Not in dictionary";
  const run = (msg: string, body: Json) => act(msg, () => decide(p, body), REVIEWER);

  return (
    <article className={`signal ${p.status === "PENDING_REVIEW" ? "attention" : ""}`} data-raw={p.raw_id}>
      <div className="signal-main">
        <div className="sig-from">
          <div className="sig-label">{label}</div>
          <div className="muted small"><code>{p.raw_id}</code> · {p.signal_class ? SIGNAL_CLASS[p.signal_class] : "Unknown type"}</div>
        </div>
        <div className="sig-arrow" aria-hidden>→</div>
        <div className="sig-to">
          {p.target ? (
            <>
              <div className="sig-label"><NodeName segtax={p.target.segtax} id={p.target.id} fallback={targetName} /></div>
              <div className="muted small">
                IAB {p.target.segtax === 4 ? "Audience 1.1" : "Content 3.0"} · ID {p.target.id}
                {p.match_type && MATCH[p.match_type] && <> · <Tag tone={MATCH[p.match_type]!.tone}>{MATCH[p.match_type]!.label}</Tag></>}
              </div>
            </>
          ) : (
            <>
              <div className="sig-label muted">{p.status === "BLOCKED" ? "Never mapped" : cands.length ? `${cands.length} possible categories` : "No suggestion"}</div>
              {cands.length > 0 && p.status !== "BLOCKED" && <div className="muted small">{cands.map((c) => c.name).filter((v, i, a) => a.indexOf(v) === i).join(" · ")}</div>}
            </>
          )}
        </div>
        <div className="sig-status">
          <Tag tone={st.tone}>{st.label}</Tag>
          {p.decided_by && <div className="muted small">{p.decided_by.startsWith("system:") ? "Automatic" : p.decided_by}</div>}
        </div>
      </div>
      <p className="sig-why">{ex.main}</p>
      <div className="sig-actions">
        {p.status === "PENDING_REVIEW" && p.target && !intent && (
          <RoleButton role="reviewer" className="btn primary small" onClick={() => run(`Approved ${label} → IAB ${p.target.id}.`, { action: "approve" })}>Approve</RoleButton>
        )}
        {p.status === "PENDING_REVIEW" && reclass && (
          <RoleButton role="reviewer" className="btn primary small" onClick={() => run(`${label}: reclassified as interest → ${reclass.name} (IAB ${reclass.id}).`, { action: "choose_other", target: { segtax: reclass.segtax, id: reclass.id }, reclassify_to: "AUDIENCE_INTEREST", note: "Reading behaviour shows interest, not purchase intent" })}>
            Reclassify as interest: {reclass.name}
          </RoleButton>
        )}
        {p.status === "PENDING_REVIEW" && cands.length > 0 && (
          <span className="choose">
            <select aria-label={`Choose a category for ${label}`} value={choice} onChange={(e) => setChoice(e.target.value)}>
              <option value="">Choose a different category…</option>
              {cands.map((c) => (
                <option key={`${c.segtax}/${c.id}`} value={`${c.segtax}/${c.id}`}>{c.name} ({c.path?.slice(0, -1).join(" › ")}) · ID {c.id}</option>
              ))}
            </select>
            {choice && (
              <RoleButton role="reviewer" className="btn small" onClick={() => { const [s, i] = choice.split("/"); run(`Mapped ${label} → IAB ${i}.`, { action: "choose_other", target: { segtax: Number(s), id: i } }); setChoice(""); }}>
                Use this
              </RoleButton>
            )}
          </span>
        )}
        {p.status === "PENDING_REVIEW" && (
          <RoleButton role="reviewer" className="btn ghost small" onClick={() => run(`${label} left unmapped.`, { action: "abstain", note: "Left unmapped by reviewer" })}>Leave unmapped</RoleButton>
        )}
        {p.status === "BLOCKED" && (
          <RoleButton role="reviewer" className="btn ghost small" title="Shows that the server refuses the override" onClick={() => run("", { action: "approve" })}>Try to override</RoleButton>
        )}
        {p.status === "APPROVED" && (
          <RoleButton role="reviewer" className="btn ghost small" onClick={() => run(`Revoked ${label}. Publish a new version for it to take effect.`, { action: "revoke", note: "Revoked by reviewer" })}>Revoke</RoleButton>
        )}
        <button className="link-btn small" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? "Hide details" : "Details"}</button>
      </div>
      {open && (
        <div className="details">
          {ex.more.length > 0 && <ul className="small">{ex.more.map((m) => <li key={m}>{m}</li>)}</ul>}
          <dl className="kv small">
            <dt>Reason codes</dt><dd>{(p.reason_codes ?? []).map((c: string) => <code key={c} className="code-chip">{c}</code>)}</dd>
            <dt>Method</dt><dd>{p.method}{p.match_score !== null && p.match_score !== undefined ? ` · score ${p.match_score}` : ""}</dd>
            <dt>Field</dt><dd>{p.field === "content" ? "Page content (site.content.data)" : "Reader (user.data)"}</dd>
            {cands.length > 0 && <><dt>Candidates</dt><dd>{cands.map((c) => `${c.segtax}/${c.id} ${c.path?.join(" › ")} (${c.score})`).join("; ")}</dd></>}
            {p.decision_note && <><dt>Note</dt><dd>{p.decision_note}</dd></>}
            <dt>Row version</dt><dd>{p.row_version}</dd>
          </dl>
        </div>
      )}
    </article>
  );
}
