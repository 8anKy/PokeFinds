/**
 * Vaktar adminöversiktens två tal som är lätta att få fel utan att någon märker
 * det: VEM som räknas som betalande, och hur en dygnsserie fylls ut.
 */
import { describe, expect, it } from "vitest";
import { payingUserWhere, proUserWhere } from "@/lib/plan";
import { fillDays } from "@/components/features/admin/admin-charts";
import { CATEGORICAL, EVENT_SERIES, seriesColor } from "@/components/features/admin/chart-palette";

describe("payingUserWhere", () => {
  const now = new Date("2026-08-26T00:00:00Z");

  it("utesluter ADMIN och SUPERADMIN", () => {
    // Regressionen: ägarens eget konto bar planTier=PREMIUM och räknades som
    // intäkt — 5 "betalande" varav 3 egna konton, dvs 245 kr redovisad MRR mot
    // 98 kr verklig.
    expect(payingUserWhere(now).role).toEqual({ notIn: ["ADMIN", "SUPERADMIN"] });
  });

  it("räknar BÅDA betalkanalerna", () => {
    // ⛔ Ett bart planTier missar varje Stripe-kund: webhooken rör aldrig fältet.
    const or = payingUserWhere(now).OR;
    expect(or).toEqual([{ planTier: "PREMIUM" }, { stripeProUntil: { gt: now } }]);
  });

  it("räknar INTE gratis Pro — till skillnad från proUserWhere", () => {
    // De två frågorna är olika med flit: "har förmånen" famnar vidare än
    // "genererar en krona". Bonus-Pro hör hemma i den ena men aldrig i den andra.
    const paying = JSON.stringify(payingUserWhere(now));
    expect(paying).not.toContain("bonusProUntil");
    expect(JSON.stringify(proUserWhere())).toContain("bonusProUntil");
  });
});

describe("fillDays", () => {
  it("fyller dygn utan rader med noll", () => {
    // ⛔ Postgres returnerar bara dygn som HAR rader. Utan utfyllnad drar recharts
    // en rak linje mellan två aktiva dagar och en tyst vecka ser ut som en jämn
    // ström.
    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const iso = (offset: number) =>
      new Date(today.getTime() - offset * 864e5).toISOString().slice(0, 10);

    const out = fillDays([{ date: iso(0), value: 5 }], 7);
    expect(out).toHaveLength(7);
    expect(out.at(-1)).toEqual({ date: iso(0), value: 5 });
    expect(out.slice(0, 6).every((p) => p.value === 0)).toBe(true);
  });

  it("ger alltid exakt `days` punkter i stigande datumordning", () => {
    const out = fillDays([], 30);
    expect(out).toHaveLength(30);
    const dates = out.map((p) => p.date);
    expect([...dates].sort()).toEqual(dates);
  });

  it("ignorerar punkter utanför fönstret i stället för att skjuta in dem", () => {
    // En 90-dagarsserie som ritas i 30-dagarsläget får inte smyga in gamla dygn.
    const out = fillDays([{ date: "2020-01-01", value: 99 }], 5);
    expect(out).toHaveLength(5);
    expect(out.every((p) => p.value === 0)).toBe(true);
  });
});

describe("diagrampaletten", () => {
  it("varje händelsetyp har en egen färg — ingen delas", () => {
    const colors = EVENT_SERIES.map((s) => s.color);
    expect(new Set(colors).size).toBe(colors.length);
  });

  it("färg slås upp på NYCKEL, inte på index", () => {
    // ⛔ Plockas färg på index målas kvarvarande serier om så fort en filtreras
    // bort, och grafen betyder olika saker mellan två klick.
    expect(seriesColor("product_view")).toBe(CATEGORICAL[0]);
    expect(seriesColor("retailer_click")).toBe(CATEGORICAL[2]);
  });

  it("okänd serienyckel faller tillbaka på grått, aldrig på en grannes färg", () => {
    const fallback = seriesColor("nagot_nytt_i_framtiden");
    expect(CATEGORICAL).not.toContain(fallback);
  });
});
