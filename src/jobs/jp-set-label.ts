/**
 * JAPANSKA SET — skapa dem ur Cardmarkets expansioner och etikettera produkterna.
 *
 * VARFÖR (mätt 2026-08-07): alla 100 japanska produkter i katalogen hade
 * `setId = null`, för katalogens set kommer från pokemontcg.io som bara har
 * engelska set. Japanska set gick alltså inte att filtrera på — de fanns inte.
 * TCGGO stänger inte hålet (175 västerländska episoder, `?language=japanese`
 * ignoreras tyst), men Cardmarkets publika sealed-katalog gör det: den grupperar
 * produkterna i `idExpansion` och namnger dem i latinsk skrift. Se `jp-set-name.ts`.
 *
 * IDENTITETEN ÄR CM:S EXPANSION, INTE ETT NAMN. Kopplingen produkt → set går
 * produkt → vår CM-offer (`idProduct` i URL:en) → CM:s katalograd → `idExpansion`
 * → `CardSet.cmExpansionId`. Ingen titelmatchning i något led, och därför
 * idempotent: samma expansion hittar alltid tillbaka till samma set.
 *
 * ⛔ SÄTTER ALDRIG `externalId`. Det fältet är pokemontcg.io:s identitet, och ett
 *    gissat värde ger två rader med samma namn i filtret den dag källan får setet
 *    (samma regel som för kommande CM-episoder).
 */
import { TCGDEX_BASE, tcgdexJson } from "../lib/tcgdex";
import { prisma } from "../lib/db";
import {
  codeFromJpSetName,
  codesInTitle,
  deriveJpSetName,
  jpSeriesFromTcgdexId,
  jpSetDisplayName,
  pickJpSetImage,
  releaseDateAgrees,
  JP_CODE_BY_NAME,
  JP_CODE_VERIFIED,
  JP_SERIES_BY_TCGDEX_ID,
  JP_SERIES_UNKNOWN,
  type CmCatalogRow,
} from "../lib/jp-set-name";

/** CM-katalograd. `dateAdded` behövs för datumprövningen av en föreslagen setkod. */
export interface JpCatalogRow extends CmCatalogRow {
  idProduct: number;
  idExpansion: number;
  dateAdded?: string;
}

export interface JpSetLabelResult {
  /** JP-produkter utan set som vi tittade på. */
  candidates: number;
  /** Produkter som fick en set-etikett. */
  labeled: number;
  /** Nya CardSet skapade ur en CM-expansion. */
  setsCreated: number;
  createdNames: string[];
  /** Expansioner vars namn inte gick att härleda ur CM:s produktnamn. */
  unnamed: number;
  /** Produkter utan CM-offer → ingen expansion → ingen etikett. */
  noCmLink: number;
  /** Set som fick eller uppdaterade serie/bild i efterhandspasset. */
  metadataFilled: number;
}

interface TcgdexSet {
  id?: string;
  releaseDate?: string;
  serie?: { id?: string };
}

/**
 * TCGdex ger BARA släppdatumet (sorteringsordningen). Namnet tas från Cardmarket —
 * TCGdex japanska namn är japansk skrift och dessutom mätbart fel på minst ett set
 * (SV4a bär Raging Surfs namn men Shiny Treasures datum). Gratis, ingen nyckel.
 */
async function fetchTcgdexSet(code: string): Promise<TcgdexSet | null> {
  try {
    const j = await tcgdexJson<TcgdexSet>(`${TCGDEX_BASE}/ja/sets/${encodeURIComponent(code)}`);
    if (!j) return null;
    // ⛔ Id:t måste vara DET vi bad om. TCGdex slår upp löst, och ett svar för ett
    //    annat set hade gett fel släppdatum utan att något felar.
    if (!j.id || j.id.toLowerCase() !== code.toLowerCase()) return null;
    return j;
  } catch {
    return null;
  }
}

/**
 * Setkoden ur CARDTRADERS expansionslista, för set vars namn saknar kod.
 *
 * VARFÖR EN TREDJE KÄLLA. Ett japanskt set dyker upp hos Cardmarket långt innan
 * TCGdex publicerar det — Storm Emeralda låg i CM:s katalog 2026-07-02 medan
 * TCGdex fortfarande slutade på M5. Butikstitlarna bar ingen kod heller, så setet
 * skapades utan kod, utan era och utan släppdatum, och kunde aldrig få det.
 * CardTrader (som vi redan använder) för en egen expansionslista med koder som
 * stämmer med TCGdex på varje set vi jämfört, och hade M6 redan.
 *
 * ⛔ KRÄV ETT ENTYDIGT NAMN. CardTrader listar BÅDE "Black Bolt | sv11B" (japanska)
 *    och "Black Bolt" (`blk`, den internationella) — ett namnuppslag som accepterar
 *    flera träffar hade kunnat ge ett japanskt set den internationella koden.
 * ⛔ FILTRERA PÅ SPELET. Listan innehåller ALLA spel CardTrader säljer, inte bara
 *    Pokémon: "25th Anniversary" matchade en Yu-Gi-Oh!-expansion och hade döpt vårt
 *    set till "25th Anniversary (25THYUG)" om torrkörningen inte visat det.
 * ⛔ Utan token: null, och allt fortsätter som förut.
 */
const CT_POKEMON_GAME_ID = 5;
let ctExpansions: { code: string; name: string; game_id: number }[] | null = null;
async function cardTraderCode(setName: string): Promise<string | null> {
  const token = process.env.CARDTRADER_TOKEN;
  if (!token) return null;
  if (!ctExpansions) {
    try {
      const r = await fetch("https://api.cardtrader.com/api/v2/expansions", {
        headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(20000),
      });
      if (!r.ok) return null;
      ctExpansions = (await r.json()) as { code: string; name: string; game_id: number }[];
    } catch {
      return null;
    }
  }
  const key = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const hits = ctExpansions.filter((e) => e.game_id === CT_POKEMON_GAME_ID && key(e.name) === key(setName));
  return hits.length === 1 ? hits[0].code : null;
}

/**
 * @param catalog Cardmarkets sealed-katalog (samma nedladdning som JP-prisrefreshen).
 * @param apply   false = torrkörning, inget skrivs.
 */
export async function runJapaneseSetLabels(
  catalog: JpCatalogRow[],
  apply = true
): Promise<JpSetLabelResult> {
  const res: JpSetLabelResult = {
    candidates: 0,
    labeled: 0,
    setsCreated: 0,
    createdNames: [],
    unnamed: 0,
    noCmLink: 0,
    metadataFilled: 0,
  };
  if (catalog.length === 0) return res; // Tom katalog (CDN-fel) → gör ingenting alls.

  const cm = await prisma.retailer.findFirst({ where: { name: "Cardmarket" }, select: { id: true } });
  if (!cm) return res;

  const products = await prisma.product.findMany({
    where: { language: "JP", setId: null, category: { notIn: ["SINGLE_CARD", "GRADED_CARD", "ACCESSORY"] } },
    select: {
      id: true,
      title: true,
      offers: { where: { retailerId: cm.id }, select: { url: true } },
    },
  });
  res.candidates = products.length;
  if (products.length === 0) {
    // Inga nya produkter betyder inte att inget är att göra: ett set kan ha fått
    // sin första produktbild sedan sist, och de set som skapades innan serie/bild
    // fanns ska läka av sig själva.
    res.metadataFilled = await refreshJpSetMetadata(apply);
    return res;
  }

  const rowById = new Map(catalog.map((r) => [r.idProduct, r]));
  const rowsByExpansion = new Map<number, JpCatalogRow[]>();
  for (const r of catalog) {
    const list = rowsByExpansion.get(r.idExpansion);
    if (list) list.push(r);
    else rowsByExpansion.set(r.idExpansion, [r]);
  }

  // Befintliga japanska set: expansion → setId, plus namnen (dubblettvakt).
  const existing = await prisma.cardSet.findMany({
    where: { language: "JP" },
    select: { id: true, name: true, cmExpansionId: true },
  });
  const setByExpansion = new Map<number, string>();
  const takenNames = new Set<string>();
  for (const s of existing) {
    if (s.cmExpansionId != null) setByExpansion.set(s.cmExpansionId, s.id);
    takenNames.add(s.name.toLowerCase());
  }

  // Vilka setkoder butikstitlarna i varje expansion bär. Koden är TILLVERKARENS
  // egen identitet ("- sv6", "(s6K)") — den läses per expansion så en produkt utan
  // kod får glädje av sina syskon i samma expansion.
  const codesByExpansion = new Map<number, Set<string>>();
  for (const p of products) {
    const idProduct = Number(p.offers[0]?.url?.match(/idProduct=(\d+)/)?.[1] ?? 0);
    const row = idProduct ? rowById.get(idProduct) : undefined;
    if (!row) continue;
    const set = codesByExpansion.get(row.idExpansion) ?? new Set<string>();
    for (const c of codesInTitle(p.title)) set.add(c);
    codesByExpansion.set(row.idExpansion, set);
  }

  for (const p of products) {
    const idProduct = Number(p.offers[0]?.url?.match(/idProduct=(\d+)/)?.[1] ?? 0);
    const row = idProduct ? rowById.get(idProduct) : undefined;
    if (!row) {
      res.noCmLink++;
      continue;
    }
    const expansion = row.idExpansion;

    let setId = setByExpansion.get(expansion);
    if (!setId) {
      const rows = rowsByExpansion.get(expansion) ?? [];
      const baseName = deriveJpSetName(rows);
      if (!baseName) {
        res.unnamed++;
        continue;
      }

      // Kod: butikstitlarnas egen setkod om den är ENTYDIG i expansionen, annars
      // det dokumenterade förslaget för namnet. Båda måste klara datumprövningen.
      const titleCodes = [...(codesByExpansion.get(expansion) ?? [])];
      const proposed =
        titleCodes.length === 1 ? titleCodes[0] : JP_CODE_BY_NAME[baseName.toLowerCase()] ?? null;

      let code: string | null = null;
      let releaseDate: Date | null = null;
      let series = JP_SERIES_UNKNOWN;
      if (proposed) {
        const tcg = await fetchTcgdexSet(proposed);
        const firstAdded = rows
          .map((r) => (r.dateAdded && !r.dateAdded.startsWith("0000") ? Date.parse(r.dateAdded.replace(" ", "T")) : NaN))
          .filter((t) => Number.isFinite(t))
          .sort((a, b) => a - b)[0];
        if (tcg?.releaseDate) {
          const rel = new Date(tcg.releaseDate);
          // Koden ur titeln är redan bevisad (tillverkarens egen), förslaget ur
          // tabellen är det inte — det senare måste stämma mot datumfönstret.
          const proven =
            titleCodes.length === 1 ||
            (Number.isFinite(firstAdded) && releaseDateAgrees(new Date(firstAdded), rel));
          if (proven) {
            code = tcg.id ?? proposed;
            releaseDate = rel;
            // Serien kommer från SAMMA styrkta rad som datumet. Utan styrkt kod
            // får setet ingen serie alls — det hamnar i "Other" sist, i stället
            // för att gissas in i en era.
            series = jpSeriesFromTcgdexId(tcg.serie?.id);
          }
        } else if (titleCodes.length === 1) {
          // TCGdex saknar setet: koden är ändå butikens egen och duger till namnet.
          code = proposed.toUpperCase();
        }
      }

      const name = jpSetDisplayName(baseName, code);
      if (takenNames.has(name.toLowerCase())) {
        // Två expansioner som normaliserar till samma namn: hellre ett omärkt set
        // än två identiska rader i filtret som ingen kan skilja åt.
        console.warn(`[jp-set] hoppar över expansion ${expansion}: namnet "${name}" är redan taget.`);
        continue;
      }

      if (!apply) {
        console.log(`[jp-set] SKULLE skapa "${name}" (expansion ${expansion}, släpp ${releaseDate?.toISOString().slice(0, 10) ?? "-"})`);
        res.setsCreated++;
        res.createdNames.push(name);
        takenNames.add(name.toLowerCase());
        // ⛔ Registrera det TÄNKTA setet ändå. Utan detta ser nästa produkt i samma
        // expansion inget set, försöker skapa ett till och fastnar i dubblettvakten
        // — torrkörningen rapporterade då "0 etiketterade" plus en rad falska
        // varningar om upptagna namn. En torrkörning som ljuger om utfallet är
        // sämre än ingen torrkörning.
        setByExpansion.set(expansion, `dry-run:${expansion}`);
        res.labeled++;
        continue;
      }

      const created = await prisma.cardSet.create({
        data: {
          name,
          series,
          language: "JP",
          cmExpansionId: expansion,
          releaseDate,
          // ⛔ `totalCards` lämnas 0. TCGdex vet att SV11B har 174 kort, men VI har
          // inga japanska singlar i katalogen — setsidan skriver ut talet rakt av
          // ("174 kort") och hade då lovat kort som inte finns hos oss. 0 betyder
          // här "noll kort i vår katalog", vilket är sant.
          // ⛔ externalId lämnas NULL — se filhuvudet.
        },
        select: { id: true },
      });
      setId = created.id;
      setByExpansion.set(expansion, setId);
      takenNames.add(name.toLowerCase());
      res.setsCreated++;
      res.createdNames.push(name);
      console.log(`[jp-set] skapade "${name}" (expansion ${expansion}).`);
    }

    if (!apply) {
      res.labeled++;
      continue;
    }
    // Villkoret `setId: null` i uppdateringen: en etikett skrivs aldrig över, ens
    // om något annat jobb hann först mellan läsningen och skrivningen.
    const upd = await prisma.product.updateMany({
      where: { id: p.id, setId: null },
      data: { setId },
    });
    res.labeled += upd.count;
  }

  res.metadataFilled = await refreshJpSetMetadata(apply);

  if (res.setsCreated || res.labeled) {
    console.log(
      `[jp-set] ${res.labeled}/${res.candidates} japanska produkter etiketterade, ${res.setsCreated} nya set.`
    );
  }
  return res;
}

/**
 * Fyller i serie och bild på japanska set som saknar dem.
 *
 * VARFÖR ETT EGET PASS. Bilden kommer från setets produkter, och ett set skapas i
 * samma andetag som sin FÖRSTA produkt — den kan sakna bild då och få en senare
 * (auto-importen fyller på). Serien fanns dessutom inte alls när de första seten
 * skapades. Ett pass som bara rör TOMMA fält är både backfill och självläkning,
 * och kostar en fråga på ~50 rader.
 *
 * ⛔ Skriver aldrig över ett ifyllt fält: en serie som redan står där kan vara
 *    rättad för hand, och en bild som redan valts ska inte hoppa runt mellan
 *    körningar bara för att sorteringen av produkter råkar ändras.
 */
export async function refreshJpSetMetadata(apply = true): Promise<number> {
  // "Serien saknas" = värdet är inte en era vi känner igen OCH inte "Other".
  // ⛔ Formulerat som en mängd, inte som en jämförelse mot en gammal konstant: de
  //    första japanska seten skapades med platshållaren "Japanska set", och en
  //    hårdkodad legacy-sträng hade behövt leva kvar i koden för alltid. "Other"
  //    räknas som FÄRDIGT — ett set utan styrkt kod får aldrig en era, så att
  //    fråga TCGdex om det igen varje körning vore ren kvotförbrukning utan utfall.
  const settledSeries = [...Object.values(JP_SERIES_BY_TCGDEX_ID), JP_SERIES_UNKNOWN];
  const sets = await prisma.cardSet.findMany({
    where: {
      language: "JP",
      // `releaseDate: null` står med FÖR ATT KUNNA LÄKA SENARE: ett set som CM har
      // före TCGdex (Storm Emeralda) får varken era eller datum vid skapandet, och
      // utan ett återförsök hade det suttit i "Other" för alltid. Sätten är få
      // (1-2), så återförsöket kostar ett TCGdex-anrop per körning.
      OR: [{ logoUrl: null }, { series: { notIn: settledSeries } }, { releaseDate: null }],
    },
    select: {
      id: true,
      name: true,
      series: true,
      logoUrl: true,
      releaseDate: true,
      products: { select: { category: true, imageUrl: true } },
    },
  });
  let filled = 0;
  for (const s of sets) {
    const data: { logoUrl?: string; series?: string; name?: string; releaseDate?: Date } = {};

    if (!s.logoUrl) {
      // Produktbilden är FALLBACKEN. Riktiga setlogotyper ligger i
      // `public/set-logos/jp/` och pekas ut av `scripts/fetch-jp-set-logos.ts`,
      // som skriver sökvägen till setet direkt — jobbet behöver alltså aldrig
      // titta på disk (och FÅR inte: modulen dras in i Next-bygget via
      // instrumentation.ts, där `fs` inte finns). Ett nytt set får
      // boosterpåsens omslag tills någon kört logotypskriptet igen.
      const image = pickJpSetImage(s.products);
      if (image) data.logoUrl = image;
    }

    const needsSeries = !settledSeries.includes(s.series);
    if (needsSeries || !s.releaseDate) {
      // Koden står normalt i namnet vi själva skrivit. Saknas den (setet fanns hos
      // CM före TCGdex) frågar vi CardTrader — en KÄLLA, inte en gissning — och
      // skriver in koden i namnet så den finns kvar till nästa körning.
      let code = codeFromJpSetName(s.name);
      if (!code) {
        const base = s.name.replace(/\s*\([^)]*\)\s*$/, "");
        // Egen granskad tabell först (koden är kontrollerad mot setets ordbild),
        // därefter CardTrader. Båda är källor, inte gissningar.
        const reviewed = JP_CODE_VERIFIED[base.toLowerCase()];
        const ct = reviewed ? null : await cardTraderCode(base);
        const found = reviewed?.code ?? ct;
        if (found) {
          code = reviewed ? found : found.toUpperCase();
          data.name = jpSetDisplayName(base, code);
          console.log(
            `[jp-set] "${s.name}" fick kod ${code} från ${reviewed ? `granskad tabell (${reviewed.verified})` : "CardTrader"}.`
          );
        }
      }
      const tcg = code ? await fetchTcgdexSet(code) : null;
      // ⛔ Serien skrivs ÄVEN när den blir "Other": annars står setet kvar med ett
      //    oavgjort värde och frågas om vid varje körning i all evighet. Datumet
      //    däremot lämnas orört när TCGdex inte har setet ännu — då är `releaseDate`
      //    fortsatt null och raden plockas upp igen nästa gång, vilket är precis
      //    vad som får ett nysläppt set att läka in i rätt era av sig självt.
      const resolvedSeries = jpSeriesFromTcgdexId(tcg?.serie?.id);
      if (needsSeries) data.series = resolvedSeries;
      // UPPGRADERA "Other" när TCGdex hunnit ikapp. Utan den här raden hade ett set
      // som skapats före TCGdex fått sitt datum men blivit kvar i "Other" för alltid,
      // eftersom "Other" räknas som ett avgjort värde.
      else if (resolvedSeries !== JP_SERIES_UNKNOWN && s.series !== resolvedSeries) data.series = resolvedSeries;
      if (!s.releaseDate && tcg?.releaseDate) data.releaseDate = new Date(tcg.releaseDate);
    }

    if (Object.keys(data).length === 0) continue;
    filled++;
    if (!apply) {
      console.log(`[jp-set] SKULLE fylla "${s.name}": ${JSON.stringify(data)}`);
      continue;
    }
    await prisma.cardSet.update({ where: { id: s.id }, data });
  }
  if (filled) console.log(`[jp-set] fyllde serie/bild på ${filled} japanska set.`);
  return filled;
}
