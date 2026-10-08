/**
 * POST /api/cron/engine-sync — håller skannermotorns kortdata ikapp katalogen (2026-09-30).
 *
 * Motorn (scanner-engine/, privat nät) vet vilka kort den har (GET /cards). Rutten diffar mot
 * katalogen — kort med bild som motorn saknar — och skickar dem i omgångar till POST /add-cards,
 * där motorn själv hämtar bilden, räknar nyckelpunkterna och skriver till sin volym. Ingen
 * ombyggnad, ingen uppladdning av 3 GB. Nya set (söndagsimporten), promos och JP-singlar
 * (jp-singles-refresh, dagligen) blir igenkänningsbara samma natt.
 *
 * Anropas av cardmarket-refresh.yml (natt) och import-new-sets.yml (söndag), sist, med
 * x-cron-secret = CRON_SECRET. Kostnad: en Neon-läsning (id + bild-URL, ~36 000 rader) och en
 * motorväckning per körning; båda sker i ett fönster där de redan är vakna.
 */
import { type NextRequest, NextResponse } from "next/server";
import { apiError, jsonOk } from "@/lib/api";
import { ensureDbAwake, prisma } from "@/lib/db";
import { engineShadowEnabled } from "@/lib/scanner-engine-shadow";

export const dynamic = "force-dynamic";
export const maxDuration = 900;

const BATCH = 100;
/** Bara id + URL per rad — motorns tak per anrop är 4 MB. */
const URL_BATCH = 2000;
/** Tak per körning: resten tas nästa natt (en ny JP-omgång kan vara tusentals kort). */
const MAX_PER_RUN = 3000;

function engine(path: string, init?: RequestInit, timeoutMs = 120_000) {
  return fetch(`${process.env.SCANNER_ENGINE_URL!.trim().replace(/\/$/, "")}${path}`, {
    ...init,
    headers: { ...(init?.headers ?? {}), "x-engine-secret": process.env.SCANNER_ENGINE_SECRET!.trim() },
    signal: AbortSignal.timeout(timeoutMs),
  });
}

export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    if (!secret) return NextResponse.json({ error: "Cron är inte konfigurerat." }, { status: 503 });
    if (req.headers.get("x-cron-secret") !== secret) {
      return NextResponse.json({ error: "Ogiltig cron-hemlighet." }, { status: 401 });
    }
    if (!engineShadowEnabled()) return jsonOk({ ok: true, skipped: "engine-disabled" });

    // Motorn sover mellan passen: första anropet väcker den, försök om medan den startar.
    let known: string[] | null = null;
    let knownUrls: Record<string, string> = {};
    for (const wait of [0, 5000, 15000, 30000]) {
      if (wait) await new Promise((r) => setTimeout(r, wait));
      try {
        const res = await engine("/cards", undefined, 30_000);
        if (res.ok) {
          const body = (await res.json()) as { ids: string[]; urls?: Record<string, string> };
          known = body.ids;
          knownUrls = body.urls ?? {};
          break;
        }
      } catch {
        /* vaknar fortfarande */
      }
    }
    if (!known) return NextResponse.json({ error: "Motorn svarar inte." }, { status: 502 });
    const have = new Set(known);

    await ensureDbAwake();
    const catalog = await prisma.card.findMany({
      where: { NOT: { imageUrl: null } },
      select: { id: true, imageUrl: true, language: true },
    });
    const missing = catalog.filter((c) => !have.has(c.id)).slice(0, MAX_PER_RUN);

    // Bildvärden kan flytta en bild efter att motorn lagt till kortet (2026-10-08: 406 JP-kort gav
    // 404 vid varje start). Katalogen har den nya länken — skicka den för kort motorn redan känner.
    const moved = catalog.filter((c) => have.has(c.id) && knownUrls[c.id] && knownUrls[c.id] !== c.imageUrl);
    let relinked = 0;
    for (let i = 0; i < moved.length; i += URL_BATCH) {
      const urls = Object.fromEntries(moved.slice(i, i + URL_BATCH).map((c) => [c.id, c.imageUrl!]));
      const res = await engine("/refresh-urls", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ urls }),
      });
      if (!res.ok) throw new Error(`refresh-urls ${res.status}`);
      relinked += ((await res.json()) as { changed: number }).changed;
    }

    let added = 0;
    let failed = 0;
    for (let i = 0; i < missing.length; i += BATCH) {
      const res = await engine("/add-cards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cards: missing.slice(i, i + BATCH) }),
      });
      if (!res.ok) throw new Error(`add-cards ${res.status}`);
      const r = (await res.json()) as { added: number; failedCount: number };
      added += r.added;
      failed += r.failedCount;
    }
    console.log(`[engine-sync] katalog ${catalog.length}, motorn hade ${have.size}, saknades ${missing.length}: tillagda ${added}, misslyckade ${failed}; nya bildlänkar ${relinked}.`);
    return jsonOk({ ok: true, catalog: catalog.length, engineHad: have.size, missing: missing.length, added, failed, relinked });
  } catch (error) {
    return apiError(error);
  }
}
