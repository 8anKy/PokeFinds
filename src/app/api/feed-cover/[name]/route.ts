/**
 * GET /api/feed-cover/[name] — serverar ett omslag ägaren laddat upp till en
 * nyhet (se `feed-inbox-store.ts`). Publik, DB-fri, en filläsning från volymen.
 * Namnet är slumpat per uppladdning ⇒ innehållet bakom en URL ändras aldrig, så
 * cachen får vara lång och oföränderlig.
 */
import { NextResponse } from "next/server";
import { coverContentType, readCover } from "@/lib/feed-inbox-store";

export const dynamic = "force-dynamic";

export async function GET(_req: Request, { params }: { params: { name: string } }) {
  const bytes = await readCover(params.name);
  if (!bytes) return new NextResponse("Not found", { status: 404 });
  return new NextResponse(new Uint8Array(bytes), {
    headers: {
      "content-type": coverContentType(params.name),
      "cache-control": "public, max-age=31536000, immutable",
    },
  });
}
