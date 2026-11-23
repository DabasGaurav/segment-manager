/**
 * /v1/resolve orchestration: envelope -> load publisher, grant, active snapshot -> resolveRequest -> audit.
 * HTTP errors only for envelope/auth problems (4xx) and when nothing safe can be computed (503).
 */
import { prisma } from "@/lib/db/client";
import type { Principal } from "@/lib/auth/principal";
import { ApiError } from "@/lib/http/problem";
import { parseEnvelope } from "@/lib/openrtb/envelope";
import { resolveRequest, type ResolveContext } from "@/lib/resolve/resolve";
import { getRegistry } from "@/lib/taxonomy/registry";
import type { Snapshot } from "./versions";
import { audit, hashRequestId } from "./audit";

export async function runResolve(principal: Principal, rawBody: string, via: "api" | "lab") {
  const env = parseEnvelope(rawBody);
  if (!env.ok) throw new ApiError(env.status, env.code, env.detail, env.errors);
  const { publisher_id, dsp, bid_request } = env.value;

  let reg;
  try {
    reg = getRegistry();
  } catch {
    throw new ApiError(503, "SNAPSHOT_UNAVAILABLE", "Taxonomy files failed verification; nothing safe can be returned.", undefined, { "retry-after": "30" });
  }

  let ctx: ResolveContext;
  try {
    const pub = await prisma.publisher.findFirst({ where: { id: publisher_id, tenantId: principal.tenantId }, include: { grant: true } });
    let snapshot: Snapshot | null = null;
    let snapshotHash: string | null = null;
    if (pub?.activeVersionNumber) {
      const v = await prisma.mappingVersion.findUnique({ where: { publisherId_number: { publisherId: pub.id, number: pub.activeVersionNumber } } });
      if (!v) throw new Error("active version missing");
      snapshot = v.snapshot as unknown as Snapshot;
      snapshotHash = v.snapshotHash;
    }
    // IDs a reviewer can never map (sensitive). Loaded live, so they are removed even before any version is published.
    const blocked = pub
      ? (await prisma.proposal.findMany({ where: { publisherId: pub.id, status: "BLOCKED" }, select: { field: true, rawId: true } })).map((b) => `${b.field}|${b.rawId}`)
      : [];
    ctx = {
      blockedIds: blocked,
      publisher: pub ? { id: pub.id, domain: pub.domain } : null,
      grant: pub?.grant ? { level: pub.grant.level, dspAllowlist: pub.grant.dspAllowlist, unmappedHandling: pub.grant.unmappedHandling } : null,
      snapshot,
      snapshotHash,
      mappingVersion: pub?.activeVersionNumber ?? null,
      dsp,
    };
  } catch (e) {
    console.error("[resolve] snapshot load failed", e);
    throw new ApiError(503, "SNAPSHOT_UNAVAILABLE", "Mapping snapshot could not be loaded. Callers must strip all Data objects before forwarding.", undefined, { "retry-after": "30" });
  }

  const started = performance.now();
  const result = resolveRequest(reg, bid_request, ctx);
  const elapsed = Math.round((performance.now() - started) * 1000) / 1000;

  // Data minimisation: the audit row holds a hash of the bid request id, counts and versions only.
  try {
    await audit(prisma, principal, {
      publisherId: ctx.publisher?.id ?? null,
      action: "resolve.executed",
      entityType: "bid_request",
      requestIdHash: typeof bid_request.id === "string" ? hashRequestId(bid_request.id) : null,
      mappingVersion: ctx.mappingVersion,
      after: { via, dsp, status: result.status, summary: result.summary, policy_rule: result.policy?.rule ?? null },
    });
  } catch (e) {
    console.error("[resolve] audit write failed", e);
  }

  return { ...result, timing: { resolver_ms_local: elapsed, note: "Measured in this demo server, not production." } };
}
