/**
 * Set-etikett för sealed — SATT DÄR IDENTITETEN AVGÖRS, inte en vecka senare.
 *
 * BAKGRUNDEN. En auto-importerad sealed-produkt (butiken börjar sälja en
 * förhandsbox) skapas med `setId = null`. Etiketten sattes tidigare BARA av
 * `import-sealed-from-cardmarket.ts`, som kör VECKOVIS (söndagar 04:00), och bara
 * om ett CardSet med episodens namn redan fanns. För en förhandsbox av ett
 * OSLÄPPT set fanns det oftast inte — pokemontcg.io publicerar set först vid
 * release — så etiketten kunde dröja veckor. Under tiden är produkten osynlig för
 * set-bevakningen (`SetWatch`), som är just den funktion man köper för att bevaka
 * kommande släpp. Mätt 2026-08-06: median ~4 dygn, värsta realistiska fall veckor.
 *
 * VAD DET HÄR GÖR. `runCardmarketRefresh` (dagligen 13:00) matchar redan varje
 * set-lös stub mot Cardmarkets katalog för att sätta pris — och den matchade
 * CM-produkten BÄR sin episod. Etiketten kan alltså sättas i samma andetag.
 * Väntetiden går från veckor till ≤24h utan ett enda extra katalog-anrop.
 *
 * ⛔ DET HÄR ÄR INGEN NY GISSNING. Regeln "sätt aldrig set från titeltext" gäller
 * fortfarande: hoppet episod → set är CM:s EGET episodnamn för den matchade
 * produkten, precis som veckojobbet. Det fuzzy-steget (`bestSealedMatch`, tröskel
 * 0.72) fanns redan och avgör redan i dag vilket set produkten får — bara en vecka
 * senare. Vi flyttar beslutet, vi sänker inte ribban.
 */
import { prisma } from "@/lib/db";
import { cmSetNameKey } from "@/jobs/cardmarket-refresh";

// ⛔ LÄS NYCKELN VID ANROPET, inte vid modulinläsningen. En modul-konstant fryser
// värdet vid första import: jobbet läser sin .env innan det anropar oss, men i ett
// test (eller vilken anropare som helst som sätter miljön senare) är konstanten
// redan tom — och `fetchCmEpisodes` returnerar då [] UTAN att felа, så B2 slutar
// tyst skapa set. Exakt det hände: testerna gröna lokalt (.env fanns) och röda i
// CI (ingen nyckel). Samma familj som proUserWhere() — en modul-konstant fryser
// tillstånd som måste läsas när det används.
const host = () => process.env.CARDMARKET_RAPIDAPI_HOST ?? "cardmarket-api-tcg.p.rapidapi.com";
const key = () => process.env.CARDMARKET_RAPIDAPI_KEY ?? "";

export interface CmEpisode {
  id: number;
  name: string;
  released_at: string | null;
  logo: string | null;
  cards_total: number | null;
  series: { name: string } | null;
}

/**
 * Hela episodlistan. Samma paginering som `set-from-cm-episode.ts`:
 * `paging.total` = ANTAL SIDOR (metadatan om antal kort ljuger, sidantalet gör det
 * inte — se cardmarket-refresh). Några sidor, en gång per körning.
 */
export async function fetchCmEpisodes(): Promise<CmEpisode[]> {
  const HOST = host();
  const KEY = key();
  if (!KEY) return [];
  const out: CmEpisode[] = [];
  for (let page = 1; page <= 50; page++) {
    const res = await fetch(`https://${HOST}/pokemon/episodes?page=${page}`, {
      headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": KEY },
    });
    if (!res.ok) break;
    const j = (await res.json()) as { data?: CmEpisode[]; paging?: { total?: number } };
    const rows = j.data ?? [];
    out.push(...rows);
    if (rows.length === 0 || (j.paging?.total != null && page >= j.paging.total)) break;
  }
  return out;
}

export interface SetLabelerStats {
  /** Produkter som fick en etikett. */
  labeled: number;
  /** CardSet skapade ur en CM-episod (B2). */
  setsCreated: number;
  /** Episodnamn som matchade FLERA av våra set → vi vägrar gissa. */
  ambiguous: number;
  /** Episoder utan serie hos CM → skulle bli ett set utan hemvist. */
  noSeries: number;
  /** Episodnamnet fanns inte i vår katalog och kunde inte skapas. */
  unresolved: number;
  createdNames: string[];
}

export interface SetLabeler {
  /**
   * Etikettera EN produkt. Returnerar setId om något skrevs, annars null.
   * Idempotent och additiv: en produkt som redan har ett set rörs aldrig.
   */
  label(productId: string, currentSetId: string | null, episodeName: string | null | undefined): Promise<string | null>;
  stats: SetLabelerStats;
}

/**
 * @param createMissing B2: skapa CardSet ur CM-episoden när det saknas. Sätts av
 *   anroparen så en torrkörning eller ett riktat jobb kan låta bli att skapa set.
 */
export async function createSetLabeler(createMissing: boolean): Promise<SetLabeler> {
  // Namnnyckel → vårt setId. `null` = TVETYDIGT (två set normaliserar lika) →
  // etikettera inte. Samma vakt som singel-fasens `setsByName`: hellre ingen
  // etikett än fel set, för en felaktig etikett syns aldrig och sitter kvar.
  // ⛔ Bara ENGELSKA set. Episoderna kommer ur CM:s västerländska katalog, medan
  // japanska set (skapade ur CM:s expansioner, se jp-set-label.ts) bär SAMMA
  // latinska namn — "Black Bolt", "151". Utan språkgrinden hade en engelsk
  // förhandsbox kunnat få det japanska setets etikett.
  const byName = new Map<string, string | null>();
  for (const s of await prisma.cardSet.findMany({ where: { language: "EN" }, select: { id: true, name: true } })) {
    const key = cmSetNameKey(s.name);
    if (!key) continue;
    byName.set(key, byName.has(key) ? null : s.id);
  }

  // Episodlistan hämtas BARA när vi kan komma att skapa set — annars är den ren
  // kvotförbrukning (etiketteringen behöver bara episodens NAMN, som redan sitter
  // på den matchade produkten).
  const episodes = createMissing ? await fetchCmEpisodes() : [];
  const epByName = new Map<string, CmEpisode>();
  for (const e of episodes) {
    const key = cmSetNameKey(e.name);
    if (key && !epByName.has(key)) epByName.set(key, e);
  }

  const stats: SetLabelerStats = {
    labeled: 0, setsCreated: 0, ambiguous: 0, noSeries: 0, unresolved: 0, createdNames: [],
  };
  /** Episodnamn vi redan gett upp på — logga och räkna en gång, inte per produkt. */
  const gaveUp = new Set<string>();

  async function resolveSetId(episodeName: string): Promise<string | null> {
    const key = cmSetNameKey(episodeName);
    if (!key) return null;

    if (byName.has(key)) {
      const id = byName.get(key)!;
      if (id === null && !gaveUp.has(key)) {
        gaveUp.add(key);
        stats.ambiguous++;
        console.log(
          `[set-etikett] "${episodeName}" matchar FLERA av våra set — etiketterar inte (gissar aldrig).`
        );
      }
      return id;
    }

    if (!createMissing) {
      if (!gaveUp.has(key)) { gaveUp.add(key); stats.unresolved++; }
      return null;
    }

    const ep = epByName.get(key);
    if (!ep) {
      if (!gaveUp.has(key)) {
        gaveUp.add(key);
        stats.unresolved++;
        console.log(`[set-etikett] "${episodeName}" finns varken som set hos oss eller i CM:s episodlista.`);
      }
      return null;
    }
    // Utan serie skulle setet sakna hemvist i /sets-grupperingen. Samma vägran som
    // den manuella `set-from-cm-episode.ts` gör — den är facit för det här formatet.
    const series = ep.series?.name ?? null;
    if (!series) {
      if (!gaveUp.has(key)) {
        gaveUp.add(key);
        stats.noSeries++;
        console.log(`[set-etikett] Episod "${ep.name}" saknar serie hos CM → skapar inget set.`);
      }
      return null;
    }

    // ⛔ externalId lämnas NULL med flit. `import-tcg-data.ts` adopterar raden på
    // NAMN när pokemontcg.io får setet och sätter identiteten då. Ett gissat
    // externalId som visar sig fel ger två set med samma namn i filtret — och
    // produkterna sitter kvar på fel rad.
    const created = await prisma.cardSet.create({
      data: {
        name: ep.name,
        series,
        releaseDate: ep.released_at ? new Date(`${ep.released_at}T00:00:00.000Z`) : null,
        logoUrl: ep.logo,
        totalCards: ep.cards_total ?? 0,
      },
      select: { id: true },
    });
    byName.set(key, created.id);
    stats.setsCreated++;
    stats.createdNames.push(ep.name);
    console.log(`[set-etikett] NYTT SET ur CM-episod: "${ep.name}" (serie ${series}) → ${created.id}`);
    return created.id;
  }

  return {
    stats,
    async label(productId, currentSetId, episodeName) {
      // Aldrig skriva över. En etikett som redan finns är antingen pokemontcg.io:s
      // eller en tidigare körnings — båda väger tyngre än en ny matchning.
      if (currentSetId != null) return null;
      if (!episodeName) return null;
      const setId = await resolveSetId(episodeName);
      if (!setId) return null;
      await prisma.product.update({ where: { id: productId }, data: { setId } });
      stats.labeled++;
      return setId;
    },
  };
}
