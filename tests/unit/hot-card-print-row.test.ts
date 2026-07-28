import { describe, it, expect } from "vitest";
import { pickRowForProduct } from "../../src/jobs/hot-card-refresh";

// 2026-07-28: hot-card-refresh tog `data[0]` ur `?tcgid=`-svaret. MÄTT samma dag:
// uppslaget svarar med EXAKT EN rad för vintage-kort, och det är 1st Edition-raden
// som bär tcgid:t — `?tcgid=base1-1` → "1st Edition Shadowless" (Alakazam, From
// 500 €), `?tcgid=neo1-1` → "1st Edition" (Ampharos, From 25 €), medan ett modernt
// kort (`sv3pt5-6`) svarar med en omärkt rad. Kvällskörningen publicerade alltså
// 1st Edition-priset på det ORDINARIE kortet några timmar efter att dagliga
// körningen valt rätt tryckning — och efter Base-uppdelningen hade alla tre
// tryckningarna fått samma rad.
//
// Jobbet kan inte VÄLJA tryckning som dagliga körningen (den läser hela episoden
// och kan jämföra; här finns bara en rad). Regeln är därför: raden måste VARA
// produktens tryckning, annars skrivs ingenting.

const row = (version: string | null, from?: number | null, cmid = 1) => ({
  cardmarket_id: cmid,
  name: "Kort",
  version,
  prices: { cardmarket: { lowest_near_mint: from ?? null, "30d_average": 10 } },
});
const hasFrom = (r: { prices?: { cardmarket?: { lowest_near_mint?: number | null } | null } | null }) =>
  typeof r.prices?.cardmarket?.lowest_near_mint === "number";

describe("pickRowForProduct — raden måste vara produktens tryckning", () => {
  it("ordinarie kort tar INTE 1st Edition-raden (det verkliga tcgid-svaret)", () => {
    // Neo Genesis Ampharos: enda raden uppslaget ger är 1st Edition.
    expect(pickRowForProduct([row("1st Edition", 25)], null, hasFrom)).toBeNull();
  });

  it("...och inte Shadowless-raden heller", () => {
    expect(pickRowForProduct([row("Shadowless", 40)], null, hasFrom)).toBeNull();
  });

  it("ordinarie kort tar omärkt rad (moderna set) och Unlimited-rad", () => {
    expect(pickRowForProduct([row(null, 6.7)], null, hasFrom)?.version).toBeNull();
    expect(pickRowForProduct([row("Unlimited", 4.29)], null, hasFrom)?.version).toBe("Unlimited");
  });

  it("varje tryckningsprodukt tar BARA sin egen rad", () => {
    const rows = [row("1st Edition Shadowless", 500, 1), row("Shadowless", 40, 2), row("Unlimited", 4.29, 3)];
    expect(pickRowForProduct(rows, "1st Edition", hasFrom)?.cardmarket_id).toBe(1);
    expect(pickRowForProduct(rows, "Shadowless", hasFrom)?.cardmarket_id).toBe(2);
    expect(pickRowForProduct(rows, "Unlimited", hasFrom)?.cardmarket_id).toBe(3);
  });

  it("Unlimited-produkten tar INTE 1st Edition-raden ens när den är den enda", () => {
    // Exakt Base-fallet: ?tcgid=base1-1 ger bara 1st Edition-raden.
    expect(pickRowForProduct([row("1st Edition Shadowless", 500)], "Unlimited", hasFrom)).toBeNull();
    expect(pickRowForProduct([row("1st Edition Shadowless", 500)], "Shadowless", hasFrom)).toBeNull();
  });

  it("äkta From går före en rad utan From", () => {
    const rows = [row("Unlimited", null, 1), row("Unlimited", 4.29, 2)];
    expect(pickRowForProduct(rows, "Unlimited", hasFrom)?.cardmarket_id).toBe(2);
  });

  it("utan From: ordinarie och Unlimited får uppskattas, Shadowless/1st Edition inte", () => {
    // De två delar CM-produkt → en uppskattning hade gett båda samma värde.
    expect(pickRowForProduct([row(null, null)], null, hasFrom)).not.toBeNull();
    expect(pickRowForProduct([row("Unlimited", null)], "Unlimited", hasFrom)).not.toBeNull();
    expect(pickRowForProduct([row("Shadowless", null)], "Shadowless", hasFrom)).toBeNull();
    expect(pickRowForProduct([row("1st Edition Shadowless", null)], "1st Edition", hasFrom)).toBeNull();
  });

  it("From = 0 räknas som ett värde, inte som saknat", () => {
    // `undefined` är inte bevis för att From saknas — samma regel som feedRowWins.
    expect(pickRowForProduct([row("Unlimited", 0, 7)], "Unlimited", hasFrom)?.cardmarket_id).toBe(7);
  });

  it("tomt svar ger null", () => {
    expect(pickRowForProduct([], null, hasFrom)).toBeNull();
  });
});
