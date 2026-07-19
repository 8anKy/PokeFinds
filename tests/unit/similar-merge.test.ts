/**
 * Tester för mergeByDateProximity — "Liknande produkter" nivå 2 (samma kategori,
 * andra set) ska visa set närmast produktens releasedatum först, oavsett om de
 * släpptes före eller efter.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db", () => ({ prisma: {} }));

import { mergeByDateProximity } from "@/services/products";

type Row = { name: string; date: Date | null };
const d = (iso: string) => new Date(iso);
const row = (name: string, iso: string | null): Row => ({
  name,
  date: iso ? d(iso) : null,
});
const dateOf = (r: Row) => r.date;

describe("mergeByDateProximity", () => {
  const ref = d("2024-06-01");

  it("växlar mellan listorna efter kortast tidsavstånd", () => {
    const after = [row("juli", "2024-07-01"), row("oktober", "2024-10-01")];
    const before = [row("maj", "2024-05-01"), row("januari", "2024-01-01")];
    const out = mergeByDateProximity(after, before, ref, 4, dateOf);
    expect(out.map((r) => r.name)).toEqual(["juli", "maj", "oktober", "januari"]);
  });

  it("tömmer ena listan och fortsätter med den andra", () => {
    const after = [row("juli", "2024-07-01")];
    const before = [
      row("maj", "2024-05-01"),
      row("mars", "2024-03-01"),
      row("januari", "2024-01-01"),
    ];
    const out = mergeByDateProximity(after, before, ref, 4, dateOf);
    // juli = 30 dagar från ref, maj = 31 → juli först; sedan töms before-listan.
    expect(out.map((r) => r.name)).toEqual(["juli", "maj", "mars", "januari"]);
  });

  it("respekterar take", () => {
    const after = [row("a", "2024-06-02"), row("b", "2024-06-03")];
    const before = [row("c", "2024-05-31")];
    expect(mergeByDateProximity(after, before, ref, 2, dateOf)).toHaveLength(2);
  });

  it("rader utan datum hamnar sist", () => {
    const after = [row("utan-datum", null)];
    const before = [row("maj", "2024-05-01")];
    const out = mergeByDateProximity(after, before, ref, 2, dateOf);
    expect(out.map((r) => r.name)).toEqual(["maj", "utan-datum"]);
  });
});
