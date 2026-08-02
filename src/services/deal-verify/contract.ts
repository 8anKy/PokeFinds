/**
 * FYND-VERIFIERINGSKONTRAKTET — delat mellan alla LLM-leverantörer.
 *
 * ⛔ EN källa för systemprompten, fältspecen, user-prompten OCH tolkningen av
 * svaret. Exakt samma skäl som `src/services/scanner/vision-contract.ts`: byter
 * man leverantör vill man veta om MODELLEN blev bättre eller sämre, och två egna
 * prompter/parsers gör jämförelsen värdelös (då jämför man prompter). Här väger
 * det tyngre än i skannern, för utfallet är inte "fel kort i en lista" utan ett
 * FALSKT FYND i en betalfunktion — och vi har redan mätt att en LLM-verifiering
 * kan VÄLSIGNA felmatchningar (2026-07-07, tre fake deals).
 *
 * Leverantörsadaptern gör BARA tre saker: översätter fältspecen till sitt eget
 * schemaformat, skickar prompten, och lämnar tillbaka de råa fälten hit.
 */

/** Katalogposten som annonsen ska stämma mot. */
export interface DealVerifyProduct {
  title: string;
  category: string;
  /** Ungefärligt marknadspris i kronor (utelämnas i den globala matchningen). */
  refKr?: number;
}

/** Tradera-annonsen (titel + LongDescription ur GetItem). */
export interface DealVerifyListing {
  title: string;
  description: string;
}

/** Modellens dom. `null` från en adapter betyder ALLTID "kunde inte verifiera". */
export interface DealVerification {
  sameProduct: boolean;
  sealedComplete: boolean;
  reason: string;
}

export interface DealVerifyAdapter {
  readonly name: string;
  readonly model: string;
  /**
   * ⛔ FAILAR STÄNGT: returnerar `null` när svaret inte går att tolka som en
   * fullständig dom. Anroparen får då INTE skriva någon DealCheck/TraderaMatch
   * — en utebliven rad döljer annonsen (feeden kräver `DealCheck.ok = true`),
   * medan ett halvtolkat svar hade kunnat släppa igenom ett falskt fynd.
   */
  verify(
    product: DealVerifyProduct,
    listing: DealVerifyListing
  ): Promise<DealVerification | null>;
}

export const VERIFY_TOOL_NAME = "report_verification";
export const VERIFY_TOOL_DESCRIPTION =
  "Rapportera verifieringen av Tradera-annonsen mot katalogprodukten.";

export const SYSTEM = [
  "Du verifierar om en svensk Tradera-annons är SAMMA Pokémon TCG sealed-produkt som en katalogpost.",
  "Avgör TVÅ saker:",
  "1. sameProduct — samma set + samma produkttyp + samma variant? Avvisa (false) BARA vid en KONKRET motsägelse:",
  "   - olika set/expansion (Prismatic Evolutions ≠ Evolutions, Stellar Crown ≠ Stellar Miracle),",
  "     ÄVEN när ena setnamnet innehåller det andra: Dragon Majesty (2018) ≠ Dragon (EX Dragon, 2003),",
  "     151 ≠ Scarlet & Violet bas — extraordet ÄR setidentiteten,",
  "   - olika Pokémon/variant (Palkia ≠ Arceus, Zapdos 3-pack ≠ Pikachu 3-pack, Vaporeon ≠ Meowth),",
  "   - olika produkttyp (booster pack ≠ box ≠ ETB ≠ tin ≠ blister ≠ collection; sampling pack ≠ booster pack),",
  "   - olika OFFICIELLA produktnamn för samma Pokémon: 'Special Collection' ≠ 'EX Box' ≠ 'Premium Collection'",
  "     ≠ 'ex Box' — olika namngivna produkter är olika produkter även med samma Pokémon på asken,",
  "   - 'Pokémon Center'-exklusiv variant (t.ex. Pokémon Center ETB) ≠ vanlig variant utan 'Pokémon Center',",
  "   - olika antal (half booster box/18 paket ≠ hel box/36; enkelpack ≠ 3-pack),",
  "   - japansk produkt ≠ engelsk produkt, samt 'Ultra-Premium' ≠ 'Premium',",
  "   - UTGÅVANS språk skiljer: en spansk/tysk/fransk/italiensk utgåva (t.ex. 'Sobres', 'Caja',",
  "     'Destinos Paldeanos', 'Karmesin und Purpur', '*SPANSK*', '(ES)') är INTE den engelska produkten.",
  "   Följande är INTE skillnader (= samma produkt): serie-/era-namn som prefix (Scarlet & Violet, Sword & Shield,",
  "   Sun & Moon, Mega Evolution, XY m.fl. — det är setets familj, ingen variant); 'Display'/'Display Box' =",
  "   'Booster Box' (båda = 36 paket = hel box); annan ordföljd/stavning.",
  "   OBS skillnaden: att ANNONSTEXTEN är skriven på svenska säger inget om produkten (svensk butik,",
  "   engelsk vara) → ingen skillnad. Att SJÄLVA UTGÅVAN är på ett annat språk → olika produkt.",
  "   Osäker UTAN konkret motsägelse: sätt sameProduct = true (dölj inte en trolig äkta annons).",
  "2. sealedComplete — är det fortfarande den KOMPLETTA, fabriksförseglade (oöppnade) produkten?",
  "   false BARA om den är öppnad, tom ('tom ask'), endast asken, av-/omförseglad, saknar innehåll,",
  "   är en kopia/proxy, eller på annat sätt inte längre den förseglade produkten.",
  "   Mindre KOSMETISKA skavanker på en fortfarande FÖRSEGLAD vara (buckla, veck, repa, solblekning,",
  "   litet tryckmärke, 'skick som på bilderna'-friskrivning) gör den INTE ofullständig → sealedComplete = true.",
  "Ge en KORT motivering på svenska. Anropa alltid report_verification.",
].join(" ");

/** Fältspec i leverantörsneutral form. Varje adapter mappar `type` till sitt
 *  eget schemaspråk (Anthropic: gemener; Gemini/OpenAPI: VERSALER). */
export interface VerifyField {
  name: string;
  type: "boolean" | "string";
  description: string;
}

export const VERIFY_FIELDS: VerifyField[] = [
  { name: "sameProduct", type: "boolean", description: "Exakt samma produkt/variant?" },
  { name: "sealedComplete", type: "boolean", description: "Komplett, oöppnad, oskadad?" },
  { name: "reason", type: "string", description: "Kort motivering på svenska." },
];

export const VERIFY_REQUIRED = VERIFY_FIELDS.map((f) => f.name);

/**
 * User-prompten — ORDAGRANT densamma för alla leverantörer. Ligger här och inte
 * i adaptrarna av precis samma skäl som systemprompten: en extra radbrytning i
 * den ena adaptern räcker för att en A/B-körning ska mäta formatering.
 */
export function buildUserPrompt(
  product: DealVerifyProduct,
  listing: DealVerifyListing
): string {
  const priceLine = product.refKr ? `Ungefärligt marknadspris: ${product.refKr} kr\n` : "";
  return (
    `KATALOGPRODUKT:\nTitel: ${product.title}\nKategori: ${product.category}\n${priceLine}\n` +
    `TRADERA-ANNONS:\nTitel: ${listing.title}\nBeskrivning: ${listing.description || "(ingen beskrivning)"}\n\n` +
    `Är annonsen exakt samma produkt, och är den komplett/oöppnad/oskadad? Anropa ${VERIFY_TOOL_NAME}.`
  );
}

/** Motiveringen är fritext från en modell och hamnar i DealCheck.reason. */
const REASON_MAX = 200;

/**
 * De råa verktygsfälten → dom. ⛔ ALL tolkning bor här, inte i adaptrarna.
 *
 * ⛔ STRIKT MED FLIT, OCH ÅT DET SÄKRA HÅLLET. Den gamla koden läste
 * `input.sameProduct === true`, vilket gör ett SAKNAT fält till ett tyst "nej".
 * Det låter säkert, men i `verifyTraderaMatches` är "nej" DESTRUKTIVT: offern
 * nollas och döljs överallt. Ett svar vi inte kunde tolka är varken ja eller nej
 * — det är INGEN KUNSKAP (samma princip som `statusAfterVerify` i restock-lanen:
 * inget svar ≠ ny kunskap). Därför `null`, och anroparen rör då ingenting:
 * annonsen syns inte i Fynd (feeden kräver ok=true) och ingen befintlig dom
 * skrivs över. Nästa körning prövar igen.
 *
 * Booleanerna måste vara ÄKTA booleans. En modell som svarar "true" som sträng
 * har inte följt schemat, och att tolka strängen hade varit att gissa vad den
 * menade i just den funktion där en gissning blir ett falskt fynd.
 */
export function buildVerdict(
  input: Record<string, unknown> | null | undefined
): DealVerification | null {
  if (!input) return null;
  if (typeof input.sameProduct !== "boolean" || typeof input.sealedComplete !== "boolean") {
    return null;
  }
  return {
    sameProduct: input.sameProduct,
    sealedComplete: input.sealedComplete,
    // Motiveringen är kosmetisk (visas i admin/feed) och får saknas — den är
    // aldrig ensam skäl att kasta en dom som annars är komplett.
    reason: typeof input.reason === "string" ? input.reason.slice(0, REASON_MAX) : "",
  };
}
