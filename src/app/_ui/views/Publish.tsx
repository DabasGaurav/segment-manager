"use client";
import { Fragment, useEffect, useState } from "react";
import { AccessState, PageHeader, PID, OPS, REVIEWER, RoleButton, Tag, useApp } from "../App";
import { api, type Json } from "../client";
import { NodeName } from "./Review";

const KNOWN_BUYERS = ["ttd", "xandr"];

export function publishVersion() {
  return api(`/v1/publishers/${PID}/mapping-versions`, { method: "POST" });
}
export function activateVersion(n: number) {
  return api(`/v1/publishers/${PID}/active-version`, { method: "PUT", body: { version: n } });
}
export function saveGrant(buyers: string[], unmapped: string) {
  return api(`/v1/publishers/${PID}/grant`, { method: "PUT", body: { level: "G1", dsp_allowlist: buyers, unmapped_handling: unmapped } });
}

export function PublishView() {
  const { data, loaded, go } = useApp();
  return (
    <div className="stack">
      <PageHeader
        step="Step 2 of 3"
        title="Configure & publish"
        lead="Decide who may receive DriveDesk's translated signals, then publish the approved mappings. Each version is frozen and fingerprinted, so going back is one click."
      />
      {data.denied ? (
        <AccessState />
      ) : !loaded ? (
        <div className="skeleton">Loading…</div>
      ) : (
        <>
          <Permissions />
          <Versions />
          {data.activeVersion !== null && (
            <div className="next-step">
              <div><strong>Version {data.activeVersion} is live.</strong> <span className="muted">Next, see exactly what a buyer receives.</span></div>
              <button className="btn primary" onClick={() => go("verify")}>Continue to Verify results →</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Permissions() {
  const { data, act } = useApp();
  const g = data.grant;
  const [buyers, setBuyers] = useState<string[]>(["ttd"]);
  const [unmapped, setUnmapped] = useState("drop");
  useEffect(() => {
    if (!g) return;
    if (g.level === "G0") {
      setBuyers(["ttd"]);
      setUnmapped("drop");
    } else {
      setBuyers(g.dsp_allowlist ?? []);
      setUnmapped(g.unmapped_handling);
    }
  }, [g]);
  const onboarded = g && g.level !== "G0";
  const dirty = !onboarded || JSON.stringify([...buyers].sort()) !== JSON.stringify([...(g?.dsp_allowlist ?? [])].sort()) || unmapped !== g?.unmapped_handling;
  const all = [...new Set([...KNOWN_BUYERS, ...(g?.dsp_allowlist ?? [])])];

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Buyer permissions</h2>
          <p className="muted">
            Set by DriveDesk&apos;s publisher ops. These govern <strong>translating and reusing DriveDesk&apos;s own IDs</strong>. Signals that already use a
            standard IAB category pass through regardless, subject to consent and policy checks.
          </p>
        </div>
        <Tag tone={onboarded ? "ok" : "muted"}>{onboarded ? "Onboarded" : "Not onboarded"}</Tag>
      </div>
      <div className="form-grid">
        <fieldset>
          <legend>Which buyers (DSPs) may receive translated signals?</legend>
          {all.map((b) => (
            <label key={b} className="check">
              <input type="checkbox" checked={buyers.includes(b)} onChange={(e) => setBuyers(e.target.checked ? [...buyers, b] : buyers.filter((x) => x !== b))} />
              <span><strong>{b}</strong></span>
            </label>
          ))}
          <p className="muted small">Buyers not ticked get none of DriveDesk&apos;s translated signals.</p>
        </fieldset>
        <fieldset>
          <legend>What happens to IDs with no approved mapping?</legend>
          <label className="check">
            <input type="radio" name="unmapped" checked={unmapped === "drop"} onChange={() => setUnmapped("drop")} />
            <span><strong>Remove them</strong> <span className="muted">(recommended): buyers only see what was reviewed</span></span>
          </label>
          <label className="check">
            <input type="radio" name="unmapped" checked={unmapped === "pass_raw"} onChange={() => setUnmapped("pass_raw")} />
            <span><strong>Pass them on unchanged</strong> <span className="muted">: today&apos;s behaviour. Sensitive IDs are still removed.</span></span>
          </label>
        </fieldset>
      </div>
      <div className="card-foot">
        <span className="muted small">
          {onboarded
            ? `Current: translate for ${g!.dsp_allowlist.join(", ") || "no buyers"}; unmapped IDs are ${g!.unmapped_handling === "drop" ? "removed" : "passed on"}. Attested by ${g!.attested_by ?? "—"}.`
            : "Until this is saved, DriveDesk's own IDs are left untouched."}
        </span>
        <RoleButton
          role="publisher_ops"
          className="btn primary"
          disabled={buyers.length === 0 || !dirty}
          onClick={() => act(`Permissions saved: translate for ${buyers.join(", ")}; unmapped IDs ${unmapped === "drop" ? "removed" : "passed on"}.`, () => saveGrant(buyers, unmapped), OPS)}
        >
          {onboarded ? "Save changes" : "Save permissions"}
        </RoleButton>
      </div>
      {buyers.length === 0 && <p className="bad small">Pick at least one buyer.</p>}
    </section>
  );
}

function Versions() {
  const { data, act } = useApp();
  const [confirm, setConfirm] = useState<number | null>(null);
  const [open, setOpen] = useState<number | null>(null);
  const approved = data.proposals.filter((p) => p.status === "APPROVED");
  const live = data.versions.find((v) => v.active);
  const latest = data.versions[0];
  const key = (field: string, raw: string) => `${field}|${raw}`;
  const liveMap = new Map<string, Json>((latest?.mappings ?? []).map((m: Json) => [key(m.field, m.raw_id), m]));
  const nextMap = new Map<string, Json>(approved.map((p) => [key(p.field, p.raw_id), p]));
  const added = approved.filter((p) => !liveMap.has(key(p.field, p.raw_id)));
  const changed = approved.filter((p) => {
    const m = liveMap.get(key(p.field, p.raw_id));
    return m && (m.target_segtax !== p.target?.segtax || m.target_id !== p.target?.id);
  });
  const removed = [...liveMap.values()].filter((m) => !nextMap.has(key(m.field, m.raw_id)));
  const hasChanges = added.length + changed.length + removed.length > 0;
  const pending = data.proposals.filter((p) => p.status === "PENDING_REVIEW").length;

  const publishAndActivate = () =>
    act(
      "Published and made live.",
      async () => {
        const r = await publishVersion();
        if (!r.ok) return r;
        return activateVersion(r.data.version);
      },
      REVIEWER,
    );

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h2>Mapping versions</h2>
          <p className="muted">Publishing freezes the approved mappings into a numbered version with a fingerprint. The bidder only uses the live version, so edits never leak into traffic early.</p>
        </div>
        {live ? <Tag tone="ok">Version {live.version} live</Tag> : <Tag tone="muted">Nothing live</Tag>}
      </div>

      <div className="publish-box">
        <div>
          <strong>{approved.length} approved mapping{approved.length === 1 ? "" : "s"} ready.</strong>{" "}
          {latest ? (hasChanges ? <span className="muted">Changes since version {latest.version}:</span> : <span className="muted">Identical to version {latest.version}.</span>) : <span className="muted">This will be the first version.</span>}
          {(latest ? hasChanges : approved.length > 0) && (
            <ul className="diff">
              {(latest ? added : approved).map((p) => <li key={p.id} className="add">+ {p.label ?? p.raw_id} → <NodeName segtax={p.target.segtax} id={p.target.id} /> <span className="muted">(IAB {p.target.id})</span></li>)}
              {changed.map((p) => <li key={p.id} className="chg">~ {p.label ?? p.raw_id} → IAB {p.target.id}</li>)}
              {removed.map((m) => <li key={m.raw_id} className="del">− {m.raw_id} (revoked)</li>)}
            </ul>
          )}
          {pending > 0 && <p className="warn small">{pending} signal{pending === 1 ? " is" : "s are"} still waiting for review and won&apos;t be included.</p>}
        </div>
        <RoleButton role="reviewer" className={latest && !hasChanges ? "btn" : "btn primary"} disabled={approved.length === 0 && !latest} onClick={publishAndActivate}>
          {latest ? `Publish version ${latest.version + 1} and make it live` : "Publish and make live"}
        </RoleButton>
      </div>

      {data.versions.length > 0 && (
        <table className="table">
          <thead><tr><th>Version</th><th>Mappings</th><th>Published by</th><th>Fingerprint</th><th></th></tr></thead>
          <tbody>
            {data.versions.map((v) => (
              <Fragment key={v.version}>
                <tr className={v.active ? "row-live" : ""}>
                  <td><strong>v{v.version}</strong> {v.active && <Tag tone="ok">Live</Tag>}</td>
                  <td><button className="link-btn" onClick={() => setOpen(open === v.version ? null : v.version)}>{v.entries} mapping{v.entries === 1 ? "" : "s"}</button></td>
                  <td className="muted">{v.created_by}<div className="small">{new Date(v.created_at).toLocaleString()}</div></td>
                  <td><code title={v.snapshot_hash}>{String(v.snapshot_hash).slice(0, 10)}…</code></td>
                  <td className="right">
                    {!v.active && confirm !== v.version && (
                      <button className="btn small" onClick={() => setConfirm(v.version)}>{live && v.version < live.version ? "Roll back to this" : "Make live"}</button>
                    )}
                    {confirm === v.version && (
                      <span className="confirm">
                        <span className="small">Buyers will get v{v.version}&apos;s mappings immediately.</span>
                        <RoleButton role="reviewer" className="btn primary small" onClick={() => { setConfirm(null); act(`Version ${v.version} is now live.`, () => activateVersion(v.version), REVIEWER); }}>Confirm</RoleButton>
                        <button className="btn ghost small" onClick={() => setConfirm(null)}>Cancel</button>
                      </span>
                    )}
                  </td>
                </tr>
                {open === v.version && (
                  <tr key={`${v.version}-m`} className="row-detail">
                    <td colSpan={5}>
                      <ul className="small plain">
                        {(v.mappings ?? []).map((m: Json) => (
                          <li key={m.field + m.raw_id}><code>{m.raw_id}</code> → <NodeName segtax={m.target_segtax} id={m.target_id} /> <span className="muted">(segtax {m.target_segtax}, ID {m.target_id}, {m.match_type ?? "reviewer"})</span></li>
                        ))}
                      </ul>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
