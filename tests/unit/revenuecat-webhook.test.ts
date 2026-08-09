import { describe, expect, it } from "vitest";
import { planForEvent, planChangesForEvent } from "@/app/api/webhooks/revenuecat/mapping";

describe("planForEvent", () => {
  it("ger PREMIUM på köp/förnyelse", () => {
    expect(planForEvent("INITIAL_PURCHASE")).toBe("PREMIUM");
    expect(planForEvent("RENEWAL")).toBe("PREMIUM");
  });
  it("ger FREE först vid EXPIRATION", () => {
    expect(planForEvent("EXPIRATION")).toBe("FREE");
  });
  it("ignorerar CANCELLATION (access kvar till perioden tar slut)", () => {
    expect(planForEvent("CANCELLATION")).toBeNull();
    expect(planForEvent("TEST")).toBeNull();
  });
});

describe("planChangesForEvent", () => {
  it("vanligt köp → en ändring på app_user_id", () => {
    expect(planChangesForEvent({ type: "INITIAL_PURCHASE", app_user_id: "u1" })).toEqual([
      { userId: "u1", plan: "PREMIUM" },
    ]);
  });

  it("EXPIRATION → FREE", () => {
    expect(planChangesForEvent({ type: "EXPIRATION", app_user_id: "u1" })).toEqual([
      { userId: "u1", plan: "FREE" },
    ]);
  });

  it("CANCELLATION rör ingen", () => {
    expect(planChangesForEvent({ type: "CANCELLATION", app_user_id: "u1" })).toEqual([]);
  });

  it("anonyma RC-id:n kopplas aldrig till en användare", () => {
    expect(
      planChangesForEvent({ type: "INITIAL_PURCHASE", app_user_id: "$RCAnonymousID:abc" })
    ).toEqual([]);
  });

  /**
   * REGRESSIONEN. TRANSFER bär INGEN `app_user_id` — RC:s fältdok säger att
   * "Subscriber identity fields" inte gäller för den eventtypen. Den gamla koden
   * läste bara `app_user_id`, fick undefined och skrev ingenting: mätt i prod
   * 2026-08-09 fick kontot Pro först 17 minuter senare, av en RENEWAL som råkade
   * fyra. En granskare hos Apple med ett sandbox-ID som redan köpt appen får
   * exakt det här eventet — och skulle betala utan att få något.
   */
  it("TRANSFER: mottagaren får PREMIUM och avsändaren FREE", () => {
    expect(
      planChangesForEvent({
        type: "TRANSFER",
        transferred_from: ["gammal"],
        transferred_to: ["ny"],
      })
    ).toEqual([
      { userId: "ny", plan: "PREMIUM" },
      { userId: "gammal", plan: "FREE" },
    ]);
  });

  it("TRANSFER utan app_user_id ger ändå ändringar", () => {
    const changes = planChangesForEvent({
      type: "TRANSFER",
      transferred_from: ["a"],
      transferred_to: ["b"],
    });
    expect(changes.map((c) => c.userId)).toContain("b");
  });

  it("TRANSFER: samma id i båda listorna behåller PREMIUM", () => {
    // Annars hade FREE skrivits EFTER PREMIUM och tagit bort Pro direkt igen.
    expect(
      planChangesForEvent({
        type: "TRANSFER",
        transferred_from: ["u1"],
        transferred_to: ["u1"],
      })
    ).toEqual([{ userId: "u1", plan: "PREMIUM" }]);
  });

  it("TRANSFER: anonyma id:n filtreras bort i båda riktningarna", () => {
    expect(
      planChangesForEvent({
        type: "TRANSFER",
        transferred_from: ["$RCAnonymousID:x"],
        transferred_to: ["$RCAnonymousID:y", "riktig"],
      })
    ).toEqual([{ userId: "riktig", plan: "PREMIUM" }]);
  });

  it("TRANSFER med flera mottagare ger en ändring var", () => {
    expect(
      planChangesForEvent({ type: "TRANSFER", transferred_to: ["a", "b"] })
    ).toEqual([
      { userId: "a", plan: "PREMIUM" },
      { userId: "b", plan: "PREMIUM" },
    ]);
  });

  it("tål trasiga/tomma event utan att kasta", () => {
    expect(planChangesForEvent(null)).toEqual([]);
    expect(planChangesForEvent({})).toEqual([]);
    expect(planChangesForEvent({ type: "TRANSFER" })).toEqual([]);
  });
});
