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
const KEEP_RE = /^(?:(?:goes\s*to|g[åa]r\s*till|till|beh[åa]ll|keep|merge\s*(?:in)?to|mergas?\s*till)\b|->|=>|→|>)\s*/i;
const DELETE_RE = /^(?:delete|radera|ta\s*bort|bort|skrota|remove|x)\b\s*[:\-]?\s*/i;
const DUPES_RE = /^(?:duplicates?|dubbletter?|dubblett|merge|merga|sl[åa]\s*ihop|same)\b\s*[:\-]?\s*$/i;
const COMMENT_RE = /^\s*(?:#|\/\/)/;

/** Produktens slug ur en foilio-länk, en relativ sökväg eller en bar slug. */
const SLUG_RE = /(?:https?:\/\/[^\s/]*foilio\.se)?\/?(?:[a-z]{2}\/)?produkter\/([a-z0-9][a-z0-9-]{2,})/i;
const BARE_SLUG_RE = /^([a-z0-9][a-z0-9-]{6,})$/i;

export function slugOf(text: string): string | null {
  const m = text.match(SLUG_RE);
  if (m) return m[1].toLowerCase().replace(/[?#].*$/, "");
  // Bar slug godtas BARA när raden inte innehåller något annat och innehåller ett
  // bindestreck — annars hade varje enstaka ord i en inklistrad titel blivit en slug.
  const bare = text.trim().match(BARE_SLUG_RE);
  return bare && bare[1].includes("-") ? bare[1].toLowerCase() : null;
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
      const s = slugOf(rest);
      if (s) {
        // "x <länk>" — en radering oavsett vad som pågick.
        if (cur?.kind === "delete") cur.drop.push(s);
        else {
          flush();
          cur = { kind: "delete", drop: [s], keep: null, line: n };
        }
      } else {
        // Bar "Delete"-rubrik → allt som följer raderas.
        flush();
        cur = { kind: "delete", drop: [], keep: null, line: n };
      }
      continue;
    }

    if (KEEP_RE.test(line)) {
      const s = slugOf(line.replace(KEEP_RE, ""));
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

    const s = slugOf(line);
    if (!s) continue; // fri text (titlar, anteckningar) — ignoreras med flit
    if (!cur) cur = { kind: "merge", drop: [], keep: null, line: n };
    if (expectKeep && !cur.keep) {
      cur.keep = s;
      flush();
    } else {
      cur.drop.push(s);
    }
  }
  flush();
  return { decisions, problems };
}

export type OfferKey = { url: string | null; retailerId: string; condition: string; language: string };

/**
 * Butiks-URL:er som blir HERRELÖSA av en merge.
 *
 * `Offer` är unik på (produkt, butik, skick, språk), så när stubbens offer krockar
 * med en som målet redan har RADERAR `mergeStubInto` stubbens rad. URL:en pekar då
 * inte längre på någon offer, och två saker händer vid nästa skrapning:
 *   · matchar URL:en ingen produkt skapas stubben om (mätt 2026-07-14: tre stubbar
 *     återuppstod sju minuter efter en merge), och
 *   · matchar den nu MÅLET — vilket den gör efter en titeltvätt — skriver den över
 *     målets offer, så länk och pris börjar växla mellan de två listningarna vid
 *     varje körning. Rogerz momstvillingar har olika `?variant=`-URL:er och olika
 *     pris, så växlingen syns direkt i katalogen.
 * Båda fallen löses av att den förlorande URL:en denylistas.
 */
export function orphanedOfferUrls(dropOffers: OfferKey[], keepOffers: OfferKey[]): string[] {
  const out: string[] = [];
  for (const o of dropOffers) {
    if (!o.url) continue;
    const clash = keepOffers.some(
      (k) => k.retailerId === o.retailerId && k.condition === o.condition && k.language === o.language
    );
    if (clash) out.push(o.url);
  }
  return out;
}

/** Fel som gör att INGENTING får köras. Kräver en slug→finns-uppslagning. */
export function validateDecisions(decisions: Decision[], known: ReadonlySet<string>): string[] {
  const errors: string[] = [];
  const seen = new Map<string, number>();
  for (const d of decisions) {
    for (const s of [...d.drop, ...(d.keep ? [d.keep] : [])]) {
      if (!known.has(s)) errors.push(`Rad ${d.line}: hittar ingen produkt med slug "${s}".`);
      const prev = seen.get(s);
      if (prev !== undefined) errors.push(`Rad ${d.line}: "${s}" står redan i beslutet på rad ${prev}.`);
      seen.set(s, d.line);
    }
    if (d.kind === "merge") {
      if (!d.keep) errors.push(`Rad ${d.line}: dubblettgrupp utan mål — saknas en "Goes to"-rad?`);
      if (d.drop.length === 0) errors.push(`Rad ${d.line}: mål angivet men inga produkter att slå ihop.`);
      if (d.keep && d.drop.includes(d.keep)) errors.push(`Rad ${d.line}: målet står också i listan som ska bort.`);
    }
  }
  return errors;
}
