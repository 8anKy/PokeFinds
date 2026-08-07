/**
 * Hämtar japanska SET-LOGOTYPER en gång och lägger dem i `public/set-logos/jp/`.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/fetch-jp-set-logos.ts           # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/fetch-jp-set-logos.ts --apply   # laddar ner
 *
 * VARFÖR EN ENGÅNGSHÄMTNING OCH INTE EN LÄNK. Ingen leverantör vi har ett avtal
 * med publicerar japanska setlogotyper: TCGdex har 0 av 177, TCGGO:s japanska
 * endpoint svarar med en tom lista, CardTrader har expansionerna men ingen bild,
 * och den officiella japanska sajten har bara 21 av våra 49 set — med bespoke,
 * hashade filnamn per sida (`hero-img-01-y25ri.png`) som inte går att härleda.
 * Filerna hämtas därför EN gång och läggs i vårt eget repo: då belastar vi ingen
 * annans CDN vid varje sidvisning, och bilderna kan inte försvinna under oss.
 *
 * ⛔ Kör inte det här i ett jobb. Det är en engångshämtning som en människa
 *    granskar utfallet av — nya set är enstaka per kvartal och läggs till för hand.
 */
import * as fs from "fs";
import * as path from "path";
import { prisma } from "../src/lib/db";
import { codeFromJpSetName, jpSetLogoFileKey, jpSetLogoPath } from "../src/lib/jp-set-name";

const INDEX_URL = "https://jp.pokellector.com/sets";
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126.0 Safari/537.36";
const OUT_DIR = path.join(process.cwd(), "public", "set-logos", "jp");
const APPLY = process.argv.includes("--apply");

/** Jämförnyckel för setnamn: gemener, utan diakriter och skiljetecken. */
function key(name: string): string {
  return name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, "and")
    // "Pokemon Card 151" och "151" ska mötas: era-/varumärkesbrus bort.
    .replace(/\bpokemon\b|\bcard\b|\bgame\b|\bjapanese\b|\bcollection\b|\bthe\b/g, "")
    .replace(/[^a-z0-9]/g, "");
}

/**
 * GRANSKADE PAR — setkod → logotypfil, fastställda genom att LÄSA den japanska
 * ordbilden i logotypen och jämföra den med setets japanska namn hos TCGdex.
 *
 * Varför de behövs: källans namn och koder är var för sig bevisat opålitliga.
 * Namnen är en annan engelsk översättning av samma japanska titel (ムニキスゼロ =
 * "Nihil Zero" hos Cardmarket, "Munikis Zero" här), och koderna är ibland fel —
 * "Future Flash" står som SV4K, vilket är Ancient Roars kod. Automatiken kräver
 * därför att namn OCH kod är ense, och allt annat hamnar här efter granskning.
 *
 * ⛔ Lägg inte till en rad utan att titta på bilden. Kolumnen "verifierad" är
 *    exakt vad ordbilden i logotypen säger.
 */
const VERIFIED: Record<string, { url: string; verified: string }> = {
  // Namnen är oense — men ordbilden stämmer med TCGdex japanska namn.
  M3: { url: "https://den-media.pokellector.com/logos/Munikis-Zero.logo.428.png", verified: "ムニキスゼロ" },
  SV9a: { url: "https://den-media.pokellector.com/logos/Hot-Air-Arena.logo.411.png", verified: "熱風のアリーナ" },
  SV7: { url: "https://den-media.pokellector.com/logos/Stella-Miracle.logo.401.png", verified: "ステラミラクル" },
  SV1a: { url: "https://den-media.pokellector.com/logos/Triple-Beat.logo.366.png", verified: "トリプレットビート" },
  S7D: { url: "https://den-media.pokellector.com/logos/Perfect-Skyscraper.logo.318.png", verified: "摩天パーフェクト" },
  S6K: { url: "https://den-media.pokellector.com/logos/Jet-Black-Poltergeist.logo.310.png", verified: "漆黒のガイスト" },
  SM10b: { url: "https://den-media.pokellector.com/logos/Sky-Legends.logo.268.png", verified: "スカイレジェンド" },
  // Koden är dubblerad i källan (Lost Abyss bär också S12) — bilden avgör.
  S12: { url: "https://den-media.pokellector.com/logos/Paradigm-Trigger.logo.351.png", verified: "パラダイムトリガー" },
  // ⛔ KÄLLAN HAR SVÄNGT OM DE HÄR TVÅ: båda står som SV4K. Ordbilden visar att
  //    filen "Future-Flash" är 未来 (FUTURE FLASH) = SV4M, och "Ancient-Roar" är
  //    古代 (ANCIENT ROAR) = SV4K. Utan granskningen hade ett av setten fått fel
  //    logotyp och det andra ingen alls.
  SV4M: { url: "https://den-media.pokellector.com/logos/Future-Flash.logo.382.png", verified: "未来の一閃 / FUTURE FLASH" },
  SV4K: { url: "https://den-media.pokellector.com/logos/Ancient-Roar.logo.381.png", verified: "古代の咆哮 / ANCIENT ROAR" },
};

interface Logo {
  name: string;
  url: string;
  /** Setkoden källan själv anger på länken (`name="SV3A"`). */
  code: string;
}

/**
 * Setlistan, nyckelad på SETKOD.
 *
 * ⛔ MATCHA ALDRIG PÅ NAMN HÄR. Samma japanska set översätts olika av olika
 *    källor — ムニキスゼロ är "Nihil Zero" hos Cardmarket (vår skrivning) och
 *    "Munikis Zero" hos den här, 摩天パーフェクト är "Towering Perfection" och
 *    "Perfect Skyscraper", SM10b är "Sky Legend" och "Sky Legends". Sju av våra
 *    49 set föll på just det. Länken i listan bär däremot setKODEN
 *    (`<a name="SV3A" …>`), och koden är tillverkarens identitet — samma nyckel
 *    som våra egna japanska set är byggda på. Namnen används bara i utskriften.
 *
 * ⚠️ Källans egna SET-SIDOR har fel kod ibland (både "Future Flash" och "Ancient
 *    Roar" påstår sig vara SV4K på sin detaljsida). Listans `name=` stämmer.
 */
async function fetchLogoIndex(): Promise<Logo[]> {
  const res = await fetch(INDEX_URL, { headers: { "user-agent": UA } });
  if (!res.ok) throw new Error(`setlistan svarade ${res.status}`);
  const html = await res.text();
  // ⛔ Nyckla INTE på koden här. Källan återanvänder koder (Future Flash bär
  //    SV4K, som är Ancient Roar) och en Map hade låtit den sista posten
  //    skriva över den första — då försvinner själva kollisionen, som är
  //    precis det anroparen måste få se.
  const out = new Map<string, Logo>();
  // <a class="button" name="SV3A" href="…"><img src="…/Raging-Surf.logo.376.png">
  for (const m of html.matchAll(
    /<a[^>]*name="([^"]+)"[^>]*>\s*<img[^>]*src="(https:\/\/[^"]*\/logos\/([^"]+)\.logo\.\d+\.png)"/g
  )) {
    const [, code, url, slug] = m;
    if (!code.trim()) continue;
    out.set(url, { code: code.trim(), url, name: slug.replace(/-/g, " ") });
  }
  return [...out.values()];
}

async function main() {
  const logos = await fetchLogoIndex();
  console.log(`Logotyper i källan: ${logos.length}`);

  // ⚠️ Koden är INTE unik i källan: både "Future Flash" och "Ancient Roar" bär
  // SV4K där. En Map hade tyst låtit den sista vinna och gett ett av setten fel
  // logotyp — kollisioner måste synas, inte skrivas över.
  const byCode = new Map<string, Logo>();
  const codeCollisions = new Map<string, Logo[]>();
  for (const l of logos) {
    const k = l.code.toLowerCase();
    const prev = byCode.get(k);
    if (prev) codeCollisions.set(k, [...(codeCollisions.get(k) ?? [prev]), l]);
    else byCode.set(k, l);
  }
  if (codeCollisions.size) {
    console.log(`\n⚠️ Koder som förekommer flera gånger i källan: ${codeCollisions.size}`);
    for (const [k, ls] of codeCollisions) console.log(`  ${k}: ${ls.map((l) => l.name).join(" | ")}`);
  }
  // Namnnyckeln finns BARA för set som saknar kod hos oss (i dag ett enda:
  // 25th Anniversary). Tvetydiga namn hoppas över.
  const byName = new Map<string, Logo[]>();
  for (const l of logos) {
    const k = key(l.name);
    byName.set(k, [...(byName.get(k) ?? []), l]);
  }

  const sets = await prisma.cardSet.findMany({
    where: { language: "JP" },
    select: { name: true },
    orderBy: { releaseDate: { sort: "desc", nulls: "last" } },
  });

  const matched: { set: string; code: string; url: string; source: string }[] = [];
  const missed: string[] = [];
  const ambiguous: string[] = [];
  const rejected: string[] = [];

  for (const s of sets) {
    const code = codeFromJpSetName(s.name);
    // Filnamnet är setKODEN — den är stabil, till skillnad från namnet. Sets utan
    // kod (bara ett i dag) får en nyckel härledd ur namnet. DELAD med jobbet.
    const fileKey = jpSetLogoFileKey(s.name);

    // Granskade par går före automatiken — de ÄR facit för de här setten.
    const reviewed = code ? VERIFIED[code] : undefined;
    if (reviewed) {
      matched.push({ set: s.name, code: fileKey, url: reviewed.url, source: `GRANSKAD: ${reviewed.verified}` });
      continue;
    }

    if (code) {
      const hit = byCode.get(code.toLowerCase());
      const collision = codeCollisions.has(code.toLowerCase());
      if (!hit) {
        missed.push(`${s.name} (kod ${code} finns inte i källistan)`);
        continue;
      }
      // TVÅ OBEROENDE SIGNALER. Källans koder OCH namn har var för sig bevisade
      // fel (Lost Abyss märkt S12, Future Flash märkt SV4K), så en ensam signal
      // duger inte. Är båda ense hämtas logotypen; annars hamnar setet i
      // granskningslistan och en människa tittar på bilden.
      const base = s.name.replace(/\s*\([^)]*\)\s*$/, "");
      const namesAgree = key(hit.name) === key(base);
      if (!namesAgree || collision) {
        rejected.push(
          `${s.name} → "${hit.name}" [${hit.code}]${collision ? " (koden är dubblerad i källan)" : " (namnen är oense)"}  ${hit.url}`
        );
        continue;
      }
      matched.push({ set: s.name, code: fileKey, url: hit.url, source: `${hit.name} [${hit.code}]` });
      continue;
    }

    // Utan kod återstår namnet — och då krävs att det är ENTYDIGT.
    const base = s.name.replace(/\s*\([^)]*\)\s*$/, "");
    const hits = byName.get(key(base)) ?? [];
    if (hits.length === 0) {
      missed.push(s.name);
    } else if (hits.length > 1) {
      ambiguous.push(`${s.name} → ${hits.map((h) => `${h.name} [${h.code}]`).join(" | ")}`);
    } else {
      matched.push({
        set: s.name,
        code: fileKey,
        url: hits[0].url,
        source: `${hits[0].name} [${hits[0].code}] (namnträff, ingen kod hos oss)`,
      });
    }
  }

  console.log(`\nMatchade: ${matched.length}/${sets.length}`);
  for (const m of matched) console.log(`  ${m.code.padEnd(7)} ${m.set.padEnd(32)} ← ${m.source}`);
  if (ambiguous.length) {
    console.log(`\nTVETYDIGA (hoppas över): ${ambiguous.length}`);
    for (const a of ambiguous) console.log(`  ${a}`);
  }
  if (rejected.length) {
    console.log(`\nKRÄVER GRANSKNING (en signal räcker inte): ${rejected.length}`);
    for (const r of rejected) console.log(`  ${r}`);
  }
  if (missed.length) {
    console.log(`\nUTAN träff: ${missed.length}`);
    for (const m of missed) console.log(`  ${m}`);
  }

  if (!APPLY) {
    console.log("\nTorrkörning — inget laddades ner. Lägg till --apply.");
    return;
  }

  fs.mkdirSync(OUT_DIR, { recursive: true });
  let saved = 0;
  let bytes = 0;
  let linked = 0;
  for (const m of matched) {
    const dest = path.join(OUT_DIR, `${m.code}.png`);
    if (!fs.existsSync(dest)) {
      const r = await fetch(m.url, { headers: { "user-agent": UA } });
      if (!r.ok) {
        console.error(`  ${m.code}: HTTP ${r.status}`);
        continue;
      }
      const buf = Buffer.from(await r.arrayBuffer());
      // En "bild" på några hundra byte är en felsida, inte en logotyp.
      if (buf.length < 1000) {
        console.error(`  ${m.code}: bara ${buf.length} byte — hoppar över`);
        continue;
      }
      fs.writeFileSync(dest, buf);
      saved++;
      bytes += buf.length;
      await new Promise((r) => setTimeout(r, 300)); // snäll takt mot källan
    }
    // ⛔ SKRIVER ÖVER en befintlig logoUrl med flit. Seten bär i dag en
    //    PRODUKTBILD (boosterpåsens omslag) som nödlösning — en riktig
    //    setlogotyp är alltid bättre, och det är hela poängen med körningen.
    const upd = await prisma.cardSet.updateMany({
      where: { name: m.set, language: "JP" },
      data: { logoUrl: jpSetLogoPath(m.set) },
    });
    linked += upd.count;
  }
  console.log(
    `\nSparade ${saved} nya logotyper (${(bytes / 1024 / 1024).toFixed(1)} MB) i public/set-logos/jp/\n` +
      `Pekade om ${linked} set till sin logotyp.`
  );
}

main().finally(() => prisma.$disconnect());
