/**
 * Hittar DUBBLETTER bland sealed-produkter — med flera OBEROENDE signaler.
 *
 *   node scripts/with-prod-db.mjs npx tsx scripts/audit-sealed-duplicates.ts
 *   … --signal=cm            # bara en signal (cm|bild|gtin|url|titel)
 *   … --csv                  # maskinläsbart
 *
 * VARFÖR FLERA SIGNALER: en enda regel har alltid ett blindfält, och den katalogbreda
 * titelsvepningen (`dedupe-catalog.ts`) är dessutom MÄTT OPÅLITLIG — den föreslog
 * "Mega Charizard X ex Tin" == "Mega Charizard Y ex Tin" (1,00) eftersom
 * `normalizeTitle` kastar korta tokens. Signalerna här rangordnas efter hur mycket de
 * BEVISAR, och rapporten säger vilken som gäller så att en människa kan värdera raden:
 *
 *   cm    — två produkter länkar till SAMMA Cardmarket-idProduct. STARKAST: CM har en
 *           rad per SKU, så samma idProduct = samma vara. (Undantag: Base-tryckningarna
 *           delar CM-produkt med flit — de bär `variantLabel` och hoppas över.)
 *   gtin  — samma tillverkar-streckkod. Lika starkt när båda har en.
 *   bild  — samma bild-URL. `/api/cm-image/{id}` bär idProduct, alltså nästan lika
 *           starkt som `cm`; en delad butiksbild är svagare men värd att titta på.
 *   url   — samma butiks-URL på två produkter. Alltid fel: en butikssida säljer en vara.
 *   titel — hög likhet inom samma set + kategori. SVAGAST, bara ett uppslag.
 *
 * ⛔ RAPPORT, ALDRIG REPARATION. Sammanslagning raderar en katalogpost med historik;
 *    den görs av merge-import-duplicates.ts / merge-verified-duplicates.ts efter
 *    granskning. Det här skriptet skriver ingenting.
 */
import "./load-env";
import { prisma } from "../src/lib/db";
import { SEALED_CATEGORY_EXCLUSIONS } from "../src/lib/product-category";
import { scoreSimilarity, productsConflict } from "../src/scrapers/matching";
import { normalizeTitle } from "../src/lib/utils";

/**
 * Skiljer sig titlarna på ett KORT ord som bär produktidentitet?
 *
 * Den dokumenterade fällan i `dedupe-catalog.ts`: "Mega Charizard **X** ex Tin" och
 * "Mega Charizard **Y** ex Tin" väger 1,00 mot varandra eftersom Dice-poängen inte bryr
 * sig om ett ensamt tecken. Samma sak för "Base Set **2**" mot "Base". Jämförelsen görs
 * därför på RÅTITELN.
 *
 * ⛔ ETT SIFFERTOKEN ÄR INTE ALLTID IDENTITET. "…long crimp, **1** Booster" mot
 *    "Base Set 2 Booster Pack" skiljer sig på "1" — men det är ett ANTAL, inte en vara.
 *    Åtskillnaden görs av setId: ligger båda i SAMMA set kan en siffra inte gärna vara
 *    setnamnets ("Base Set 2" mot "Base Set" har per definition olika set hos oss), och
 *    då ignoreras den. Enstaka BOKSTÄVER (X/Y/Z) är däremot alltid identitet — de är
 *    varianten, och de förekommer inom ett och samma set.
 */
export function identityTokenDifference(a: string, b: string, sameSet: boolean): string | null {
  const toks = (t: string) =>
    t.toLowerCase().replace(/[^a-z0-9åäö ]+/g, " ").split(/\s+/).filter(Boolean);
  const ta = toks(a), tb = toks(b);
  const onlyIn = (x: string[], y: string[]) => x.filter((t) => !y.includes(t));
  const diff = [...new Set([...onlyIn(ta, tb), ...onlyIn(tb, ta)])];
  const flagged = diff.filter((t) => {
    if (t.length > 2) return false;
    if (/^[a-zåäö]$/.test(t)) return true; // ensam bokstav = variant (X/Y)
    if (/^\d{1,2}$/.test(t)) return !sameSet; // siffra = setnamn bara när seten skiljer
    return false;
  });
  return flagged.length ? flagged.join("/") : null;
}

const ONLY = process.argv.find((a) => a.startsWith("--signal="))?.split("=")[1];
const CSV = process.argv.includes("--csv");

/** idProduct ur en Cardmarket-URL (`?idProduct=123` eller en löst slug-länk). */
export function cmIdFromUrl(url: string): number | null {
  const q = url.match(/[?&]idProduct=(\d+)/i);
  if (q) return Number(q[1]);
  return null;
}
/** idProduct ur vår bildproxy `/api/cm-image/{id}`. */
function cmIdFromImage(url: string | null): number | null {
  const m = url?.match(/\/api\/cm-image\/(\d+)/);
  return m ? Number(m[1]) : null;
}

type Row = {
  id: string;
  title: string;
  slug: string;
  imageUrl: string | null;
  gtin: string | null;
  setId: string | null;
  category: string | null;
  language: string | null;
  variantLabel: string | null;
  createdAt: Date;
  snapshots: number;
  observations: number;
  watchers: number;
  collected: number;
  offers: { url: string; price: number | null; retailer: string }[];
};

/** Poäng för "vilken post är den riktiga" — bara vägledande, aldrig automatiskt beslut. */
function completeness(r: Row): number {
  let s = 0;
  if (r.setId) s += 40;
  s += Math.min(r.snapshots, 60); // prishistorik går inte att återskapa
  s += Math.min(r.observations / 2, 20);
  if (r.imageUrl) s += 15;
  if (r.gtin) s += 10;
  s += r.offers.length * 3;
  s += r.watchers * 25 + r.collected * 25; // användardata väger tyngst av allt
  // Butiksfraseringar som nästan alltid markerar auto-importens stub.
  if (/long\s*crimp|förbest|forbest|förbok|forbok|kopia|max \d|per kund/i.test(r.title)) s -= 25;
  return s;
}

function fmt(r: Row): string {
  const marks = [
    r.setId ? "set" : "SET SAKNAS",
    r.imageUrl ? "bild" : "BILD SAKNAS",
    `${r.snapshots} snapshots`,
    `${r.offers.length} länkar`,
    r.watchers || r.collected ? `ANVÄNDARDATA(${r.watchers}/${r.collected})` : null,
  ].filter(Boolean);
  return `${r.title}\n        ${r.slug}\n        ${marks.join(" · ")} · poäng ${completeness(r)}`;
}

async function main() {
  const raw = await prisma.product.findMany({
    where: { cardId: null, category: { notIn: [...SEALED_CATEGORY_EXCLUSIONS] } },
    select: {
      id: true, title: true, slug: true, imageUrl: true, gtin: true, setId: true,
      category: true, language: true, variantLabel: true, createdAt: true,
      _count: { select: { priceSnapshots: true, priceObservations: true, watchlistItems: true, collectionItems: true } },
      offers: { select: { url: true, price: true, retailer: { select: { name: true } } } },
    },
  });
  const rows: Row[] = raw.map((p) => ({
    id: p.id, title: p.title, slug: p.slug, imageUrl: p.imageUrl, gtin: p.gtin,
    setId: p.setId, category: p.category, language: p.language, variantLabel: p.variantLabel,
    createdAt: p.createdAt,
    snapshots: p._count.priceSnapshots, observations: p._count.priceObservations,
    watchers: p._count.watchlistItems, collected: p._count.collectionItems,
    offers: p.offers.map((o) => ({ url: o.url, price: o.price, retailer: o.retailer.name })),
  }));
  console.log(`Sealed-produkter i katalogen: ${rows.length}\n`);

  const byId = new Map(rows.map((r) => [r.id, r]));
  /** klusternyckel → produkt-id:n */
  const clusters = new Map<string, { signal: string; ids: Set<string>; detail: string }>();
  const add = (key: string, signal: string, detail: string, ...ids: string[]) => {
    if (ONLY && ONLY !== signal) return;
    const c = clusters.get(key) ?? { signal, ids: new Set<string>(), detail };
    for (const i of ids) c.ids.add(i);
    clusters.set(key, c);
  };

  // ── SIGNAL 1: samma Cardmarket-idProduct ────────────────────────────────────
  // ⛔ Tryckningar (variantLabel) delar CM-produkt MED FLIT — Base Unlimited/
  //    Shadowless/1st Edition är tre varor på en CM-rad. De är inte dubbletter.
  const byCm = new Map<number, string[]>();
  for (const r of rows) {
    if (r.variantLabel) continue;
    const ids = new Set<number>();
    for (const o of r.offers) {
      const id = cmIdFromUrl(o.url);
      if (id) ids.add(id);
    }
    for (const id of ids) byCm.set(id, [...(byCm.get(id) ?? []), r.id]);
  }
  for (const [cmId, ids] of byCm) if (ids.length > 1) add(`cm:${cmId}`, "cm", `idProduct ${cmId}`, ...ids);

  // ── SIGNAL 2: samma GTIN ────────────────────────────────────────────────────
  const byGtin = new Map<string, string[]>();
  for (const r of rows) if (r.gtin) byGtin.set(r.gtin, [...(byGtin.get(r.gtin) ?? []), r.id]);
  for (const [g, ids] of byGtin) if (ids.length > 1) add(`gtin:${g}`, "gtin", `GTIN ${g}`, ...ids);

  // ── SIGNAL 3: samma bild ────────────────────────────────────────────────────
  const byImg = new Map<string, string[]>();
  for (const r of rows) {
    if (!r.imageUrl || r.variantLabel) continue;
    byImg.set(r.imageUrl, [...(byImg.get(r.imageUrl) ?? []), r.id]);
  }
  for (const [img, ids] of byImg) {
    if (ids.length < 2) continue;
    const cmId = cmIdFromImage(img);
    add(`bild:${img}`, "bild", cmId ? `CM-bild ${cmId}` : `delad bild ${img.slice(0, 50)}`, ...ids);
  }

  // ── SIGNAL 4: samma butiks-URL på två produkter ─────────────────────────────
  const byUrl = new Map<string, string[]>();
  for (const r of rows) for (const o of r.offers) {
    if (/cardmarket\.com|tradera\.com\/search/i.test(o.url)) continue; // delade av design
    byUrl.set(o.url, [...(byUrl.get(o.url) ?? []), r.id]);
  }
  for (const [u, ids] of byUrl) if (new Set(ids).size > 1) add(`url:${u}`, "url", `delad butiks-URL ${u.slice(0, 60)}`, ...new Set(ids));

  // ── SIGNAL 5: titel-likhet inom samma set + kategori ─────────────────────────
  if (!ONLY || ONLY === "titel") {
    const bySet = new Map<string, Row[]>();
    for (const r of rows) {
      const k = `${r.setId ?? "-"}|${r.category ?? "-"}|${r.language ?? "-"}`;
      bySet.set(k, [...(bySet.get(k) ?? []), r]);
    }
    for (const group of bySet.values()) {
      if (group.length < 2 || group.length > 400) continue;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = group[i], b = group[j];
          if (a.variantLabel || b.variantLabel) continue;
          const s = scoreSimilarity(a.title, b.title);
          if (s < 0.82) continue;
          if (productsConflict(a.title, b.title)) continue;
          add(`titel:${a.id}:${b.id}`, "titel", `titellikhet ${s.toFixed(3)}`, a.id, b.id);
        }
      }
    }
  }

  // ── Slå ihop kluster som delar produkter, behåll alla signaler ──────────────
  const merged: { signals: Set<string>; details: Set<string>; ids: Set<string> }[] = [];
  for (const c of clusters.values()) {
    const hit = merged.find((m) => [...c.ids].some((i) => m.ids.has(i)));
    if (hit) {
      for (const i of c.ids) hit.ids.add(i);
      hit.signals.add(c.signal);
      hit.details.add(c.detail);
    } else {
      merged.push({ signals: new Set([c.signal]), details: new Set([c.detail]), ids: new Set(c.ids) });
    }
  }
  // En andra vända: kluster kan ha blivit sammanlänkade av en senare post.
  let fused = true;
  while (fused) {
    fused = false;
    outer: for (let i = 0; i < merged.length; i++) {
      for (let j = i + 1; j < merged.length; j++) {
        if ([...merged[j].ids].some((x) => merged[i].ids.has(x))) {
          for (const x of merged[j].ids) merged[i].ids.add(x);
          for (const s of merged[j].signals) merged[i].signals.add(s);
          for (const d of merged[j].details) merged[i].details.add(d);
          merged.splice(j, 1);
          fused = true;
          break outer;
        }
      }
    }
  }

  const strength = (s: Set<string>) => (s.has("cm") ? 4 : 0) + (s.has("gtin") ? 3 : 0) + (s.has("url") ? 3 : 0) + (s.has("bild") ? 2 : 0) + (s.has("titel") ? 1 : 0);
  merged.sort((a, b) => strength(b.signals) - strength(a.signals) || b.ids.size - a.ids.size);

  if (CSV) {
    console.log("signaler;antal;slug;titel;setId;bild;snapshots;lankar;poang");
    for (const m of merged) for (const id of m.ids) {
      const r = byId.get(id)!;
      console.log([[...m.signals].join("+"), m.ids.size, r.slug, r.title.replace(/;/g, ","), r.setId ? 1 : 0, r.imageUrl ? 1 : 0, r.snapshots, r.offers.length, completeness(r)].join(";"));
    }
    return;
  }

  // ── KLASSIFICERING: dubblett eller bara DELAD LÄNK? ─────────────────────────
  // "Samma CM-idProduct" betyder INTE alltid samma vara. Cardmarket har bara EN
  // "Generic Poké Ball Tin" (362931) — inga årsvisa. Våra fem rader (2023/2024/2025/
  // 2026/Generic) är alltså verkliga, OLIKA SKU:er som delar den enda länk CM erbjuder.
  // Att slå ihop dem hade raderat fyra riktiga produkter. Motsatsen — "Base Set 2
  // Booster Pack" och "…long crimp, 1 Booster" — är samma vara två gånger, för CM har
  // ingen long crimp-produkt alls.
  //
  // Testet är de vakter som redan avgör identitet: krockar medlemmarna (årtal, karaktär,
  // set-kod, antal …) är de OLIKA varor; gör de inte det är de dubbletter.
  // ⛔ TITEL-LIKHET ENSAM BEVISAR ALDRIG EN DUBBLETT. Den signalen får därför sin egen
  //    verdikt ("GRANSKA") och blandas aldrig in bland de åtgärdbara — samma disciplin
  //    som merge-verified-duplicates.ts: bara par en människa granskat slås ihop.
  type Verdict = "DUBBLETT" | "DELAD LÄNK" | "BLANDAD" | "GRANSKA";
  const STRONG = new Set(["cm", "gtin", "bild", "url"]);
  function classify(members: Row[], signals: Set<string>): { verdict: Verdict; why: string } {
    const reasons: string[] = [];
    let conflicts = 0, pairs = 0;
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        pairs++;
        const sameSet = members[i].setId != null && members[i].setId === members[j].setId;
        const st = identityTokenDifference(members[i].title, members[j].title, sameSet);
        if (st) { conflicts++; reasons.push(`identitetstoken "${st}"`); continue; }
        if (productsConflict(members[i].title, members[j].title)) { conflicts++; reasons.push("productsConflict"); }
      }
    }
    const why = [...new Set(reasons)].join(", ");
    const hasStrong = [...signals].some((s) => STRONG.has(s));
    if (conflicts === pairs && conflicts > 0) return { verdict: "DELAD LÄNK", why };
    if (conflicts > 0) return { verdict: "BLANDAD", why };
    return hasStrong
      ? { verdict: "DUBBLETT", why: "inga identitetskrockar + stark signal" }
      : { verdict: "GRANSKA", why: "bara titellikhet — bevisar ingenting" };
  }

  const groups = merged.map((m) => {
    const members = [...m.ids].map((i) => byId.get(i)!).sort((a, b) => completeness(b) - completeness(a));
    return { ...m, members, ...classify(members, m.signals) };
  });

  const order: Verdict[] = ["DUBBLETT", "BLANDAD", "DELAD LÄNK", "GRANSKA"];
  let n = 0;
  for (const v of order) {
    const list = groups.filter((g) => g.verdict === v);
    if (!list.length) continue;
    console.log(`\n\n${"█".repeat(92)}\n█  ${v}  — ${list.length} kluster\n${"█".repeat(92)}`);
    if (v === "DELAD LÄNK") {
      console.log("(Medlemmarna är OLIKA varor som delar en länk/bild. Slå INTE ihop —");
      console.log(" antingen har CM ingen egen produkt per variant, eller så är en länk fel.)");
    }
    for (const g of list) {
      n++;
      console.log(`\n${"═".repeat(92)}`);
      console.log(`KLUSTER ${n} [${g.verdict}: ${g.why}] — signal: ${[...g.signals].join(" + ").toUpperCase()}  (${[...g.details].join("; ")})`);
      g.members.forEach((r, i) => {
        console.log(`  ${g.verdict === "DUBBLETT" && i === 0 ? "BEHÅLL? " : g.verdict === "DUBBLETT" ? "dubblett" : "        "} ${fmt(r)}`);
        for (const o of r.offers) console.log(`          · ${o.retailer.padEnd(15)} ${String(o.price ?? "-").padEnd(8)} ${o.url.slice(0, 72)}`);
      });
    }
  }

  console.log(`\n${"═".repeat(92)}`);
  for (const v of order) {
    const list = groups.filter((g) => g.verdict === v);
    console.log(`${v.padEnd(12)} ${String(list.length).padStart(3)} kluster, ${list.reduce((s, g) => s + g.ids.size, 0)} produkter`);
  }
  const bySignal = new Map<string, number>();
  for (const g of groups) {
    const k = `${g.verdict} · ${[...g.signals].sort().join("+")}`;
    bySignal.set(k, (bySignal.get(k) ?? 0) + 1);
  }
  console.log();
  for (const [s, c] of [...bySignal.entries()].sort((a, b) => b[1] - a[1])) console.log(`  ${s.padEnd(34)} ${c}`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); process.exit(process.exitCode ?? 0); });
