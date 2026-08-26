/**
 * Vaktar kostnadsvyns tysta fel — de som inte kraschar utan bara visar fel tal.
 */
import { describe, expect, it } from "vitest";
import { anthropicCentsToOre, providerOf } from "@/services/admin/service-costs";

/** Ungefär dagens kurs; testerna bryr sig om storleksordning, inte om örena. */
const USD_TO_ORE = 956;

describe("anthropicCentsToOre", () => {
  it("tolkar amount som CENT, inte dollar", () => {
    // ⛔ Dokumentationens eget exempel: "123.45" i USD betyder 1,2345 USD.
    // Läses strängen som dollar blir notan 100× för hög — tyst, och en
    // kostnadsvy som visar 100× fel är värre än ingen kostnadsvy alls.
    const ore = anthropicCentsToOre(123.45, USD_TO_ORE);
    expect(ore).toBe(Math.round(1.2345 * USD_TO_ORE));
    // Sanity: ~12 kr, inte ~1 180 kr.
    expect(ore).toBeLessThan(2000);
  });

  it("noll cent är noll öre", () => {
    expect(anthropicCentsToOre(0, USD_TO_ORE)).toBe(0);
  });

  it("skalar linjärt", () => {
    expect(anthropicCentsToOre(1000, USD_TO_ORE)).toBe(
      10 * anthropicCentsToOre(100, USD_TO_ORE)
    );
  });
});

describe("providerOf", () => {
  it("känner igen båda leverantörerna på prefix", () => {
    expect(providerOf("claude-haiku-4-5").key).toBe("anthropic");
    expect(providerOf("claude-opus-5").key).toBe("anthropic");
    expect(providerOf("gemini-3.6-flash").key).toBe("google");
  });

  it("en framtida modellversion hamnar rätt utan kodändring", () => {
    // Prefixmatchning, inte en handlista: en ny modell ska inte tyst bli "okänd"
    // och försvinna ur leverantörsfördelningen.
    expect(providerOf("gemini-4.0-ultra").key).toBe("google");
    expect(providerOf("claude-opus-9").key).toBe("anthropic");
  });

  it("okänd modell blir OKÄND, aldrig en grannes leverantör", () => {
    // ⛔ Att gissa fel leverantör flyttar pengar mellan två rader i vyn utan att
    // något ser trasigt ut.
    expect(providerOf("gpt-5").key).toBe("unknown");
    expect(providerOf(null).key).toBe("unknown");
    expect(providerOf("").key).toBe("unknown");
  });
});
