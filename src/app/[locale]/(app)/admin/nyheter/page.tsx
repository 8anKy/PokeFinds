import { auth, hasRole } from "@/lib/auth";
import { readInbox } from "@/lib/feed-inbox-store";
import { AdminRequired } from "../admin-required";
import { NewsInboxClient } from "./inbox-client";

export const dynamic = "force-dynamic";

/**
 * NYHETSINKORGEN: utkast den dagliga AI-rutinen skrivit (webbsök + butikernas
 * nyhetsbrev), som ägaren rättar, ger bild och godkänner — eller avvisar.
 * Bakgrunden står i `src/lib/feed-inbox.ts`. ⛔ Sidan läser en FIL på volymen,
 * ingen tabell — här finns ingen `prisma`-import, med flit.
 */
export default async function AdminNewsInboxPage() {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const inbox = await readInbox();
  return <NewsInboxClient initial={inbox} />;
}
