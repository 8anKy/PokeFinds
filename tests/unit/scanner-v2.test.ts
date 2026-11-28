/**
 * Skannerns nya utseende (components/features/scanner-v2.tsx): vad panelen får visa och hur priset skrivs.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { SCAN_HIT_ORE, scanPrice, scanVisibleInPanel, type V2Scan } from "@/components/features/scanner-v2";
import { previewAllowed } from "@/lib/feature-preview";

const scan = (id: string, status: V2Scan["status"]): V2Scan => ({ id, status, captured: "data:,", match: null, quantity: 1 });

describe("scanVisibleInPanel", () => {
  it("en träff syns först när den LANDAT på högen (annars står kortet i raden medan bocken visas)", () => {
    const landed = new Set(["a"]);
    expect(scanVisibleInPanel(scan("a", "matched"), landed)).toBe(true);
    expect(scanVisibleInPanel(scan("b", "matched"), landed)).toBe(false);
    expect(scanVisibleInPanel(scan("c", "choose"), landed)).toBe(false);
  });

  it("väntande och misslyckade skanningar syns direkt", () => {
    const none = new Set<string>();
    expect(scanVisibleInPanel(scan("a", "identifying"), none)).toBe(true);
    expect(scanVisibleInPanel(scan("b", "nomatch"), none)).toBe(true);
    expect(scanVisibleInPanel(scan("c", "error"), none)).toBe(true);
  });
});

describe("scanPrice", () => {
  it("hela kronor från 100 kr, ören under", () => {
    expect(scanPrice(SCAN_HIT_ORE)).toBe("100\u00a0kr");
    expect(scanPrice(247_876)).toBe("2\u00a0479\u00a0kr");
    expect(scanPrice(34)).toMatch(/0,34/);
  });
});

describe("förhandsvisningen SCANNER_V2", () => {
  it("bara admin (eller listad e-post) tills flaggan släpper den", () => {
    expect(previewAllowed({ feature: "SCANNER_V2", role: "USER", email: "a@b.se" })).toBe(false);
    expect(previewAllowed({ feature: "SCANNER_V2", role: "SUPERADMIN" })).toBe(true);
    expect(previewAllowed({ feature: "SCANNER_V2", role: "USER", publicFlag: "1" })).toBe(true);
  });

  it("skannersidan ritar nya panelen BARA bakom flaggan, och kvoten bär den", () => {
    const page = readFileSync("src/app/[locale]/(scan)/skanna/page.tsx", "utf8");
    expect(page).toContain("v2={quota?.v2 === true}");
    expect(page).toMatch(/props\.v2 \? \(\s*<ScanSessionPanel/);
    expect(readFileSync("src/app/api/scanner/quota/route.ts", "utf8")).toContain('v2: previewAllowedFor("SCANNER_V2", user)');
  });
});
