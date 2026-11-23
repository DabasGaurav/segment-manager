/**
 * Grants, immutable mapping versions (snapshots), activation/rollback.
 */
import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "@/lib/db/client";
import type { Principal } from "@/lib/auth/principal";
import { ApiError } from "@/lib/http/problem";
import { targetAllowed } from "@/lib/mapping/mapper";
import type { SignalClass } from "@/lib/openrtb/detect";
import type { Registry } from "@/lib/taxonomy/registry";
import { audit } from "./audit";

// ---------------------------------------------------------------- grants

export const grantSchema = z
  .object({
    level: z.enum(["G0", "G1", "G2", "G3"]),
    dsp_allowlist: z.array(z.string().regex(/^[a-z0-9_-]{1,40}$/)).max(50),
    curator_allowlist: z.array(z.string().regex(/^[a-z0-9_.-]{1,60}$/)).max(50).default([]),
    unmapped_handling: z.enum(["drop", "pass_raw"]),
    consent_basis_note: z.string().max(1000).nullish(),
  })
  .strict();

export function serializeGrant(g: { level: string; dspAllowlist: string[]; curatorAllowlist: string[]; unmappedHandling: string; consentBasisNote: string | null; attestedBy: string | null; attestedAt: Date | null; updatedAt: Date } | null) {
  if (!g) return { level: "G0", dsp_allowlist: [], curator_allowlist: [], unmapped_handling: "pass_raw", consent_basis_note: null, attested_by: null, attested_at: null };
  return {
    level: g.level,
    dsp_allowlist: g.dspAllowlist,
    curator_allowlist: g.curatorAllowlist,
    unmapped_handling: g.unmappedHandling,
    consent_basis_note: g.consentBasisNote,
    attested_by: g.attestedBy,
    attested_at: g.attestedAt,
    updated_at: g.updatedAt,
  };
}

export async function putGrant(actor: Principal, publisherId: string, body: z.infer<typeof grantSchema>) {
  if (body.level === "G0" && body.dsp_allowlist.length > 0) {
    throw new ApiError(422, "GRANT_INCONSISTENT", "G0 means not onboarded; it cannot carry a DSP allowlist.");
  }
  if (body.level !== "G0" && body.dsp_allowlist.length === 0) {
    throw new ApiError(422, "GRANT_INCONSISTENT", "G1+ needs at least one DSP in the allowlist.");
  }
  const attestedBy = actor.kind === "user" ? `${actor.persona} (${actor.role})` : actor.name;
  return prisma.$transaction(async (tx) => {
    const before = await tx.grant.findUnique({ where: { publisherId } });
    const data = {
      level: body.level,
      dspAllowlist: [...new Set(body.dsp_allowlist)].sort(),
      curatorAllowlist: [...new Set(body.curator_allowlist)].sort(),
      unmappedHandling: body.unmapped_handling,
      consentBasisNote: body.consent_basis_note ?? null,
      attestedBy,
      attestedAt: new Date(),
    };
    const g = await tx.grant.upsert({ where: { publisherId }, update: data, create: { publisherId, ...data } });
    await audit(tx, actor, {
      publisherId,
      action: "grant.updated",
      entityType: "grant",
      entityId: publisherId,
      before: before ? (serializeGrant(before) as unknown as Prisma.InputJsonValue) : null,
      after: serializeGrant(g) as unknown as Prisma.InputJsonValue,
    });
    return serializeGrant(g);
  });
}

// ---------------------------------------------------------------- snapshots

export interface SnapshotEntry {
  field: "content" | "user";
  raw_id: string;
  signal_class: SignalClass;
  target_segtax: number;
  target_id: string;
  match_type: string | null;
  reason_codes: string[];
  proposal_id: string;
}
export interface Snapshot {
  format: "segment-manager/snapshot@1";
  publisher_id: string;
  entries: SnapshotEntry[];
}

/** Canonical JSON (sorted keys) so equal content always hashes equally. */
export function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v as object)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical((v as Record<string, unknown>)[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v);
}

export const snapshotHash = (s: Snapshot) => createHash("sha256").update(canonical({ ...s, entries: s.entries.map(({ proposal_id: _p, ...rest }) => rest) })).digest("hex");

const MAPPING_CODES = new Set(["EXACT_MATCH", "LOSSY_BROADER_MATCH", "LEXICAL_CANDIDATE", "PROMOTION_REJECTED", "CROSS_VERSION_SAME_ID_AND_NAME"]);

export async function compileSnapshot(reg: Registry, publisherId: string): Promise<Snapshot> {
  const approved = await prisma.proposal.findMany({ where: { publisherId, status: "APPROVED" }, orderBy: [{ field: "asc" }, { rawId: "asc" }] });
  const entries: SnapshotEntry[] = [];
  for (const p of approved) {
    if (p.targetSegtax === null || p.targetId === null || !p.signalClass) {
      throw new ApiError(422, "INVALID_TAXONOMY_ID", `Approved proposal ${p.id} has no target.`);
    }
    // Publish-time re-validation against the official files and policy.
    const ok = targetAllowed(reg, p.signalClass, p.targetSegtax, p.targetId);
    if (!ok.ok) throw new ApiError(422, ok.code, `Approved mapping ${p.rawId} -> ${p.targetSegtax}/${p.targetId} fails validation (${ok.code}).`);
    entries.push({
      field: p.field as "content" | "user",
      raw_id: p.rawId,
      signal_class: p.signalClass,
      target_segtax: p.targetSegtax,
      target_id: p.targetId,
      match_type: p.matchType,
      reason_codes: p.reasonCodes.filter((c) => MAPPING_CODES.has(c)),
      proposal_id: p.id,
    });
  }
  return { format: "segment-manager/snapshot@1", publisher_id: publisherId, entries };
}

export function serializeVersion(v: { number: number; snapshotHash: string; createdBy: string; createdAt: Date; snapshot: unknown }, active: number | null, withEntries = false) {
  const snap = v.snapshot as Snapshot;
  return {
    version: v.number,
    snapshot_hash: v.snapshotHash,
    entries: snap.entries.length,
    active: active === v.number,
    created_by: v.createdBy,
    created_at: v.createdAt,
    ...(withEntries ? { mappings: snap.entries.map(({ proposal_id: _p, ...e }) => e) } : {}),
  };
}

function diff(prev: Snapshot | null, next: Snapshot) {
  const key = (e: SnapshotEntry) => `${e.field}|${e.raw_id}`;
  const before = new Map((prev?.entries ?? []).map((e) => [key(e), e]));
  const after = new Map(next.entries.map((e) => [key(e), e]));
  const added = [...after.keys()].filter((k) => !before.has(k));
  const removed = [...before.keys()].filter((k) => !after.has(k));
  const changed = [...after.keys()].filter((k) => before.has(k) && `${before.get(k)!.target_segtax}/${before.get(k)!.target_id}` !== `${after.get(k)!.target_segtax}/${after.get(k)!.target_id}`);
  return { added, removed, changed };
}

export async function publish(reg: Registry, actor: Principal, publisherId: string) {
  const snapshot = await compileSnapshot(reg, publisherId);
  const hash = snapshotHash(snapshot);
  const by = actor.kind === "user" ? `${actor.persona} (${actor.role})` : actor.name;
  try {
    return await prisma.$transaction(async (tx) => {
      const last = await tx.mappingVersion.findFirst({ where: { publisherId }, orderBy: { number: "desc" } });
      const number = (last?.number ?? 0) + 1;
      // The (publisherId, number) unique key makes concurrent publishes safe: one wins, the other 409s.
      const v = await tx.mappingVersion.create({
        data: { publisherId, number, snapshot: snapshot as unknown as Prisma.InputJsonValue, snapshotHash: hash, createdBy: by },
      });
      const d = diff((last?.snapshot as unknown as Snapshot) ?? null, snapshot);
      await audit(tx, actor, { publisherId, action: "version.published", entityType: "mapping_version", entityId: String(number), mappingVersion: number, after: { snapshot_hash: hash, entries: snapshot.entries.length, diff: d } });
      const pub = await tx.publisher.findUniqueOrThrow({ where: { id: publisherId } });
      return { ...serializeVersion(v, pub.activeVersionNumber), diff: d };
    });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      throw new ApiError(409, "VERSION_CONFLICT", "Another publish happened at the same moment; retry.");
    }
    throw e;
  }
}

export async function activate(actor: Principal, publisherId: string, version: number) {
  return prisma.$transaction(async (tx) => {
    const v = await tx.mappingVersion.findUnique({ where: { publisherId_number: { publisherId, number: version } } });
    if (!v) throw new ApiError(404, "VERSION_NOT_FOUND", `Version ${version} does not exist for this publisher.`);
    const pub = await tx.publisher.findUniqueOrThrow({ where: { id: publisherId } });
    const before = pub.activeVersionNumber;
    if (before !== version) {
      await tx.publisher.update({ where: { id: publisherId }, data: { activeVersionNumber: version } });
      await audit(tx, actor, {
        publisherId,
        action: before !== null && version < before ? "version.rolled_back" : "version.activated",
        entityType: "mapping_version",
        entityId: String(version),
        mappingVersion: version,
        before: { active_version: before },
        after: { active_version: version, snapshot_hash: v.snapshotHash },
      });
    }
    return { active_version: version, previous_version: before, snapshot_hash: v.snapshotHash, changed: before !== version };
  });
}
