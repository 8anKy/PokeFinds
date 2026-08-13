/**
 * Parsern för ägarens beslutsfil — REN, utan DB, så den kan testas.
 *
 * Formatet är ägarens eget ("Duplicates … Goes to …", samma som katalogsvepningens
 * utdata) och kräver bara LÄNKAR. Se scripts/apply-owner-decisions.ts för hela
 * arbetsflödet; den här filen äger BARA tolkningen av texten.
 *
 * ⛔ TOLERANT MED FLIT. En människa som bläddrar i katalogen ska kunna klistra in
 *    länkar och titlar huller om buller utan att lära sig en syntax. Allt som inte
 *    är en länk ignoreras, markörorden har synonymer på båda språken, och tomrader
 *    avslutar en grupp. Priset för toleransen betalas i apply-skriptet: det vägrar
 *    köra om något är tvetydigt, och torrkörningen skriver ut de RIKTIGA titlarna.
 */

import { isStoreRetailer } from "../../src/lib/offer-source";

export type Decision = {
  kind: "merge" | "delete";
  /** Slugs som ska bort (mergas in i `keep`, eller raderas). */
  drop: string[];
  /** Slug som överlever. Alltid null för `delete`. */
  keep: string | null;
  /** Radnummer i filen — all felrapportering pekar tillbaka hit. */
  line: number;
};

/** Markörer. Avsiktligt generösa — ingen ska behöva minnas exakt ETT ord.
 *  ⛔ ORDEN och SYMBOLERNA måste stå i skilda alternativ: `\b` mellan ">" och ett
 *     mellanslag är ingen ordgräns (båda är icke-ordtecken), så en delad regex med
 *     ett avslutande `\b` matchade ALDRIG raden "-> https://…". Formen "mål på egen
 *     rad efter en pil" är den mest naturliga att skriva — den måste funka. */
// ⛔ `go(?:es)?`, INTE `goes?` — det senare betyder "goe" med valfritt "s" och
//    matchar alltså aldrig "Go to", vilket är just det ägaren skriver.
// ⛔ "to" är VALFRITT: ägaren skriver ibland bara "Go <länk>". Utan det föll hela
//    gruppen på "dubblettgrupp utan mål" (omgång 4, Black & White-raden).
// ⛔ LOOKAHEAD `(?=\s|$)` i stället för `\b`: en bar slug som börjar på "go"
//    ("go-nagot") har ordgräns efter "go" och hade annars lästs som en målmarkör.
const KEEP_RE =
  /^(?:(?:go(?:es)?(?:\s+to)?|g[åa]r\s+till|till|beh[åa]ll|keep|merge\s*(?:in)?to|mergas?\s+till)(?=\s|$)|->|=>|→|>)\s*/i;
const DELETE_RE = /^(?:delete|radera|ta\s*bort|bort|skrota|remove|x)\b\s*[:\-]?\s*/i;
const DUPES_RE = /^(?:duplicates?|dubbletter?|dubblett|merge|merga|sl[åa]\s*ihop|same)\b\s*[:\-]?\s*$/i;
const COMMENT_RE = /^\s*(?:#|\/\/)/;

/** Produktens slug ur en foilio-länk, en relativ sökväg eller en bar slug. */
const SLUG_RE = /(?:https?:\/\/[^\s/]*foilio\.se)?\/?(?:[a-z]{2}\/)?produkter\/([a-z0-9][a-z0-9-]{2,})/i;
const BARE_SLUG_RE = /^([a-z0-9][a-z0-9-]{6,})$/i;

/**
 * ALLA slugs på raden — inte bara den första.
 *
 * ⛔ Att ta bara den första var ett riktigt fel (2026-08-13): ägaren klistrar in
 *    flera länkar på samma rad ("These <A> <B>"), och en parser som bara läste A
 *    hade TYST hoppat över B. Tyst bortfall är det farligaste utfallet här — B hade
 *    blivit kvar i katalogen som en dubblett ingen visste fanns kvar.
 */
export function slugsOf(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(new RegExp(SLUG_RE.source, "gi"))) {
    out.push(m[1].toLowerCase().replace(/[?#].*$/, ""));
  }
  if (out.length > 0) return out;
  // Bar slug godtas BARA när raden inte innehåller något annat och innehåller ett
  // bindestreck — annars hade varje enstaka ord i en inklistrad titel blivit en slug.
  const bare = text.trim().match(BARE_SLUG_RE);
  return bare && bare[1].includes("-") ? [bare[1].toLowerCase()] : [];
}

export function slugOf(text: string): string | null {
  return slugsOf(text)[0] ?? null;
}

export function parseDecisions(text: string): { decisions: Decision[]; problems: string[] } {
  const decisions: Decision[] = [];
  const problems: string[] = [];
  let cur: Decision | null = null;
  let expectKeep = false;

  const flush = () => {
    if (cur && (cur.drop.length > 0 || cur.keep)) decisions.push(cur);
    cur = null;
    expectKeep = false;
  };

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const n = i + 1;
    if (COMMENT_RE.test(raw)) continue;
    if (!raw.trim()) {
      flush();
      continue;
    }
    const line = raw.trim();

    // Enradsformen "A -> B" är en komplett grupp i sig.
    const inline = line.split(/\s+(?:->|=>|→)\s+/);
    if (inline.length === 2) {
      const a = slugOf(inline[0]);
      const b = slugOf(inline[1]);
      if (a && b) {
        flush();
        decisions.push({ kind: "merge", drop: [a], keep: b, line: n });
        continue;
      }
    }

    if (DUPES_RE.test(line)) {
      flush();
      cur = { kind: "merge", drop: [], keep: null, line: n };
      continue;
    }

    if (DELETE_RE.test(line)) {
      const rest = line.replace(DELETE_RE, "");
      const ss = slugsOf(rest);
      if (ss.length) {
        // "x <länk>" — en radering oavsett vad som pågick.
        if (cur?.kind === "delete") cur.drop.push(...ss);
        else {
          flush();
          cur = { kind: "delete", drop: ss, keep: null, line: n };
        }
      } else {
        // Bar "Delete"-rubrik → allt som följer raderas.
        flush();
        cur = { kind: "delete", drop: [], keep: null, line: n };
      }
      continue;
    }

    if (KEEP_RE.test(line)) {
      const ks = slugsOf(line.replace(KEEP_RE, ""));
      const s = ks[0] ?? null;
      if (ks.length > 1) {
        problems.push(`Rad ${n}: flera länkar efter målmarkören — bara den första (${ks[0]}) används.`);
      }
      // ⛔ Ett mål utan något att slå ihop är ALLTID ett misstag — oftast en andra
      //    "Goes to"-rad i samma grupp. Att tyst skapa en tom grupp (eller värre,
      //    byta mål) hade låtit fel produkt överleva.
      if (!cur) {
        problems.push(`Rad ${n}: "${line}" pekar ut ett mål, men ingen produkt står före det.`);
        continue;
      }
      cur.kind = "merge";
      if (s) {
        if (cur.keep) problems.push(`Rad ${n}: gruppen har redan ett mål (${cur.keep}) — "${line}" ignorerad.`);
        else cur.keep = s;
        flush();
      } else {
        expectKeep = true; // målet står på nästa rad
      }
      continue;
    }

    const ss = slugsOf(line);
    if (ss.length === 0) continue; // fri text (titlar, anteckningar) — ignoreras med flit
    if (!cur) cur = { kind: "merge", drop: [], keep: null, line: n };
    if (expectKeep && !cur.keep) {
      cur.keep = ss[0];
      if (ss.length > 1) problems.push(`Rad ${n}: flera länkar där målet väntades — bara ${ss[0]} används.`);
      flush();
    } else {
      cur.drop.push(...ss);
    }
  }
  flush();
  return { decisions, problems };
}

export type OfferKey = {
  url: string | null;
  retailerId: string;
  condition: string;
  language: string;
  /** Butiksnamnet — marknadsplatser hoppas över, se orphanedOfferUrls. */
  retailerName?: string;
};

/**
 * Butiks-URL:er som blir HERRELÖSA av en merge — HELA GRUPPEN på en gång.
 *
 * ⛔ DEN HÄR MÅSTE SIMULERA MERGEN SEKVENTIELLT, och det var ett riktigt fel att den
 *    inte gjorde det (upptäckt 2026-08-13 av ägaren: "de har kommit tillbaka").
 *    Beräkningen jämförde varje stub mot målets offers SOM DE SÅG UT INNAN gruppen
 *    kördes. När N stubbar slås ihop till ETT mål som saknar butikens offer flyttas
 *    den FÖRSTA stubbens offer in — och då krockar de N−1 följande med den. Den gamla
 *    koden såg noll krockar, rapporterade noll herrelösa URL:er, och N−1 riktiga
 *    butiks-URL:er blev ägarlösa UTAN att hamna i denylistan.
 *    MÄTT: Rogerz Aquapolis-sida har 8 varianter; alla 8 mergades in i
 *    `aquapolis-ecard2-booster-pack`, 7 offers raderades tyst, och nästa skrapning
 *    (16:46 samma dag) skapade 7 NYA produkter av exakt de URL:erna. Samma sak för
 *    Expedition, Jungle, Dragon Frontiers, Diamond & Pearl … — hela "de kom tillbaka".
 *
 * `Offer` är unik på (produkt, butik, skick, språk), så när stubbens offer krockar
 * med en som målet redan har — ELLER med en som en tidigare stub i samma grupp just
 * flyttat dit — RADERAR `mergeStubInto` stubbens rad. URL:en pekar då
 * inte längre på någon offer, och två saker händer vid nästa skrapning:
 *   · matchar URL:en ingen produkt skapas stubben om (mätt 2026-07-14: tre stubbar
 *     återuppstod sju minuter efter en merge), och
 *   · matchar den nu MÅLET — vilket den gör efter en titeltvätt — skriver den över
 *     målets offer, så länk och pris börjar växla mellan de två listningarna vid
 *     varje körning. Rogerz momstvillingar har olika `?variant=`-URL:er och olika
 *     pris, så växlingen syns direkt i katalogen.
 * Båda fallen löses av att den förlorande URL:en denylistas.
 */
export function orphanedOfferUrlsForMerge(dropsInOrder: OfferKey[][], keepOffers: OfferKey[]): string[] {
  // Nyckeln som `Offer` är unik på. Målet "håller" en nyckel så fort någon offer
  // med den nyckeln ligger där — inklusive en som FLYTTATS DIT tidigare i samma grupp.
  const key = (o: OfferKey) => `${o.retailerId}|${o.condition}|${o.language}`;
  const held = new Set(keepOffers.map(key));
  const out: string[] = [];
  for (const drop of dropsInOrder) {
    for (const o of drop) {
      // Marknadsplats-offers RADERAS alltid (se mergeStubInto) — de flyttar aldrig in,
      // så de får varken ta en nyckel eller hamna i denylistan.
      if (o.retailerName && !isStoreRetailer(o.retailerName)) continue;
      if (!o.url) continue;
      if (held.has(key(o))) out.push(o.url); // krock → offern raderas → URL:en blir herrelös
      else held.add(key(o)); // flyttas in och ockuperar nyckeln för resten av gruppen
    }
  }
  return out;
}

/** @deprecated Enskilt par — använd orphanedOfferUrlsForMerge för en hel grupp. */
export function orphanedOfferUrls(dropOffers: OfferKey[], keepOffers: OfferKey[]): string[] {
  const out: string[] = [];
  for (const o of dropOffers) {
    if (!o.url) continue;
    // ⛔ Marknadsplatslänkar (Cardmarket/Tradera/CardTrader) hör inte hemma i
    //    denylistan: den läses BARA av `ensureListingProduct`, som skapar produkter ur
    //    BUTIKSFEEDAR. En Tradera-annons blir aldrig en katalogprodukt den vägen, så en
    //    post där skyddar ingenting — den gör bara listan svårare att läsa. (Omgång 1
    //    och 2 hann skriva in några sådana; de är harmlösa och lämnas.)
    if (o.retailerName && !isStoreRetailer(o.retailerName)) continue;
    const clash = keepOffers.some(
      (k) => k.retailerId === o.retailerId && k.condition === o.condition && k.language === o.language
    );
    if (clash) out.push(o.url);
  }
  return out;
}

/**
 * Fel som gör att INGENTING får köras, plus en STÄDAD kopia av besluten.
 *
 * ⛔ EN UPPREPNING ÄR INTE ALLTID ETT FEL. Ägarens första riktiga lista (2026-08-13)
 *    hade samma URL två gånger i raderingslistan — helt harmlöst, men en regel som
 *    bara sa "slugen förekommer två gånger" hade stoppat hela körningen på det.
 *    Det som FAKTISKT är farligt är motstridiga roller: samma produkt som mål på ett
 *    ställe och bortplockad på ett annat, eller bortplockad i två olika mergar (vilket
 *    mål gäller?). De felen fälls; ren upprepning dedupliceras och nämns.
 */
export function validateDecisions(
  decisions: Decision[],
  known: ReadonlySet<string>
): { errors: string[]; notes: string[]; cleaned: Decision[] } {
  const errors: string[] = [];
  const notes: string[] = [];

  const cleaned: Decision[] = decisions.map((d) => ({ ...d, drop: [...new Set(d.drop)] }));
  for (let i = 0; i < decisions.length; i++) {
    const removed = decisions[i].drop.length - cleaned[i].drop.length;
    if (removed > 0) notes.push(`Rad ${decisions[i].line}: ${removed} upprepad länk i samma grupp — räknas en gång.`);
  }

  const asKeep = new Map<string, number[]>();
  const asDropMerge = new Map<string, number[]>();
  const asDropDelete = new Map<string, number[]>();
  const push = (m: Map<string, number[]>, k: string, v: number) => m.set(k, [...(m.get(k) ?? []), v]);

  for (const d of cleaned) {
    for (const s of [...d.drop, ...(d.keep ? [d.keep] : [])]) {
      if (!known.has(s)) errors.push(`Rad ${d.line}: hittar ingen produkt med slug "${s}".`);
    }
    if (d.keep) push(asKeep, d.keep, d.line);
    for (const s of d.drop) push(d.kind === "merge" ? asDropMerge : asDropDelete, s, d.line);
    if (d.kind === "merge") {
      if (!d.keep) errors.push(`Rad ${d.line}: dubblettgrupp utan mål — saknas en "Goes to"-rad?`);
      if (d.drop.length === 0) errors.push(`Rad ${d.line}: mål angivet men inga produkter att slå ihop.`);
      if (d.keep && d.drop.includes(d.keep)) errors.push(`Rad ${d.line}: målet står också i listan som ska bort.`);
    }
  }

  for (const [s, lines] of asDropMerge) {
    if (lines.length > 1) errors.push(`"${s}" ska slås ihop på flera ställen (rad ${lines.join(", ")}) — vilket mål gäller?`);
    if (asKeep.has(s)) errors.push(`"${s}" är mål på rad ${asKeep.get(s)!.join(", ")} men plockas bort på rad ${lines.join(", ")}.`);
    if (asDropDelete.has(s)) errors.push(`"${s}" ska både slås ihop (rad ${lines.join(", ")}) och raderas (rad ${asDropDelete.get(s)!.join(", ")}).`);
  }
  for (const [s, lines] of asDropDelete) {
    if (asKeep.has(s)) errors.push(`"${s}" är mål på rad ${asKeep.get(s)!.join(", ")} men raderas på rad ${lines.join(", ")}.`);
    if (lines.length > 1) notes.push(`"${s}" står i raderingslistan ${lines.length} gånger (rad ${lines.join(", ")}) — raderas en gång.`);
  }

  // Samma slug i två DELETE-grupper: behåll den första förekomsten, tappa resten.
  const takenDelete = new Set<string>();
  for (const d of cleaned) {
    if (d.kind !== "delete") continue;
    d.drop = d.drop.filter((s) => !takenDelete.has(s));
    for (const s of d.drop) takenDelete.add(s);
  }

  return { errors, notes, cleaned: cleaned.filter((d) => d.drop.length > 0 || d.keep) };
}
