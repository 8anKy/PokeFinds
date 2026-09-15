import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  FREE_RESTOCK_ALERT_DELAY_MINUTES,
  FREE_RESTOCK_ALERT_LIMIT,
  FREE_RESTOCK_ALERT_LIMIT_CODE,
  alertDueWhere,
  freeDelayMinutes,
  freeDelayNotice,
  freeRestockAlertNotBefore,
  pickFreeRestockAlertItems,
} from "@/lib/free-restock-alert";
import { API_ERROR_KEYS } from "@/lib/api-error-i18n";
import { withEmailNote, restockAlertEmail } from "@/emails/templates";

/**
 * GRATISKONTOTS ENA, FÖRDRÖJDA RESTOCK-LARM (ägarbeslut 2026-09-15).
 *
 * Tre saker som går sönder tyst: (1) fördröjningen och copyn säger olika tal,
 * (2) "det ena larmet" döms olika vid skrivning och vid larmtillfället, (3) det
 * fördröjda larmet skickas i första rundan ändå (då är det bara ett gratis Pro-
 * larm). Kostnadsvillkoret (≤ ~4,5 min så Neon är vaken) vaktas också — höjs
 * talet måste kalkylen i free-restock-alert.ts göras om.
 */
const ROOT = resolve(__dirname, "../..");
const read = (p: string) => JSON.parse(readFileSync(resolve(ROOT, p), "utf8"));

describe("konstanterna", () => {
  it("ett larm, några minuter, under Neons autosuspend-fönster", () => {
    expect(FREE_RESTOCK_ALERT_LIMIT).toBe(1);
    expect(FREE_RESTOCK_ALERT_DELAY_MINUTES).toBeGreaterThanOrEqual(1);
    // 300 s autosuspend − 15 s timer-marginal − körtid: över 4,5 min köper varje
    // hit-fönster en extra väckning. Se kalkylen i lib/free-restock-alert.ts.
    expect(FREE_RESTOCK_ALERT_DELAY_MINUTES).toBeLessThanOrEqual(4.5);
  });

  it("felkoden finns i API-tabellen med texten tjänsten kastar", () => {
    expect(FREE_RESTOCK_ALERT_LIMIT_CODE).toBe("FREE_RESTOCK_ALERT_LIMIT");
    const text = "Gratiskontot har ett restock-larm. Uppgradera till Pro för larm på allt du bevakar.";
    expect(API_ERROR_KEYS[text]).toBe("freeRestockAlertLimit");
    for (const p of ["messages/sv.json", "messages/en.json"]) {
      expect(read(p).ApiErrors.freeRestockAlertLimit, p).toBeTruthy();
    }
  });
});

describe("copyn säger samma tal som koden", () => {
  it("spec-bladets restock-rad och arken bär fördröjningen i minuter", () => {
    const m = FREE_RESTOCK_ALERT_DELAY_MINUTES;
    for (const p of ["messages/sv.json", "messages/en.json"]) {
      const msgs = read(p);
      const row = msgs.Pricing.specRowsRestock[0];
      expect(row.free, `${p}: ${row.label}`).toMatch(new RegExp(`^1 · ${m} min`));
      expect(row.free).not.toBe(row.pro);
      // Arken tar talet som parameter — nyckeln måste finnas och ha platshållaren.
      expect(msgs.Detail.watchSheetFreeHint).toContain("{minutes}");
      expect(msgs.Detail.watchRestockOptionHintFree).toContain("{minutes}");
      expect(msgs.Watch.itemWatchedFreeDesc).toContain("{minutes}");
      expect(msgs.Watch.intro.rowAlert).toContain("{minutes}");
      expect(msgs.Watch.intro.rowWatches).toContain("{count");
      expect(msgs.Watchlist.freeAlertsBannerRestock).toContain("{minutes}");
    }
  });
});

describe("domen", () => {
  it("notBefore = nu + fördröjningen", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    expect(freeRestockAlertNotBefore(now).toISOString()).toBe(
      new Date(now.getTime() + FREE_RESTOCK_ALERT_DELAY_MINUTES * 60_000).toISOString()
    );
  });

  it("minuterna i notisen: hela minuter, aldrig 0, null när larmet inte var fördröjt", () => {
    const t = new Date("2026-09-15T12:00:00Z");
    expect(freeDelayMinutes({ triggeredAt: t, notBefore: null })).toBeNull();
    expect(freeDelayMinutes({ triggeredAt: t, notBefore: new Date(t.getTime() + 4 * 60_000) })).toBe(4);
    expect(freeDelayMinutes({ triggeredAt: t, notBefore: new Date(t.getTime() + 20_000) })).toBe(1);
    expect(freeDelayMinutes({ triggeredAt: t, notBefore: new Date(t.getTime() - 1) })).toBeNull();
  });

  it("dispatch-villkoret släpper igenom rader utan tidpunkt och rader vars tidpunkt passerat", () => {
    const now = new Date("2026-09-15T12:00:00Z");
    expect(alertDueWhere(now)).toEqual({ OR: [{ notBefore: null }, { notBefore: { lte: now } }] });
  });

  it("det ena larmet = ÄLDSTA objektet med restockAlert på, per användare, oavsett ordning", () => {
    const pick = pickFreeRestockAlertItems([
      { userId: "a", productId: "p-new", createdAt: new Date("2026-09-10") },
      { userId: "a", productId: "p-old", createdAt: new Date("2026-08-01") },
      { userId: "b", productId: "p-x", createdAt: new Date("2026-09-01") },
    ]);
    expect(pick.get("a")).toBe("p-old");
    expect(pick.get("b")).toBe("p-x");
    expect(pick.has("c")).toBe(false);
  });

  it("notisen nämner minuterna och Pro", () => {
    const note = freeDelayNotice(4);
    expect(note).toContain("4 min");
    expect(note).toMatch(/Pro/);
  });
});

describe("mejlnotisen", () => {
  it("läggs sist i kortet (före sidfoten) i både html och text", () => {
    const mail = restockAlertEmail("Anna", "Prismatic Evolutions ETB", "Butiken", "https://butik.se/x", 89900);
    const note = freeDelayNotice(4);
    const out = withEmailNote(mail, note);
    expect(out.html).toContain(note);
    // Inne i kortet: före sidfotens "Du får detta mejl".
    expect(out.html.indexOf(note)).toBeLessThan(out.html.indexOf("Du får detta mejl"));
    expect(out.text).toContain(note);
    expect(out.text.indexOf(note)).toBeLessThan(out.text.indexOf("Du kan ändra dina aviseringsinställningar"));
    expect(out.subject).toBe(mail.subject);
  });
});
