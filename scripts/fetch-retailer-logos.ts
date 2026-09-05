/**
 * Hämtar butikernas loggor och bygger de FÄRDIGA plattorna som `RetailerLogo`
 * visar (kvadrat 128×128, märket på ljus eller mörk botten efter märkets egen
 * ljushet). Skriver `public/retailer-logos/<slug>.png` och — med `--apply` —
 * `Retailer.logoUrl = /retailer-logos/<slug>.png`.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fetch-retailer-logos.ts            # rapport + filer
 *   node scripts/with-prod-db.mjs npx tsx scripts/fetch-retailer-logos.ts --apply    # + logoUrl i DB
 *   node scripts/with-prod-db.mjs npx tsx scripts/fetch-retailer-logos.ts --only "Beam Cardshop"
 *
 * KÄLLA, i ordning: (1) `OVERRIDES` — officiella filer och handplockade märken
 * (Cardmarket: deras egen nedladdningssida, ordmärket bortklippt; Goblinen/Rogerz:
 * Shopifys originalfil utan `_32x32`-suffixet), (2) butikens egna `<link rel=icon>`
 * / apple-touch-icon, största först och Shopifys storleksparametrar borttagna,
 * (3) Googles favicon-tjänst vid 128 px. Allt under 48 px kastas — en uppskalad
 * 16-pixlare läser som ett fel, initialen (reservläget i UI:t) läser som ett val.
 *
 * ⛔ Loggorna används som IDENTIFIERARE bredvid butikens egen annons (referens-
 * bruk), aldrig som dekor eller i marknadsföring. Ber en butik oss ta bort sin:
 * ta bort filen + nolla logoUrl, samma dag. Cardmarkets villkor (help.cardmarket.com
 * /en/Downloads): märket är Sammelkartenmarkt GmbH & Co. KG:s, vi gör inget som
 * strider mot deras rätt till det.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { PrismaClient } from "@prisma/client";
import sharp, { type Sharp } from "sharp";
import { slugify } from "../src/lib/utils";

const OUT_DIR = path.join(process.cwd(), "public", "retailer-logos");
const SIZE = 128;
const INNER = 92; // märkets ruta på plattan
const MIN_SOURCE_PX = 48;
const UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 FoilioLogoFetch/1.0 (+https://foilio.se)";

type Override = {
  url: string;
  /** SVG: rita bara den här viewBoxen. */
  svgViewBox?: string;
  /** Klipp till FÖRSTA glyfen i ett liggande ordmärke (första tomma kolumnen efter innehåll). */
  firstGlyph?: boolean;
  /** Klipp bort allt under första tomma raden (Cardmarket: märke över ordmärke). */
  cropAboveGap?: boolean;
  /** Klipp till pixlar i en accentfärg (Spelexperten: det orangea e:t i ordmärket). */
  cropToHue?: "orange";
  /** Behandla som friliggande märke även om det fyller sin ruta (får luft på plattan). */
  forceMark?: boolean;
};

const OVERRIDES: Record<string, Override> = {
  Cardmarket: {
    url: "https://images.ctfassets.net/pjhgqryi6myh/7gHVLVryhcCiAKj4nzS6gq/dc02b9c0b3b63e88b38acf449ad5da77/CMLogoBlue1_-_Vertical.png",
    cropAboveGap: true,
  },
  Goblinen: {
    url: "https://www.goblinen.com/cdn/shop/files/favicon-96x96_2b786b2c-4535-4456-b1a2-3b99def4e91d.png",
  },
  Rogerz: {
    url: "https://rogerz.dk/cdn/shop/files/Monogram_Small_f0034752-4587-4204-bad0-962165a5a871.png",
  },
  Pokexclusive: {
    url: "https://pokexclusive.se/cdn/shop/t/15/assets/pokexclusive-logo.svg",
    firstGlyph: true,
  },
  Spelexperten: {
    url: "https://www.spelexperten.com/dokument/bibliotek/Image/logo.png",
    cropToHue: "orange",
    forceMark: true,
  },
  // Favicon är 40 px — under golvet. Sidhuvudets logga i stället.
  Aquitaz: {
    url: "https://aquitaz.se/cdn/shop/files/Aquitaz_Logo_c398c7f9-d8fa-48bf-8ac7-97513d0a1211.png?width=512",
  },
};

/** Vanliga filnamn som sajter lägger i roten utan att länka dem i <head>. */
const ROOT_GUESSES = [
  "/apple-touch-icon.png",
  "/apple-touch-icon-180x180.png",
  "/apple-touch-icon-precomposed.png",
  "/android-chrome-192x192.png",
  "/favicon-196x196.png",
  "/favicon-192x192.png",
  "/favicon.svg",
];

/** Ingen webbplats att hämta något från. */
const SKIP = new Set(["Mock-datakälla", "Pokémon TCG API", "TCGdex API"]);

async function fetchBytes(url: string): Promise<Buffer | null> {
  try {
    const res = await fetch(url, { headers: { "User-Agent": UA, Accept: "*/*" }, redirect: "follow" });
    if (!res.ok) return null;
    return Buffer.from(await res.arrayBuffer());
  } catch {
    return null;
  }
}

/** Shopify lägger `_32x32` i filnamnet och `width=32` i frågesträngen — ta bort båda. */
function unsized(url: string): string {
  return url
    .replace(/_(\d+)x(\d+)(?=\.(png|jpe?g|webp|gif)(\?|$))/i, "")
    .replace(/([?&])(width|height)=\d+/gi, "$1$2=512")
    .replace(/crop=[a-z]+&?/i, "");
}

async function iconCandidates(site: string): Promise<string[]> {
  const html = (await fetchBytes(site))?.toString("utf8");
  if (!html) return [];
  const out: { size: number; url: string }[] = [];
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = m[0];
    const rel = /rel=["']([^"']+)/i.exec(tag)?.[1]?.toLowerCase() ?? "";
    const href = /href=["']([^"']+)/i.exec(tag)?.[1];
    if (!href || !rel.includes("icon")) continue;
    const sizes = /sizes=["'](\d+)/i.exec(tag)?.[1];
    const size = sizes ? Number(sizes) : rel.includes("apple") ? 180 : 0;
    try {
      out.push({ size, url: unsized(new URL(href, site).toString()) });
    } catch {
      /* trasig href */
    }
  }
  out.sort((a, b) => b.size - a.size);
  const urls = out.map((c) => c.url);
  // og:image bara när den är (nästan) kvadratisk — banners är inga märken.
  const og = /property=["']og:image["'][^>]*content=["']([^"']+)/i.exec(html)?.[1];
  const ogUrl = og ? (() => { try { return new URL(og, site).toString(); } catch { return null; } })() : null;
  for (const g of ROOT_GUESSES) urls.push(new URL(g, site).toString());
  if (ogUrl) urls.push(`og:${ogUrl}`);
  return [...new Set(urls)];
}

type Raw = { data: Buffer; width: number; height: number };

async function toRaw(img: Sharp): Promise<Raw> {
  const { data, info } = await img.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Bbox för pixlar som uppfyller `keep` — null om ingen. */
function bbox(raw: Raw, keep: (r: number, g: number, b: number, a: number) => boolean) {
  let x0 = raw.width, y0 = raw.height, x1 = -1, y1 = -1;
  for (let y = 0; y < raw.height; y++) {
    for (let x = 0; x < raw.width; x++) {
      const i = (y * raw.width + x) * 4;
      if (keep(raw.data[i], raw.data[i + 1], raw.data[i + 2], raw.data[i + 3])) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
  }
  return x1 < 0 ? null : { left: x0, top: y0, width: x1 - x0 + 1, height: y1 - y0 + 1 };
}

/** Första helt tomma raden efter det första innehållet (märke ovanför ordmärke). */
function firstGapRow(raw: Raw): number | null {
  const rowHas = (y: number) => {
    for (let x = 0; x < raw.width; x++) if (raw.data[(y * raw.width + x) * 4 + 3] > 20) return true;
    return false;
  };
  let y = 0;
  while (y < raw.height && !rowHas(y)) y++;
  while (y < raw.height && rowHas(y)) y++;
  return y < raw.height ? y : null;
}

/** Medelluminans + täckning över de ogenomskinliga pixlarna. */
function marks(raw: Raw) {
  let n = 0, lum = 0;
  for (let i = 0; i < raw.data.length; i += 4) {
    if (raw.data[i + 3] < 200) continue;
    n++;
    lum += 0.2126 * raw.data[i] + 0.7152 * raw.data[i + 1] + 0.0722 * raw.data[i + 2];
  }
  const px = raw.width * raw.height;
  return { coverage: px ? n / px : 0, luminance: n ? lum / n : 0 };
}

async function loadSource(name: string, site: string): Promise<{ img: Sharp; from: string } | null> {
  const ov = OVERRIDES[name];
  if (ov) {
    const bytes = await fetchBytes(ov.url);
    if (!bytes) return null;
    let img: Sharp;
    if (ov.svgViewBox) {
      const svg = bytes
        .toString("utf8")
        .replace(/<svg\b[^>]*>/i, `<svg width="${SIZE * 4}" height="${SIZE * 4}" viewBox="${ov.svgViewBox}" fill="none" xmlns="http://www.w3.org/2000/svg">`);
      img = sharp(Buffer.from(svg));
    } else {
      img = sharp(bytes);
    }
    if (ov.cropAboveGap) {
      const raw = await toRaw(img.clone());
      const gap = firstGapRow(raw);
      if (gap) img = img.extract({ left: 0, top: 0, width: raw.width, height: gap });
    }
    if (ov.firstGlyph) {
      // Rasterisera brett, hitta första tomma kolumnen efter det första innehållet.
      const wide = sharp(await img.clone().resize({ width: 1600 }).png().toBuffer());
      const raw = await toRaw(wide.clone());
      const colHas = (x: number) => {
        for (let y = 0; y < raw.height; y++) if (raw.data[(y * raw.width + x) * 4 + 3] > 20) return true;
        return false;
      };
      let x = 0;
      while (x < raw.width && !colHas(x)) x++;
      while (x < raw.width && colHas(x)) x++;
      if (x < raw.width) img = wide.extract({ left: 0, top: 0, width: x, height: raw.height });
      else img = wide;
    }
    if (ov.cropToHue === "orange") {
      const raw = await toRaw(img.clone());
      const box = bbox(raw, (r, g, b, a) => a > 0 && r > 180 && g < 160 && b < 100);
      if (box) img = img.extract(box);
    }
    return { img, from: "override" };
  }
  const candidates = await iconCandidates(site);
  let host = "";
  try {
    host = new URL(site).host;
  } catch {
    return null;
  }
  candidates.push(`https://www.google.com/s2/favicons?domain=${host}&sz=128`);
  for (const cand of candidates) {
    const isOg = cand.startsWith("og:");
    const url = isOg ? cand.slice(3) : cand;
    const bytes = await fetchBytes(url);
    if (!bytes) continue;
    try {
      const meta = await sharp(bytes).metadata();
      if (!meta.width || !meta.height) continue;
      if (Math.max(meta.width, meta.height) < MIN_SOURCE_PX) continue;
      if (isOg) {
        const ratio = meta.width / meta.height;
        if (ratio < 0.8 || ratio > 1.25) continue;
      }
      return { img: sharp(bytes), from: isOg ? "og" : url.includes("google.com/s2") ? "google" : "site" };
    } catch {
      /* inte en bild */
    }
  }
  return null;
}

async function buildChip(src: Sharp, forceMark = false): Promise<{ png: Buffer; bg: "light" | "dark"; cover: boolean }> {
  // Klipp bort tom kant (genomskinlig ELLER enfärgad — trim tar hörnpixelns färg).
  let img = src.clone().ensureAlpha();
  try {
    img = sharp(await img.trim({ threshold: 8 }).toBuffer());
  } catch {
    img = src.clone().ensureAlpha();
  }
  const raw = await toRaw(img.clone());
  const { coverage, luminance } = marks(raw);
  // Ett foto/enfärgat märke som fyller hela sin (nästan kvadratiska) ruta fyller
  // plattan kant i kant — ALDRIG beskuret: liggande ordmärken (Mystery Shack,
  // Spelgalaxen) blev "STE HAC" med en cover-beskärning. Ett friliggande märke
  // centreras med luft på en platta vald efter sin ljushet.
  const ratio = raw.width / raw.height;
  const cover = !forceMark && coverage > 0.9 && ratio > 0.8 && ratio < 1.25;
  const bg: "light" | "dark" = cover ? "light" : luminance > 150 ? "dark" : "light";
  const bgRgb = bg === "dark" ? { r: 29, g: 29, b: 33 } : { r: 250, g: 250, b: 250 };
  if (cover) {
    const png = await img.resize(SIZE, SIZE, { fit: "contain", background: { ...bgRgb, alpha: 1 } }).flatten({ background: bgRgb }).png().toBuffer();
    return { png, bg, cover };
  }
  const inner = await img.resize(INNER, INNER, { fit: "inside", withoutEnlargement: false }).png().toBuffer();
  const meta = await sharp(inner).metadata();
  const png = await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { ...bgRgb, alpha: 1 } } })
    .composite([{ input: inner, left: Math.round((SIZE - (meta.width ?? INNER)) / 2), top: Math.round((SIZE - (meta.height ?? INNER)) / 2) }])
    .png()
    .toBuffer();
  return { png, bg, cover };
}

async function main() {
  const apply = process.argv.includes("--apply");
  const onlyIdx = process.argv.indexOf("--only");
  const only = onlyIdx >= 0 ? process.argv[onlyIdx + 1] : null;
  const prisma = new PrismaClient();
  await fs.mkdir(OUT_DIR, { recursive: true });
  try {
    const retailers = await prisma.retailer.findMany({
      where: { isActive: true, ...(only ? { name: only } : {}) },
      select: { id: true, name: true, websiteUrl: true, logoUrl: true },
      orderBy: { name: "asc" },
    });
    const rows: string[] = [];
    let ok = 0;
    for (const r of retailers) {
      if (SKIP.has(r.name) || !/^https?:\/\//.test(r.websiteUrl)) {
        rows.push(`${r.name.padEnd(22)} skip`);
        continue;
      }
      const src = await loadSource(r.name, r.websiteUrl);
      if (!src) {
        rows.push(`${r.name.padEnd(22)} NONE (initial i UI:t)`);
        continue;
      }
      try {
        const { png, bg, cover } = await buildChip(src.img, OVERRIDES[r.name]?.forceMark);
        const file = `${slugify(r.name)}.png`;
        await fs.writeFile(path.join(OUT_DIR, file), png);
        const logoUrl = `/retailer-logos/${file}`;
        if (apply && r.logoUrl !== logoUrl) {
          await prisma.retailer.update({ where: { id: r.id }, data: { logoUrl } });
        }
        ok++;
        rows.push(`${r.name.padEnd(22)} ${src.from.padEnd(8)} ${bg.padEnd(5)} ${cover ? "cover " : "contain"} ${file}${apply ? "  → logoUrl" : ""}`);
      } catch (e) {
        rows.push(`${r.name.padEnd(22)} FAIL ${(e as Error).message}`);
      }
    }
    console.log(rows.join("\n"));
    console.log(`\n${ok}/${retailers.length} loggor${apply ? " (logoUrl uppdaterad)" : " (dry-run — kör med --apply för att skriva logoUrl)"}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
