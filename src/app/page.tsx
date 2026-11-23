import { prisma } from "@/lib/db/client";
import { currentUser } from "@/lib/auth/current-user";
import { demoModeEnabled } from "@/lib/auth/session";
import { App } from "./_ui/App";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await currentUser();
  let personas: { persona: string; displayName: string; role: string; publishers: string[] }[] = [];
  if (demoModeEnabled()) {
    try {
      personas = (await prisma.user.findMany({ where: { isDemo: true }, include: { publishers: true }, orderBy: { id: "asc" } })).map((u) => ({
        persona: u.persona,
        displayName: u.displayName,
        role: u.role,
        publishers: u.publishers.map((p) => p.publisherId),
      }));
    } catch {
      personas = [];
    }
  }
  // DriveDesk's two roles first: they are the ones the workflow needs.
  const order = ["ops.drivedesk", "reviewer.drivedesk"];
  personas.sort((a, b) => (order.indexOf(a.persona) + 1 || 9) - (order.indexOf(b.persona) + 1 || 9));
  return <App personas={personas} initialPersona={user?.persona ?? null} demoMode={demoModeEnabled()} />;
}
