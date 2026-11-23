/**
 * ORT → STORSTADSREGION för Discords ortsroller (ägarbeslut 2026-11-23).
 *
 * Butikernas egna uppslagningar ger kommunen/stadsdelen ("Västra Frölunda", "Solna",
 * "Upplands Väsby"); medlemmen väljer en roll per STAD ("Göteborg", "Stockholm"). Tabellen
 * är bron, och den är HANDSKRIVEN med flit:
 * ⛔ En ort som inte står här hör inte till någon region ⇒ ingen ping. Aldrig en gissning
 *    (ingen geokodning, ingen avståndsberäkning) — fel stad i en ping skickar folk på en
 *    resa till fel butik.
 * Underlag 2026-11-23: Webhallens `/api/store/se` (13 butiker: Stockholm ×4, Täby, Nacka,
 * Järfälla, Farsta, Upplands Väsby, Solna, Uppsala, Göteborg ×2, Västra Frölunda) och
 * SF-Boks `/sv/butiker` (Stockholm, Göteborg, Malmö, Linköping). Öppnar en kedja i en ny
 * ort: lägg till raden här.
 */
const REGIONS: Record<string, readonly string[]> = {
  Stockholm: [
    "Stockholm",
    "Täby",
    "Nacka",
    "Järfälla",
    "Farsta",
    "Upplands Väsby",
    "Solna",
    "Sundbyberg",
    "Kista",
    "Sollentuna",
    "Huddinge",
    "Skärholmen",
    "Lidingö",
    "Danderyd",
    "Haninge",
    "Tyresö",
    "Botkyrka",
    "Vällingby",
    "Bromma",
    "Hägersten",
    "Johanneshov",
    "Sickla",
    "Barkarby",
  ],
  Göteborg: ["Göteborg", "Västra Frölunda", "Mölndal", "Partille", "Kållered", "Hisings Backa", "Angered"],
  Malmö: ["Malmö", "Arlöv", "Burlöv"],
  Uppsala: ["Uppsala"],
  Linköping: ["Linköping"],
};

const norm = (s: string) => s.trim().toLowerCase();

const BY_CITY = new Map<string, string>();
for (const [region, cities] of Object.entries(REGIONS)) {
  for (const c of cities) BY_CITY.set(norm(c), region);
}

/** Regionerna vi känner — rollnamnen i `cityRoles` ska vara ur den här listan. */
export const STORE_REGIONS: readonly string[] = Object.keys(REGIONS);

/** "Västra Frölunda" → "Göteborg". Okänd eller saknad ort → null. */
export function regionForCity(city: string | null | undefined): string | null {
  if (!city) return null;
  return BY_CITY.get(norm(city)) ?? null;
}
