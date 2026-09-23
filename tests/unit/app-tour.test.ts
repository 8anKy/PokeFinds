/**
 * Den guidade turen (lib/app-tour.ts). Vakten fångar det som går rakt igenom
 * typkontrollen: ett steg utan text i båda språkfilerna, Skanna som inte är sist
 * (kameran ber om tillstånd mitt i turen), ett mål som inte finns i koden, och
 * bubblan utanför skärmen.
 */
import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import sv from "../../messages/sv.json";
import en from "../../messages/en.json";
import {
  TOUR_STEPS,
  bubblePlacement,
  isProductPage,
  nextStepIndex,
  routeReached,
  visibleStepCount,
  visibleStepNumber,
} from "@/lib/app-tour";

const SRC = path.resolve(__dirname, "../../src");
function allSource(dir: string): string {
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .map((e) => {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) return allSource(p);
      return /\.tsx?$/.test(e.name) ? fs.readFileSync(p, "utf8") : "";
    })
    .join("\n");
}

describe("app-tour", () => {
  it("varje steg har rubrik och text på båda språken", () => {
    for (const msgs of [sv, en] as unknown as { Tour: Record<string, string> }[]) {
      for (const s of TOUR_STEPS) {
        for (const key of [s.copy, s.guestCopy].filter(Boolean) as string[]) {
          expect(msgs.Tour[`${key}Title`], `${key}Title`).toBeTruthy();
          expect(msgs.Tour[`${key}Body`], `${key}Body`).toBeTruthy();
        }
      }
    }
  });

  it("varje mål finns som data-tour i koden", () => {
    const src = allSource(SRC);
    for (const s of TOUR_STEPS) {
      const literal = src.includes(`data-tour="${s.target}"`);
      const tab = s.target.startsWith("tab-") && src.includes("data-tour={`tab-${t.key}`}");
      // Mer-raderna bär målet som data (`tour: "watches-row"` → MenuRow).
      const menuRow = src.includes(`tour: "${s.target}"`) && src.includes("data-tour={link.tour}");
      expect(literal || tab || menuRow, s.target).toBe(true);
    }
  });

  it("skanna är sista steget (kameran ber om tillstånd)", () => {
    expect(TOUR_STEPS.at(-1)?.id).toBe("scan");
  });

  it("snabbknapparna och Bevaka är info-steg — de skapar riktig data", () => {
    for (const id of ["quickAdd", "bell", "watch"]) {
      expect(TOUR_STEPS.find((s) => s.id === id)?.advance.kind, id).toBe("next");
    }
  });

  it("gäster hoppar över Bevakningar-raden och räknar rätt antal steg", () => {
    const watches = TOUR_STEPS.findIndex((s) => s.id === "watches");
    const more = TOUR_STEPS.findIndex((s) => s.id === "more");
    expect(nextStepIndex(more, true)).toBe(watches + 1);
    expect(nextStepIndex(more, false)).toBe(watches);
    expect(visibleStepCount(true)).toBe(TOUR_STEPS.length - 1);
    expect(visibleStepCount(false)).toBe(TOUR_STEPS.length);
    expect(visibleStepNumber(TOUR_STEPS.length - 1, true)).toBe(TOUR_STEPS.length - 1);
    expect(nextStepIndex(TOUR_STEPS.length - 1, false)).toBeNull();
  });

  it("rutt-steg känner igen sin väg, med och utan undersidor", () => {
    const route = { kind: "route" as const, path: "/samling" };
    expect(routeReached(route, "/samling")).toBe(true);
    expect(routeReached(route, "/samling/importera")).toBe(true);
    expect(routeReached(route, "/samlingar")).toBe(false);
    expect(routeReached({ kind: "next" }, "/samling")).toBe(false);
  });

  it("produktsidan är /produkter/<slug>, inte katalogen", () => {
    expect(isProductPage("/produkter/pitch-black-booster-box")).toBe(true);
    expect(isProductPage("/produkter")).toBe(false);
  });

  it("bubblan hamnar ovanför en flik längst ned och håller sig inom kanterna", () => {
    const vp = { width: 390, height: 800 };
    const tab = bubblePlacement({ top: 740, left: 330, width: 50, height: 44 }, vp, { width: 320, height: 150 });
    expect(tab.side).toBe("above");
    expect(tab.top + 150).toBeLessThanOrEqual(740);
    expect(tab.left + 320).toBeLessThanOrEqual(390 - 16);
    const search = bubblePlacement({ top: 80, left: 10, width: 370, height: 48 }, vp, { width: 320, height: 150 });
    expect(search.side).toBe("below");
    expect(search.left).toBeGreaterThanOrEqual(16);
  });
});
