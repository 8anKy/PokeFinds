/**
 * STÄDAR JAPANSKA SET MOT LEVERANTÖRENS EPISODLISTA (2026-08-30).
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/sync-jp-sets-from-api.ts           # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/sync-jp-sets-from-api.ts --apply
 *
 * Varför: set-väljaren visade en blandning — logotyp på de set som fått en fil i
 * `public/set-logos/jp/`, PRODUKTFOTO (booster/box) på resten, och en rad tomma
 * skal-set ur Cardmarkets expansionslista (ID/TH-utgåvor, gem packs, McDonald's)
 * utan vare sig kort eller produkter. Leverantörens `/pokemon-jp/episodes` (71 set)
 * har kod, serie OCH logotyp för vart och ett — samma mappning (kod → namn) som
 * singelimporten använder, så den är redan verifierad mot 5 553 kort.
 *
 * Gör, per set som matchar en episod:
 *  1. Laddar ner episodens logotyp till `public/set-logos/jp/{KOD}.png` om filen
 *     saknas (repo-regeln: ingen annans CDN per sidvisning) och pekar `logoUrl` dit.
 *  2. Skriver in koden i namnet (`jpSetDisplayName`) när den saknas eller avviker
 *     ("Single Strike Master (S5L)" → "(S5I)", "Sword" → "Sword (S1W)").
 *  3. Sätter serien ur kodprefixet när den står som "Other".
 * Och oberoende av episoder:
 *  4. Raderar JP-set med 0 kort, 0 produkter och 0 bevakare — rena skal.
 *
 * ⛔ Namnet på ett set vars kod INTE finns hos leverantören rörs aldrig (SM-eran
 *    m.fl.). De behåller produktfotot tills någon lägger en granskad logotyp.
 */
import "./load-env";
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/db";
import { codeFromJpSetName, jpSetDisplayName, jpSetLogoPath } from "../src/lib/jp-set-name";
import { cleanJpEpisodeName } from "../src/jobs/jp-singles-refresh";

const APPLY = process.argv.includes("--apply");
const HOST = process.env.CARDMARKET_RAPIDAPI_HOST || "cardmarket-api-tcg.p.rapidapi.com";
const KEY = process.env.CARDMARKET_RAPIDAPI_KEY || "";

interface Episode { id: number; name: string; code: string | null; logo: string | null; released_at: string | null; series: { name?: string | null } | null }

function seriesFromCode(code: string): string | null {
  const c = code.toUpperCase();
  if (/^SV/.test(c)) return "Scarlet & Violet";
  if (/^(M\d|MP)/.test(c)) return "Mega Evolution";
  if (/^SM/.test(c)) return "Sun & Moon";
  if (/^XY/.test(c)) return "XY";
  if (/^(S\d|SP\d|SI$)/.test(c)) return "Sword & Shield";
  return null;
}

const nameKey = (n: string) =>
  cleanJpEpisodeName(n).replace(/\s*\([A-Za-z]{1,4}\d{1,2}[A-Za-z-]{0,3}\)\s*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

async function main() {
  if (!KEY) throw new Error("CARDMARKET_RAPIDAPI_KEY saknas");
  const episodes: Episode[] = [];
  for (let page = 1, total = 1; page <= total; page++) {
    const r = await fetch(`https://${HOST}/pokemon-jp/episodes?page=${page}`, { headers: { "x-rapidapi-key": KEY, "x-rapidapi-host": HOST } });
    if (!r.ok) throw new Error(`episodes sida ${page}: HTTP ${r.status}`);
    const j = (await r.json()) as { data: Episode[]; paging: { total: number } };
    total = j.paging?.total ?? 1;
    episodes.push(...j.data);
  }
  const epByCode = new Map<string, Episode>();
  const epByName = new Map<string, Episode>();
  for (const e of episodes) {
    if (e.code && !epByCode.has(e.code.toLowerCase())) epByCode.set(e.code.toLowerCase(), e);
    const k = nameKey(e.name);
    if (k && !epByName.has(k)) epByName.set(k, e);
  }

  const sets = await prisma.cardSet.findMany({
    where: { language: "JP" },
    select: { id: true, name: true, series: true, logoUrl: true, externalId: true, _count: { select: { cards: true, products: true, watchers: true } } },
    orderBy: { name: "asc" },
  });

  let logos = 0, renames = 0, series = 0, deletes = 0;
  for (const s of sets) {
    const ourCode = codeFromJpSetName(s.name);
    const ep =
      (s.externalId?.startsWith("tcggo-jp:") ? episodes.find((e) => `tcggo-jp:${e.id}` === s.externalId) : undefined) ??
      (ourCode ? epByCode.get(ourCode.toLowerCase()) : undefined) ??
      epByName.get(nameKey(s.name));

    if (s._count.cards === 0 && s._count.products === 0 && s._count.watchers === 0) {
      console.log(`RADERA  ${s.name}  (0 kort, 0 produkter, 0 bevakare)`);
      deletes++;
      if (APPLY) await prisma.cardSet.delete({ where: { id: s.id } });
      continue;
    }
    if (!ep) continue;

    const data: { name?: string; series?: string; logoUrl?: string } = {};
    const code = ep.code ?? ourCode;
    if (code) {
      // Koder utan siffra ("MP", "SVP") känns inte igen av codeFromJpSetName — strippa
      // ett avslutande "(KOD)" som är exakt den här koden, annars dubbleras det.
      const trailing = s.name.match(/\s*\(([A-Za-z0-9-]{1,6})\)\s*$/);
      const base =
        ourCode || (trailing && trailing[1].toLowerCase() === code.toLowerCase())
          ? s.name.replace(/\s*\([^)]*\)\s*$/, "")
          : cleanJpEpisodeName(s.name);
      const wanted = jpSetDisplayName(base, code);
      if (wanted !== s.name) { data.name = wanted; renames++; console.log(`NAMN    ${s.name} → ${wanted}`); }
      const wantedSeries = seriesFromCode(code);
      if (wantedSeries && (s.series === "Other" || !s.series)) { data.series = wantedSeries; series++; console.log(`SERIE   ${s.name} → ${wantedSeries}`); }
    }
    const finalName = data.name ?? s.name;
    const logoPath = jpSetLogoPath(finalName);
    const file = path.join(process.cwd(), "public", logoPath);
    if (!(s.logoUrl ?? "").startsWith("/set-logos/jp/") || s.logoUrl !== logoPath) {
      if (!fs.existsSync(file) && ep.logo) {
        console.log(`LOGO    ${finalName} ← ${ep.logo}`);
        if (APPLY) {
          const r = await fetch(ep.logo, { headers: { "user-agent": "FoilioSetLogos/1.0 (+https://foilio.se)" } });
          if (!r.ok) { console.warn(`  ! HTTP ${r.status}, hoppar över`); continue; }
          fs.mkdirSync(path.dirname(file), { recursive: true });
          fs.writeFileSync(file, Buffer.from(await r.arrayBuffer()));
        }
      }
      if (fs.existsSync(file) || (APPLY && ep.logo)) { data.logoUrl = logoPath; logos++; }
    }
    if (APPLY && Object.keys(data).length) await prisma.cardSet.update({ where: { id: s.id }, data });
  }
  console.log(`\n${APPLY ? "SKRIVET" : "TORRKÖRNING"}: ${logos} logotyper, ${renames} namn, ${series} serier, ${deletes} raderade tomma set.`);
  await prisma.$disconnect();
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
