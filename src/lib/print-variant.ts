/**
 * TRYCKNINGAR (print runs) som egna katalogposter.
 *
 * Base Set trycktes i tre omgångar — 1st Edition (Shadowless med stämpel),
 * Shadowless och Unlimited — och de är på riktigt olika varor: samma Ponyta
 * kostar 26,50 €, 4,29 € eller några ören beroende på tryckning. pokemontcg.io
 * har EN post per kort, så katalogen hade EN produkt som i praktiken visade
 * vilken tryckning som råkade ha ett pris i feeden.
 *
 * Vi håller därför en Product per tryckning, särskilda av `variantLabel`.
 * RapidAPI:s `version`-fält är källan: det säger explicit vilken tryckning varje
 * feed-rad gäller (mätt i Base: 102 rader "1st Edition Shadowless", 100
 * "Shadowless", 101 "Unlimited").
 *
 * Modulen är avsiktligt fri från DB- och API-beroenden: den är ren vokabulär,
 * delad av prisjobbet (rad → produkt), Tradera-matchningen (annons → tryckning)
 * och migreringsskriptet.
 */

export const PRINT_UNLIMITED = "Unlimited";
export const PRINT_SHADOWLESS = "Shadowless";
export const PRINT_FIRST_EDITION = "1st Edition";

/** Etiketterna i den ordning katalogen visar dem (vanligast först). */
export const PRINT_VARIANT_LABELS = [PRINT_UNLIMITED, PRINT_SHADOWLESS, PRINT_FIRST_EDITION] as const;
export type PrintVariantLabel = (typeof PRINT_VARIANT_LABELS)[number];

const LABEL_SET = new Set<string>(PRINT_VARIANT_LABELS);

/** Är etiketten en TRYCKNING (och inte "Specialversion", "Staff", …)? */
export function isPrintVariantLabel(label: string | null | undefined): label is PrintVariantLabel {
  return label != null && LABEL_SET.has(label);
}

/**
 * RapidAPI:s `version` → vår etikett. `null` = raden är ingen tryckningsrad
 * (moderna set har `null` eller etiketter som "Reverse Holo" som INTE är
 * tryckningar och aldrig får styra hit).
 *
 * ORDNINGEN ÄR INTE VALFRI: "1st Edition Shadowless" innehåller ordet
 * "Shadowless" och måste testas mot 1st Edition FÖRST, annars hamnar Base
 * dyraste tryckning på shadowless-produkten.
 */
export function printLabelFromVersion(version: string | null | undefined): PrintVariantLabel | null {
  const v = version ?? "";
  if (/1st\s*edition/i.test(v)) return PRINT_FIRST_EDITION;
  if (/shadowless/i.test(v)) return PRINT_SHADOWLESS;
  if (/^\s*unlimited\s*$/i.test(v)) return PRINT_UNLIMITED;
  return null;
}

/**
 * Hur nära raden ligger den ORDINARIE tryckningen. Används när kortet INTE är
 * uppdelat i egna produkter (Jungle/Fossil/Gym/Neo har bara en katalogpost per
 * kort): då måste en av tryckningsraderna väljas, och 1st Edition är inte kortet
 * katalogen håller. Se CLAUDE.md "TRYCKNINGEN ÄR IDENTITET".
 */
export function printRank(version: string | null | undefined): number {
  const label = printLabelFromVersion(version);
  if (label === PRINT_FIRST_EDITION) return 0;
  if (label === PRINT_SHADOWLESS) return 1;
  return 2; // Unlimited, omärkt, och alla icke-tryckningsetiketter i moderna set
}

/**
 * Namnger en ANNONSTITEL en tryckning? Tradera-vakten: med tre produkter per kort
 * delar de kortnummer OCH kortnamn, så singel-identiteten i `matchProduct` ger tre
 * lika starka träffar och fuzzy-poängen får avgöra — dvs slumpen. En annons som
 * inte säger något om tryckning är per konvention den ordinarie (Unlimited); bara
 * en annons som SÄGER "1st edition"/"shadowless" får landa på de produkterna.
 *
 * `null` = annonsen säger ingenting ⇒ behandla som Unlimited.
 */
export function printLabelInTitle(title: string | null | undefined): PrintVariantLabel | null {
  const t = (title ?? "").toLowerCase();
  // 1st Edition först — "1st edition shadowless" är en 1st Edition-annons.
  if (/\b(1st|first)\s*ed(ition)?\b/.test(t) || /\b1:a\s*upplagan\b/.test(t)) return PRINT_FIRST_EDITION;
  if (/\bshadowless\b/.test(t)) return PRINT_SHADOWLESS;
  if (/\bunlimited\b/.test(t)) return PRINT_UNLIMITED;
  return null;
}

/**
 * Reverse holo som katalogetikett. Samma sträng som `CT_REVERSE_LABEL` i
 * lib/cardtrader.ts, som importerar HÄRIFRÅN — vokabulären får finnas på ett
 * ställe, annars stavas den förr eller senare olika på två.
 */
export const VARIANT_REVERSE_HOLO = "Reverse Holo";

/**
 * Säger annonstiteln att varan är en REVERSE HOLO?
 *
 * ⛔ KORTNAMNET STRIPPAS FÖRST, OCH DET ÄR INTE KOSMETIKA. Det finns riktiga
 * kort som HETER "Reverse" något: "Reverse Valley" (Team Up), "Reverse Energy
 * Removal 2" (EX Ruby & Sapphire). Utan strippningen läser vakten kortnamnet som
 * en tryckningsuppgift och kastar annonsen från sin EGEN produkt — precis den
 * sortens tysta bortfall den finns för att förhindra.
 */
export function titleSaysReverseHolo(
  title: string | null | undefined,
  cardName?: string | null
): boolean {
  let t = (title ?? "").toLowerCase();
  const name = (cardName ?? "").trim().toLowerCase();
  if (name && /\breverse\b/.test(name)) t = t.split(name).join(" ");
  return /\breverse\b/.test(t) || /\brev\.?\s*holo\b/.test(t);
}

/**
 * Får annonsen prissätta en produkt med den här etiketten?
 *
 * EN regel för ALLA varianter, av ett mätt skäl. Vakten fanns bara för Base-trion
 * (`isPrintVariantLabel`), så när reverse holo blev egna produkter 2026-08-03 föll
 * de rakt igenom: **4 688 av 4 898 Tradera-offers på reverse-produkter kom från
 * annonser som aldrig nämner reverse** — dvs det ORDINARIE kortet prissatte
 * reverse-varianten (Koraidon · Pitch Black 47/84 · Reverse Holo visade 3 kr från
 * en annons för vanliga kortet, medan basversionen kostar 0,22 kr).
 *
 * Symmetrin är själva poängen: en reverse-annons får inte heller prissätta det
 * etikettlösa kortet. Tystnad betyder "ordinarie" i BÅDA riktningarna.
 *
 * Andra etiketter (Staff, Specialversion) lämnas orörda — de har ingen ordlista
 * och en gissning där vore sämre än dagens beteende.
 */
export function listingFitsVariant(
  variantLabel: string | null | undefined,
  listingTitle: string,
  cardName?: string | null
): boolean {
  if (isPrintVariantLabel(variantLabel)) {
    return variantLabel === (printLabelInTitle(listingTitle) ?? PRINT_UNLIMITED);
  }
  const saysReverse = titleSaysReverseHolo(listingTitle, cardName);
  if (variantLabel === VARIANT_REVERSE_HOLO) return saysReverse;
  if (variantLabel == null) return !saysReverse;
  return true;
}
