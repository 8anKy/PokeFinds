import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  onOverlayElevationChange,
  overlayIsElevated,
  registerFullscreenHost,
} from "@/lib/product-overlay-open";

/**
 * Bottenarket måste följa produkt-overlayn upp (2026-11-26). Medan sökläget eller
 * skannern är anmäld som helskärmsvärd ligger overlayn på z-[70]; ett ark på z-50
 * öppnades då BAKOM den, och "Lägg till i samling" på en produkt ur sökläget gjorde
 * ingenting synligt. En användare kunde inte lägga till ett enda kort.
 */
describe("bottenarket lyfts med produkt-overlayn", () => {
  const source = readFileSync(join(process.cwd(), "src/components/ui/bottom-sheet.tsx"), "utf8");

  it("läser overlayns läge själv — inte bara via `elevated` från anroparen", () => {
    expect(source).toMatch(/useSyncExternalStore\(onOverlayElevationChange, overlayIsElevated/);
    expect(source).toMatch(/elevated \|\| hostElevated \? "z-\[70\]" : "z-50"/);
  });

  it("värdräknaren meddelar prenumeranter i båda riktningarna", () => {
    const seen: boolean[] = [];
    const off = onOverlayElevationChange((v) => seen.push(v));
    expect(overlayIsElevated()).toBe(false);
    const release = registerFullscreenHost();
    expect(overlayIsElevated()).toBe(true);
    release();
    release(); // idempotent
    expect(overlayIsElevated()).toBe(false);
    off();
    expect(seen).toEqual([true, false]);
  });
});
