/**
 * VILKA SET FÅR EN RUTA PÅ /sets (ägarbeslut 2026-10-16, modellerat på hur samlare redan
 * ser listan). Setet FINNS kvar oavsett — korten ligger i katalogen, i sök, i skannern
 * (där reglerna tillåter), i samlingen och på sin egen setsida. Det här styr BARA om
 * setet visas som en ruta i setlistan.
 *
 * Bakgrund: CardTrader-importen 2026-10-15 skapade 172 set (däck, tränarkit, VM-däck,
 * butiks-/ligapromos) — riktiga Cardmarket-expansioner, men de dränkte listan
 * (252 EN / 376 JP mot ~178 / ~202 hos andra samlartjänster).
 *
 * REGEL:
 *  · ENGELSKA: däck, tränarkit, VM-däck, Battle Academy och turnerings-/butikspromos
 *    döljs. McDonald's, Trick or Trade, POP och alla expansioner (inkl. Trainer Gallery,
 *    Shiny Vault, Classic Collection) visas.
 *  · JAPANSKA: däck, startprodukter och boxar döljs — UTOM BW- och XY-erans däck (half
 *    decks, battle strength decks, combo decks, Mega Battle Decks), som samlare listar
 *    som set. Eran avgörs av setkoden, annars släppdatumet; okänt båda ⇒ ett
 *    CardTrader-skapat set döljs, allt annat visas.
 *
 * ⛔ Ändra ETT set genom `src/data/set-listing-overrides.json` ("EN:Namn" / "JP:Namn"),
 * inte genom att vidga ett mönster för ett enda fall.
 * ⛔ Ren modul: ingen Prisma. Används av /sets (server) och rapportskriptet
 * `scripts/set-listing-report.ts`.
 */
import overrides from "@/data/set-listing-overrides.json";

export interface SetListingInput {
  name: string;
  language: string;
  externalId: string | null;
  releaseDate: Date | string | null;
}

const EN_UNLISTED: RegExp[] = [
  /trainer kit/i,
  /world championship/i,
  /battle academy/i,
  /\bleague promos\b/i,
  /prerelease promos/i,
  /retail exclusive promos/i,
  /theme deck/i,
  /holiday calendar/i,
  /professor program/i,
  /burger king/i,
  /my first battle/i,
  /^pokémon tcg classic:/i,
  /miscellaneous promos/i,
  /^unnumbered promos$/i,
  /southeast asia/i,
  /^mega evolution products$/i,
  /^futsal promos$/i,
  /^w promos$/i,
  /^radiant collection /i,
  /^v-union special collection$/i,
  /^pokémon tcg: pokémon go$/i,
  /prize pack series/i,
];

/** Japanska startprodukter/däck/boxar. Avgör bara tillsammans med eran nedan. */
const JP_DECKISH =
  /(starter (set|deck|pack)|start decks?\b|deck build box|battle master deck|battle academy|high[- ]class deck|special deck set|special battle set|premium deck set|battle partners deck|constructed|family pokémon card game|trainer battle decks|beginning set|gift box|entry pack|deck kit|quarter deck|collection sheet|theater limited|movie commemoration|poképark|world championships|extra regulation box|card game classic|golden box|\bbox \(|minimum pack|pikachu world collection|battle starter deck|half deck|battle deck|combo deck|battle strength deck|battle gift set|vs pack|premium trainer box|battle set|legend set)/i;

/** Undantag som samlare behandlar som set trots däckformen. */
const JP_DECK_LISTED = /start deck 100/i;

/** Setkoder för BW- och XY-erans däck — de enda däck samlare listar som set. */
const JP_BWXY_CODE = /^(BW|XY|X30|Y30|HXY|BK|BTV|BGS|PPD|PBG|KLD|GBR|SZD|MG[GM]?|K\+K|EBB|DS|SHC|WAK|CP\d)/i;

/** BW släpptes i Japan 2010-12-17, Sun & Moon 2016-12-09: däck däremellan visas. */
const BWXY_FROM = Date.parse("2010-12-01");
const MODERN_FROM = Date.parse("2016-12-01");

function setCode(name: string): string | null {
  const m = name.match(/\(([^()]+)\)\s*$/);
  return m ? m[1].trim() : null;
}

function override(input: SetListingInput): boolean | null {
  const key = `${input.language}:${input.name}`;
  if ((overrides.listed as string[]).includes(key)) return true;
  if ((overrides.unlisted as string[]).includes(key)) return false;
  return null;
}

export function isSetListed(input: SetListingInput): boolean {
  const o = override(input);
  if (o != null) return o;

  if (input.language === "JP") {
    if (!JP_DECKISH.test(input.name) || JP_DECK_LISTED.test(input.name)) return true;
    const code = setCode(input.name);
    if (code && JP_BWXY_CODE.test(code)) return true;
    const t = input.releaseDate ? new Date(input.releaseDate).getTime() : NaN;
    if (Number.isFinite(t)) return t >= BWXY_FROM && t < MODERN_FROM;
    if (code) return false;
    // Okänd era: CardTrader-skapade däck döljs, set ur leverantören/Cardmarket visas.
    return !(input.externalId ?? "").startsWith("ct:");
  }

  return !EN_UNLISTED.some((re) => re.test(input.name));
}
