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
import { prisma } from "../lib/db";
import {
  codesInTitle,
  deriveJpSetName,
  jpSetDisplayName,
  releaseDateAgrees,
  JP_CODE_BY_NAME,
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
}

/** Serien japanska set hamnar i. JP-fliken är platt, så den syns inte i filtret. */
export const JP_SERIES = "Japanska set";

interface TcgdexSet {
  id?: string;
  releaseDate?: string;
}

/**
 * TCGdex ger BARA släppdatumet (sorteringsordningen). Namnet tas från Cardmarket —
 * TCGdex japanska namn är japansk skrift och dessutom mätbart fel på minst ett set
 * (SV4a bär Raging Surfs namn men Shiny Treasures datum). Gratis, ingen nyckel.
 */
async function fetchTcgdexSet(code: string): Promise<TcgdexSet | null> {
  try {
    const r = await fetch(`https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(code)}`);
    if (!r.ok) return null;
    const j = (await r.json()) as TcgdexSet;
    // ⛔ Id:t måste vara DET vi bad om. TCGdex slår upp löst, och ett svar för ett
    //    annat set hade gett fel släppdatum utan att något felar.
    if (!j.id || j.id.toLowerCase() !== code.toLowerCase()) return null;
    return j;
  } catch {
    return null;
  }
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
  if (products.length === 0) return res;

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
          series: JP_SERIES,
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

  if (res.setsCreated || res.labeled) {
    console.log(
      `[jp-set] ${res.labeled}/${res.candidates} japanska produkter etiketterade, ${res.setsCreated} nya set.`
    );
  }
  return res;
}
