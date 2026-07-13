/**
 * Genererar src/scrapers/pokemon-names.ts — vokabulären som characterMismatch bygger på.
 *
 * VARFÖR en genererad fil och inte en DB-fråga: matchnings-vakterna är RENA funktioner
 * (körs i enhetstester utan DB, och per annons i skrapjobben där en DB-rundresa per
 * titel skulle kosta timmar — se loadMatchIndex). Vokabulären ändras ~1 gång/år när en
 * ny generation släpps → en genererad konstant är rätt avvägning.
 *
 * Källa: PokéAPI (pokeapi.co, öppen, ingen nyckel) = artnamnen. Tränarkaraktärer finns
 * inte där men ÄR produktidentitet i sealed-linjer ("Cynthia's Garchomp ex Premium
 * Collection" ≠ "Iono's Bellibolt ex Premium Collection") → de listas manuellt nedan.
 *
 *   npx tsx scripts/generate-pokemon-names.ts
 */
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Tränar-/karaktärsnamn som förekommer som PRODUKTIDENTITET i sealed-linjer.
 * Utökas för hand när en ny karaktärslinje släpps (de dyker upp i produkttitlar,
 * inte i PokéAPI).
 *
 * SNÄV MED FLIT. Varje namn här är verifierat mot 2 001 riktiga butiks-/katalogtitlar.
 * Ett tränarnamn som också är ett vanligt ord eller en del av ett SETNAMN ger en falsk
 * karaktärskrock → blockerar en KORREKT länk, vilket är värre än en felmatch (den syns
 * aldrig). Följande föll på just det och är UTESLUTNA — lägg ALDRIG tillbaka dem utan
 * att mäta mot facit-fixturen:
 *   lance  → "Silver Lance Booster (s6h)"      (setnamn, inte tränaren)
 *   blue   → "Zinnia's Resolve … Blue Sky Stream" (setnamn)
 *   penny  → "Ultra Pro Sleeves (Penny Sleeves)"  (produkttyp)
 *   red    → "Topps Collectors Binder - Red"      (färg)
 *   n      → "Ultimate Guard Twin Flip'n'Tray"    (bokstav i ett ord)
 *   will, karen, clair, chuck, hop, leon, larry … (vanliga ord, aldrig sedda som identitet)
 */
const TRAINERS = [
  "cynthia", "iono", "ethan", "misty", "marnie", "lillie", "steven", "cyrus",
  "arven", "koga", "guzma", "sabrina", "giovanni", "brock", "erika",
  "team rocket", "team magma", "team aqua", "team galactic", "team plasma",
];

/** Artnamn som ÄR vanliga engelska ord → skulle ge falska träffar i titlar. */
const AMBIGUOUS = new Set(["arena", "type null", "mr mime", "mime jr", "farfetchd"]);

async function main() {
  // limit=1400 täcker alla arter (1025 idag) med marginal.
  const res = await fetch("https://pokeapi.co/api/v2/pokemon-species?limit=1400");
  if (!res.ok) throw new Error(`PokéAPI HTTP ${res.status}`);
  const data = (await res.json()) as { results: { name: string }[] };

  const species = data.results
    .map((r) => r.name.toLowerCase())
    // PokéAPI separerar med bindestreck ("mr-mime", "ho-oh"). normalizeTitle gör
    // mellanslag av bindestreck → matcha samma form.
    .map((n) => n.replace(/-/g, " ").trim())
    // Enbokstavsnamn/för korta = för hög risk för falsk träff i en titel.
    .filter((n) => n.length >= 4)
    .filter((n) => !AMBIGUOUS.has(n));

  const all = [...new Set([...species, ...TRAINERS])].sort();

  const body = `/**
 * GENERERAD FIL — ändra inte för hand.
 * Kör \`npx tsx scripts/generate-pokemon-names.ts\` för att uppdatera.
 *
 * Karaktärsvokabulär för characterMismatch (src/scrapers/matching.ts): artnamn från
 * PokéAPI + tränarkaraktärer som är produktidentitet i sealed-linjer.
 * ${species.length} arter + ${TRAINERS.length} tränare = ${all.length} namn.
 */
export const POKEMON_NAMES: ReadonlySet<string> = new Set([
${all.map((n) => `  ${JSON.stringify(n)},`).join("\n")}
]);

/** Längsta namnet i ord — characterMismatch skannar n-gram upp till denna längd. */
export const MAX_NAME_WORDS = ${Math.max(...all.map((n) => n.split(" ").length))};
`;

  const out = resolve(process.cwd(), "src/scrapers/pokemon-names.ts");
  writeFileSync(out, body);
  console.log(`Skrev ${out}: ${species.length} arter + ${TRAINERS.length} tränare = ${all.length} namn`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
