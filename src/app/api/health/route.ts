import { prisma } from "@/lib/db/client";
import { getRegistry } from "@/lib/taxonomy/registry";
import { handler, json } from "@/lib/http/problem";

export const dynamic = "force-dynamic";

/** Public liveness/readiness check. Reveals no tenant data. */
export const GET = handler(async (_req, _ctx, requestId) => {
  let database: "ok" | "unavailable" = "ok";
  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    database = "unavailable";
  }
  let taxonomies: { key: string; segtax: number; nodes: number; sha256_verified: boolean }[] = [];
  let taxonomyStatus: "verified" | "failed" = "verified";
  try {
    taxonomies = [...getRegistry().byKey.values()].map((t) => ({ key: t.key, segtax: t.segtax, nodes: t.nodes.size, sha256_verified: true }));
  } catch {
    taxonomyStatus = "failed";
  }
  const ok = database === "ok" && taxonomyStatus === "verified";
  return json(requestId, { status: ok ? "ok" : "degraded", database, taxonomy_files: taxonomyStatus, taxonomies }, ok ? 200 : 503);
});
