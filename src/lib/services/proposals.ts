/**
 * Dictionary imports, mapping proposals and review decisions (control plane).
 */
import { createHash } from "node:crypto";
import { Prisma, type Proposal, type SignalClass } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import type { Principal } from "@/lib/auth/principal";
import { ApiError } from "@/lib/http/problem";
import { detectSignals, isPlainObject } from "@/lib/openrtb/detect";
import { abstainUnknown, expectedFieldFor, INTENT_SOURCES, mapEntry, targetAllowed, type DictionaryEntryInput, type ProposalDraft } from "@/lib/mapping/mapper";
import { isSensitiveLabel } from "@/lib/policy/sensitive";
import type { Registry } from "@/lib/taxonomy/registry";
import { audit } from "./audit";

const CLASSES = ["CONTENT_TOPIC", "AUDIENCE_INTEREST", "PURCHASE_INTENT", "DEMOGRAPHIC"] as const;

export const importSchema = z
  .object({
    entries: z
      .array(
        z
          .object({
            raw_id: z.string().min(1).max(256),
            field: z.enum(["content", "user"]),
            label: z.string().min(1).max(200),
            description: z.string().max(500).nullish(),
            declared_class: z.enum(CLASSES),
            declared_source: z.string().regex(/^[a-z_]{1,60}$/).nullish(),
            declared_standard: z.object({ segtax: z.number().int(), id: z.string().regex(/^[A-Za-z0-9]{1,16}$/) }).strict().nullish(),
          })
          .strict(),
      )
      .max(500),
    samples: z.array(z.record(z.string(), z.unknown())).max(20).default([]),
  })
  .strict();
export type ImportBody = z.infer<typeof importSchema>;

export function serializeProposal(p: Proposal) {
  return {
    id: p.id,
    raw_id: p.rawId,
    field: p.field,
    label: p.label,
    signal_class: p.signalClass,
    status: p.status,
    method: p.method,
    target: p.targetSegtax !== null && p.targetId !== null ? { segtax: p.targetSegtax, id: p.targetId } : null,
    match_type: p.matchType,
    match_score: p.matchScore,
    candidates: p.candidates,
    reason_codes: p.reasonCodes,
    decided_by: p.decidedBy,
    decided_at: p.decidedAt,
    decision_note: p.decisionNote,
    row_version: p.rowVersion,
    created_at: p.createdAt,
  };
}

const ACTIVE: Proposal["status"][] = ["PENDING_REVIEW", "APPROVED", "ABSTAINED", "BLOCKED"];

function sameEntry(a: { label: string; description: string | null; declaredClass: SignalClass; declaredSource: string | null; declaredStandard: unknown }, b: DictionaryEntryInput) {
  return (
    a.label === b.label &&
    (a.description ?? null) === (b.description ?? null) &&
    a.declaredClass === b.declared_class &&
    (a.declaredSource ?? null) === (b.declared_source ?? null) &&
    JSON.stringify(a.declaredStandard ?? null) === JSON.stringify(b.declared_standard ?? null)
  );
}

export async function createImport(reg: Registry, actor: Principal, publisher: { id: string; domain: string; tenantId: string }, body: ImportBody, idempotencyKey: string | null) {
  // --- semantic validation (whole import rejected, nothing stored) ---
  const errors: { path: string; message: string }[] = [];
  const seen = new Set<string>();
  body.entries.forEach((e, i) => {
    if (expectedFieldFor(e.declared_class) !== e.field) {
      errors.push({ path: `entries.${i}`, message: `CLASS_FIELD_MISMATCH: ${e.declared_class} signals belong in ${expectedFieldFor(e.declared_class) === "content" ? "site/app.content.data" : "user.data"}` });
    }
    const k = `${e.field}|${e.raw_id}`;
    if (seen.has(k)) errors.push({ path: `entries.${i}`, message: `DUPLICATE_ENTRY: ${e.raw_id} appears twice for ${e.field}` });
    seen.add(k);
  });
  if (errors.length) throw new ApiError(422, "CLASS_FIELD_MISMATCH", "Some entries are inconsistent; nothing was imported.", errors);

  const requestHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  if (idempotencyKey) {
    const prior = await prisma.import.findUnique({ where: { publisherId_idempotencyKey: { publisherId: publisher.id, idempotencyKey } } });
    if (prior) {
      if (prior.requestHash !== requestHash) throw new ApiError(409, "IDEMPOTENCY_KEY_REUSED", "This Idempotency-Key was used with a different body.");
      return { replayed: true, import_id: prior.id, summary: prior.summary };
    }
  }

  // --- detection over samples: only this publisher's own proprietary IDs become proposals ---
  const sampleIds = new Map<string, { raw_id: string; field: "content" | "user" }>();
  const sampleReports = body.samples.map((s, i) => {
    if (!isPlainObject(s)) return { sample: i, error: "not an object" };
    const r = detectSignals(reg, s);
    let thirdParty = 0;
    for (const o of r.data_objects) {
      for (const seg of o.segments) {
        if (seg.status !== "PROPRIETARY" || !seg.raw_id) continue;
        if (o.provider_name !== publisher.domain) {
          thirdParty++;
          continue;
        }
        const field = o.location_class === "content" ? "content" : "user";
        sampleIds.set(`${field}|${seg.raw_id}`, { raw_id: seg.raw_id, field });
      }
    }
    return { sample: i, summary: r.summary, third_party_proprietary_ignored: thirdParty, info: r.info };
  });

  return prisma.$transaction(async (tx) => {
    const imp = await tx.import.create({
      data: { publisherId: publisher.id, idempotencyKey, requestHash, createdBy: actorName(actor), summary: {} },
    });
    const created: Proposal[] = [];
    let unchanged = 0;

    const supersede = async (field: string, rawId: string) => {
      await tx.proposal.updateMany({
        where: { publisherId: publisher.id, field, rawId, status: { in: ACTIVE } },
        data: { status: "SUPERSEDED", rowVersion: { increment: 1 } },
      });
    };
    const insert = async (d: ProposalDraft, dictionaryEntryId: string | null) => {
      const p = await tx.proposal.create({
        data: {
          publisherId: publisher.id,
          dictionaryEntryId,
          importId: imp.id,
          rawId: d.raw_id,
          field: d.field,
          label: d.label,
          signalClass: d.signal_class,
          status: d.status,
          method: d.method,
          targetSegtax: d.target?.segtax ?? null,
          targetId: d.target?.id ?? null,
          matchType: d.match_type,
          matchScore: d.match_score,
          candidates: d.candidates as unknown as Prisma.InputJsonValue,
          reasonCodes: d.reason_codes,
          decidedBy: d.auto_approved ? "system:auto (exact match)" : null,
          decidedAt: d.auto_approved ? new Date() : null,
        },
      });
      created.push(p);
    };

    for (const e of body.entries as DictionaryEntryInput[]) {
      const existing = await tx.proposal.findFirst({
        where: { publisherId: publisher.id, field: e.field, rawId: e.raw_id, status: { in: ACTIVE }, dictionaryEntryId: { not: null } },
        include: { dictionaryEntry: true },
        orderBy: { createdAt: "desc" },
      });
      if (existing?.dictionaryEntry && sameEntry(existing.dictionaryEntry, e)) {
        unchanged++;
        continue; // keep the existing proposal and any decision already made on it
      }
      await supersede(e.field, e.raw_id);
      const entry = await tx.dictionaryEntry.create({
        data: {
          publisherId: publisher.id,
          importId: imp.id,
          rawId: e.raw_id,
          field: e.field,
          label: e.label,
          description: e.description ?? null,
          declaredClass: e.declared_class,
          declaredSource: e.declared_source ?? null,
          declaredStandard: (e.declared_standard ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
      await insert(mapEntry(reg, e), entry.id);
    }
    for (const [k, s] of sampleIds) {
      if (seen.has(k)) continue;
      const any = await tx.proposal.findFirst({ where: { publisherId: publisher.id, field: s.field, rawId: s.raw_id, status: { in: ACTIVE } } });
      if (any) {
        unchanged++;
        continue;
      }
      await insert(abstainUnknown(s.raw_id, s.field), null);
    }

    const summary = {
      entries: body.entries.length,
      samples: body.samples.length,
      proposals_created: created.length,
      unchanged,
      auto_approved: created.filter((p) => p.status === "APPROVED").length,
      pending_review: created.filter((p) => p.status === "PENDING_REVIEW").length,
      blocked: created.filter((p) => p.status === "BLOCKED").length,
      abstained: created.filter((p) => p.status === "ABSTAINED").length,
    };
    await tx.import.update({ where: { id: imp.id }, data: { summary } });
    await audit(tx, actor, { publisherId: publisher.id, action: "import.created", entityType: "import", entityId: imp.id, after: summary });
    return { replayed: false, import_id: imp.id, summary, samples: sampleReports, proposals: created.map(serializeProposal) };
  });
}

export function actorName(p: Principal): string {
  return p.kind === "user" ? `${p.persona} (${p.role})` : `${p.name} (${p.role})`;
}

// ---------------------------------------------------------------- decisions

export const decisionSchema = z
  .object({
    action: z.enum(["approve", "choose_other", "abstain", "revoke"]),
    target: z.object({ segtax: z.number().int(), id: z.string().regex(/^[A-Za-z0-9]{1,16}$/) }).strict().optional(),
    reclassify_to: z.enum(["CONTENT_TOPIC", "AUDIENCE_INTEREST", "PURCHASE_INTENT"]).optional(),
    note: z.string().max(500).optional(),
    row_version: z.number().int().min(0),
  })
  .strict();
export type DecisionBody = z.infer<typeof decisionSchema>;

/**
 * Review decision with optimistic concurrency: the update only applies if the proposal is still in the
 * state and row_version the reviewer saw. Two reviewers racing -> exactly one wins, the other gets 409.
 */
export async function decide(reg: Registry, actor: Principal, publisherId: string, proposalId: string, body: DecisionBody) {
  const p = await prisma.proposal.findFirst({ where: { id: proposalId, publisherId }, include: { dictionaryEntry: true } });
  if (!p) throw new ApiError(404, "PROPOSAL_NOT_FOUND", "Proposal not found.");

  if (p.status === "BLOCKED") throw new ApiError(422, "SENSITIVE_OVERRIDE_FORBIDDEN", "Sensitive-category blocks cannot be overridden by a reviewer.");
  if (body.action === "revoke") {
    if (p.status !== "APPROVED") throw new ApiError(409, "PROPOSAL_NOT_APPROVED", "Only an approved mapping can be revoked.");
  } else if (p.status !== "PENDING_REVIEW") {
    throw new ApiError(409, "PROPOSAL_ALREADY_DECIDED", `This proposal is ${p.status}.`);
  }
  if (p.rowVersion !== body.row_version) throw new ApiError(409, "VERSION_CONFLICT", "Someone changed this proposal; reload and try again.");

  let status: Proposal["status"];
  let target: { segtax: number; id: string } | null = p.targetSegtax !== null && p.targetId !== null ? { segtax: p.targetSegtax, id: p.targetId } : null;
  let cls = p.signalClass;
  let matchType = p.matchType;
  const codes = [...p.reasonCodes];

  if (body.action === "abstain") {
    status = "ABSTAINED";
    target = null;
    codes.push("REVIEWER_ABSTAINED");
  } else if (body.action === "revoke") {
    status = "REVOKED";
    codes.push("REVOKED_BY_REVIEWER");
  } else {
    if (body.action === "choose_other") {
      if (!body.target) throw new ApiError(400, "SCHEMA_VIOLATION", "choose_other needs a target { segtax, id }.");
      target = body.target;
      matchType = "reviewer_selected";
      if (body.reclassify_to) {
        if (expectedFieldFor(body.reclassify_to) !== p.field) throw new ApiError(422, "CLASS_FIELD_MISMATCH", `${body.reclassify_to} cannot live in ${p.field}.`);
        if (p.signalClass === "PURCHASE_INTENT" && body.reclassify_to !== "PURCHASE_INTENT") codes.push("PROMOTION_REJECTED");
        cls = body.reclassify_to;
      }
    } else if (!target) {
      throw new ApiError(422, "NO_TARGET", "This proposal has no target to approve; use choose_other with a target, or abstain.");
    }
    if (!cls) throw new ApiError(422, "CLASS_REQUIRED", "Set reclassify_to: the signal class is unknown for this ID.");
    if (isSensitiveLabel(p.label, p.dictionaryEntry?.description, p.rawId)) {
      throw new ApiError(422, "SENSITIVE_OVERRIDE_FORBIDDEN", "This entry matches the sensitive-category policy.");
    }
    const ok = targetAllowed(reg, cls, target!.segtax, target!.id);
    if (!ok.ok) {
      throw new ApiError(422, ok.code, `Target ${target!.segtax}/${target!.id} is not allowed for ${cls}: ${ok.code}.`);
    }
    if (cls === "PURCHASE_INTENT" && !INTENT_SOURCES.includes((p.dictionaryEntry?.declaredSource ?? "") as (typeof INTENT_SOURCES)[number])) {
      throw new ApiError(
        422,
        "INTENT_SOURCE_REQUIRED",
        `Purchase-intent mappings need a declared intent-type source (${INTENT_SOURCES.join(", ")}). This entry's source is "${p.dictionaryEntry?.declaredSource ?? "none"}". Choose an Interest node instead (reclassify_to AUDIENCE_INTEREST).`,
      );
    }
    status = "APPROVED";
    codes.push("REVIEWER_APPROVED");
  }

  return prisma.$transaction(async (tx) => {
    const res = await tx.proposal.updateMany({
      where: { id: p.id, rowVersion: body.row_version, status: p.status },
      data: {
        status,
        targetSegtax: target?.segtax ?? null,
        targetId: target?.id ?? null,
        signalClass: cls,
        matchType,
        reasonCodes: [...new Set(codes)],
        decidedBy: actorName(actor),
        decidedAt: new Date(),
        decisionNote: body.note ?? null,
        rowVersion: { increment: 1 },
      },
    });
    if (res.count !== 1) throw new ApiError(409, "VERSION_CONFLICT", "Someone decided this proposal first; reload and try again.");
    const after = await tx.proposal.findUniqueOrThrow({ where: { id: p.id } });
    await audit(tx, actor, {
      publisherId,
      action: `proposal.${body.action}`,
      entityType: "proposal",
      entityId: p.id,
      before: { status: p.status, target: p.targetId ? `${p.targetSegtax}/${p.targetId}` : null, class: p.signalClass },
      after: { status: after.status, target: after.targetId ? `${after.targetSegtax}/${after.targetId}` : null, class: after.signalClass, note: body.note ?? null },
    });
    return serializeProposal(after);
  });
}
