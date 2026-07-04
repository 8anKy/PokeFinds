/** Gemensam felhantering för API-routes. */
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { AuthError } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";

export function apiError(error: unknown): NextResponse {
  if (error instanceof AuthError || error instanceof ServiceError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return NextResponse.json({ error: "Posten finns redan." }, { status: 409 });
    }
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Posten hittades inte." }, { status: 404 });
    }
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { error: "Ogiltig indata.", details: error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  console.error("API-fel:", error);
  return NextResponse.json({ error: "Något gick fel. Försök igen." }, { status: 500 });
}

export function jsonOk<T>(data: T, init?: ResponseInit) {
  return NextResponse.json(data as Record<string, unknown> | unknown[], init);
}

/**
 * Som `jsonOk` men med cache-header. ENDAST för publik, opersonlig data.
 * `max-age` låter webbläsaren återanvända svaret (Railway har ingen CDN, så
 * s-maxage ensam gjorde INGENTING där — varje träff blev en Neon-fråga);
 * `s-maxage` behålls ifall en CDN sätts framför senare. Datat ändras ~1×/dygn
 * så sekunder–minuter av webbläsar-cache är osynligt för användaren.
 * Routen får INTE ha `export const dynamic = "force-dynamic"` (sätter no-store).
 */
export function jsonCached<T>(data: T, sMaxAgeSeconds: number, init?: ResponseInit) {
  return NextResponse.json(data as Record<string, unknown> | unknown[], {
    ...init,
    headers: {
      ...init?.headers,
      "Cache-Control": `public, max-age=${sMaxAgeSeconds}, s-maxage=${sMaxAgeSeconds}, stale-while-revalidate=${sMaxAgeSeconds * 5}`,
    },
  });
}
