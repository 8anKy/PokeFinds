/**
 * BYGGER KONSTAVTRYCKEN — `Card.artFingerprint` för hela katalogen.
 *
 * Avtrycket låter skannern identifiera ett kort på UTSEENDE i stället för på text.
 * Bakgrunden står i `src/lib/art-fingerprint.ts`: samlarnumret trycks ~2 mm högt
 * och finns inte i en suddig fångst, så textläsning kan aldrig bli tillförlitlig
 * där.
 *
 * KÖRS OM när nya set importeras. Standardläget rör bara kort som SAKNAR avtryck,
 * så den veckovisa körningen är billig:
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/build-art-fingerprints.ts
 *   FORCE=1 …                # räkna om ALLA (t.ex. om rutnätet ändras)
 *   LIMIT=200 …              # torrkör på ett litet urval först
 *
 * ⛔ ÄNDRAS RUTNÄTET (GRID_W/GRID_H) måste ALLA avtryck räknas om med FORCE=1.
 * Blandade längder jämförs aldrig — `art-index.ts` hoppar över rader med fel
 * längd — så följden blir inte fel träffar utan att korten tyst faller ur
 * bildmatchningen. Tystare och därmed värre än en krasch.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp from "sharp";
import {
  FINGERPRINT_BYTES,
  STRUCT_BYTES,
  fingerprintFromRgb,
  structFingerprintFromRgb,
} from "../src/lib/art-fingerprint";

const prisma = new PrismaClient();

const CACHE = process.env.CACHE ?? ".spike/img-cache";
const CONCURRENCY = Number(process.env.CONCURRENCY ?? "8");
const LIMIT = Number(process.env.LIMIT ?? "0");
const FORCE = process.env.FORCE === "1";

function cachePath(id: string): string {
  const h = createHash("sha1").update(id).digest("hex");
  return join(CACHE, h.slice(0, 2), `${h}.img`);
}

function smallVariant(url: string): string {
  return url.replace(/_hires(\.\w+)(\?|$)/i, "$1$2");
}

function absolute(url: string): string {
  if (url.startsWith("http://") || url.startsWith("https://")) return url;
  return `https://www.foilio.se${url.startsWith("/") ? "" : "/"}${url}`;
}

/** Bild ur diskcachen, annars hämtad och cachad. */
async function imageFor(id: string, url: string): Promise<Buffer | null> {
  const path = cachePath(id);
  if (existsSync(path)) return readFileSync(path);
  // Lilla varianten först, originalet som reserv — alla set har inte en
  // icke-hires-fil (mätt: 132 kort 404:ar på båda, de får inget avtryck).
  for (const candidate of [...new Set([absolute(smallVariant(url)), absolute(url)])]) {
    try {
      const res = await fetch(candidate, {
        headers: {
          "user-agent": "FoilioArtFingerprint/1.0 (+https://www.foilio.se)",
          referer: "https://www.foilio.se/",
        },
      });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      if (buf.length < 512) continue;
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, buf);
      return buf;
    } catch {
      // nästa kandidat
    }
  }
  return null;
}

/**
 * Bildbuffert → avtryck.
 *
 * INGEN mellanliggande omskalning: `fingerprintFromRgb` boxmedelvärdar från rå
 * upplösning. Ett `resize()` här hade smugit in sharps omsamplingsfilter i
 * nyckeln, och klienten (canvas) har ett annat — då skulle index och fråga
 * räknas olika utan att något felar.
 */
async function fingerprintsOf(
  buf: Buffer
): Promise<{ color: Buffer; struct: Buffer } | null> {
  try {
    const { data, info } = await sharp(buf)
      .removeAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });
    // BÅDA avtrycken ur samma avkodning: färg (layout) + struktur (belysnings-
    // immun — skärmfoto-fallet). Se src/lib/art-fingerprint.ts för mätningen.
    const color = fingerprintFromRgb(data, info.width, info.height, 3);
    const struct = structFingerprintFromRgb(data, info.width, info.height, 3);
    if (!color || !struct) return null;
    return {
      color: Buffer.from(color.buffer, color.byteOffset, color.length),
      struct: Buffer.from(struct.buffer, struct.byteOffset, struct.length),
    };
  } catch {
    return null;
  }
}

async function main() {
  // Default = rader som saknar NÅGOT av avtrycken (strukturavtrycket kom
  // 2026-07-30, så första körningen efter deploy backfyller det för alla).
  const cards = await prisma.card.findMany({
    where: FORCE
      ? {}
      : { OR: [{ artFingerprint: null }, { structFingerprint: null }] },
    orderBy: { id: "asc" },
    select: { id: true, name: true, imageUrl: true },
    ...(LIMIT > 0 ? { take: LIMIT } : {}),
  });
  const todo = cards.filter((c) => c.imageUrl);
  console.log(
    `${FORCE ? "RÄKNAR OM ALLA" : "kort utan avtryck"}: ${cards.length} · med bild-URL: ${todo.length}`
  );
  if (todo.length === 0) {
    console.log("Inget att göra.");
    return;
  }

  let done = 0;
  let written = 0;
  let noImage = 0;
  let noFingerprint = 0;
  let cursor = 0;

  async function worker() {
    for (;;) {
      const i = cursor++;
      if (i >= todo.length) return;
      const card = todo[i];
      done++;
      const img = await imageFor(card.id, card.imageUrl!);
      if (!img) {
        noImage++;
      } else {
        const fps = await fingerprintsOf(img);
        if (
          !fps ||
          fps.color.length !== FINGERPRINT_BYTES ||
          fps.struct.length !== STRUCT_BYTES
        ) {
          noFingerprint++;
        } else {
          await prisma.card.update({
            where: { id: card.id },
            data: { artFingerprint: fps.color, structFingerprint: fps.struct },
          });
          written++;
        }
      }
      if (done % 500 === 0) {
        console.log(`${done}/${todo.length}  skrivna ${written} · utan bild ${noImage} · utan avtryck ${noFingerprint}`);
      }
    }
  }

  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  const total = await prisma.card.count({ where: { artFingerprint: { not: null } } });
  console.log(
    `\nKLART: ${done} behandlade · ${written} skrivna · ${noImage} utan hämtbar bild · ${noFingerprint} utan avtryck`
  );
  console.log(
    `Katalogen har nu avtryck på ${total} kort ` +
      `(≈ ${((total * FINGERPRINT_BYTES) / 1024 / 1024).toFixed(1)} MB residentminne i indexet).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
