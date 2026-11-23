import { cookies } from "next/headers";
import { prisma } from "@/lib/db/client";
import { SESSION_COOKIE, verifySession } from "./session";

/** Server components: the signed-in demo persona, or null. */
export async function currentUser() {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  const claims = await verifySession(token);
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.sub }, include: { publishers: true } });
  if (!user || user.tenantId !== claims.tid) return null;
  return { persona: user.persona, displayName: user.displayName, role: user.role, publisherIds: user.publishers.map((p) => p.publisherId) };
}
