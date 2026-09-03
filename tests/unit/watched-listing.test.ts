/**
 * BEVAKADE LÄNKAR (`WatchedListing`): butiks-URL:er vi frågar direkt för att ingen feed
 * nämner dem. Reglerna som måste hålla:
 *   - VÄRDGRINDEN: en bevakad URL måste ligga på butikens egen domän. Utan den blir
 *     adminformuläret en "hämta vilken URL som helst från våra servrar"-yta (SSRF),
 *     och lanen hade dessutom tolkat svaret som DEN butikens lagerstatus.
 *   - Svaret formas som en FEED-POST, inte som en egen kodväg — annars finns två
 *     sanningar om samma lagerstatus, och två sanningar är hur flappen uppstår.
 *   - "Inget svar" är aldrig "slut i lager".
 */
import { describe, expect, it } from "vitest";
import { sameHost } from "@/lib/watched-listing-url";

describe("sameHost — värdgrinden för bevakade länkar", () => {
  const store = "https://goblinen.com";

  it("släpper igenom butikens egen produktsida", () => {
    expect(sameHost(store, "https://goblinen.com/products/pokemon-tcg-30th-celebration")).toBe(true);
  });

  it("ignorerar www på båda sidor — butiken registreras med och utan", () => {
    expect(sameHost(store, "https://www.goblinen.com/products/x")).toBe(true);
    expect(sameHost("https://www.goblinen.com", "https://goblinen.com/products/x")).toBe(true);
  });

  it("släpper igenom butikens underdomäner (shop./butik. m.fl.)", () => {
    expect(sameHost(store, "https://shop.goblinen.com/products/x")).toBe(true);
  });

  it("NEKAR en annan butik — annars kunde en bevakning bokföras på fel butik", () => {
    expect(sameHost(store, "https://speltrollet.se/products/x")).toBe(false);
  });

  it("NEKAR domäner som bara SER UT att höra dit (suffixattacken)", () => {
    // "goblinen.com.evil.example" slutar inte på ".goblinen.com" — punkten är kravet.
    expect(sameHost(store, "https://goblinen.com.evil.example/products/x")).toBe(false);
    expect(sameHost(store, "https://notgoblinen.com/products/x")).toBe(false);
  });

  it("NEKAR interna adresser — bevakningen får aldrig peka inåt", () => {
    expect(sameHost(store, "http://localhost:3000/api/admin/users")).toBe(false);
    expect(sameHost(store, "http://169.254.169.254/latest/meta-data/")).toBe(false);
    expect(sameHost(store, "http://127.0.0.1/")).toBe(false);
  });

  it("NEKAR skräp i stället för att kasta", () => {
    expect(sameHost(store, "inte-en-url")).toBe(false);
    expect(sameHost("inte-en-url", "https://goblinen.com/products/x")).toBe(false);
  });
});
