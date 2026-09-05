/** Gemensam felhantering för API-routes. */
import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { ZodError } from "zod";
import { Prisma } from "@prisma/client";
import { cookies, headers } from "next/headers";
import { getTranslations } from "next-intl/server";
import { AuthError } from "@/lib/auth";
import { ServiceError } from "@/lib/errors";
import { apiErrorKeyFor } from "@/lib/api-error-i18n";

/**
 * Anroparens språk. Middleware kör inte på /api, så next-intls getLocale() vet
 * inget här — cookien NEXT_LOCALE (skrivs av språkväljaren) är facit, referer-
 * vägen (/en/…) reserven, svenska standard. Utanför en request-scope (jobb) ⇒ sv.
 */
function requestLocale(): "sv" | "en" {
  try {
    const c = cookies().get("NEXT_LOCALE")?.value;
    if (c === "en" || c === "sv") return c;
    const ref = headers().get("referer") ?? "";
    if (/^https?:\/\/[^/]+\/en(\/|$|\?)/.test(ref)) return "en";
  } catch {
    /* ingen request-scope */
  }
  return "sv";
}

/**
 * Svensk feltext → (kod, text på anroparens språk). Tabellen bor i
 * lib/api-error-i18n.ts; en text som saknas där går ut orörd (hellre svenska än
 * en rå nyckel). Koden följer alltid med när den finns.
 */
async function localize(message: string, explicitCode?: string): Promise<{ error: string; code?: string }> {
  const key = apiErrorKeyFor(message);
  const code = explicitCode ?? key ?? undefined;
  if (!key || requestLocale() === "sv") return code ? { error: message, code } : { error: message };
  try {
    const t = await getTranslations({ locale: "en", namespace: "ApiErrors" });
    return { error: t(key), code };
  } catch {
    return code ? { error: message, code } : { error: message };
  }
}

export async function apiError(error: unknown): Promise<NextResponse> {
  if (error instanceof AuthError || error instanceof ServiceError) {
    const explicit = error instanceof ServiceError ? error.code : undefined;
    return NextResponse.json(await localize(error.message, explicit), { status: error.status });
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === "P2002") {
      return NextResponse.json(await localize("Posten finns redan."), { status: 409 });
    }
    if (error.code === "P2025") {
      return NextResponse.json(await localize("Posten hittades inte."), { status: 404 });
    }
  }
  if (error instanceof ZodError) {
    return NextResponse.json(
      { ...(await localize("Ogiltig indata.")), details: error.flatten().fieldErrors },
      { status: 400 }
    );
  }
  console.error("API-fel:", error);
  // Okända 500-fel når aldrig Next (vi fångar och svarar JSON), så `onRequestError`/
  // captureRequestError kan inte se dem — utan raden här är API-fel OSYNLIGA för
  // Sentry. Väntade fel ovanför (ServiceError/Auth/Zod/Prisma-koder) rapporteras
  // inte: de är användarfel, inte buggar. No-op när Sentry inte är initierad (dev).
  Sentry.captureException(error);
  return NextResponse.json(await localize("Något gick fel. Försök igen."), { status: 500 });
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
