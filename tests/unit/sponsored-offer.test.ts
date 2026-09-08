import { describe, expect, it } from "vitest";
import { isSponsoredNow, pickSponsoredOffer, type SponsorableOffer } from "@/lib/sponsored-offer";

const offer = (o: Partial<SponsorableOffer> & { id: string }): SponsorableOffer => ({
  price: 10000,
  stockStatus: "IN_STOCK",
  retailerId: `r-${o.id}`,
  retailer: { sponsored: false },
  ...o,
});

describe("pickSponsoredOffer", () => {
  it("returnerar null när ingen butik är sponsrad", () => {
    expect(pickSponsoredOffer([offer({ id: "a" }), offer({ id: "b" })])).toBeNull();
  });

  it("väljer den sponsrade butikens offer", () => {
    const picked = pickSponsoredOffer([
      offer({ id: "a", price: 9000 }),
      offer({ id: "b", price: 12000, retailer: { sponsored: true } }),
    ]);
    expect(picked?.id).toBe("b");
  });

  // ⛔ En annons för något som är slut lovar en väg in i butiken som inte finns.
  it("annonserar aldrig en slutsåld offer", () => {
    const picked = pickSponsoredOffer([
      offer({ id: "a", stockStatus: "OUT_OF_STOCK", retailer: { sponsored: true } }),
    ]);
    expect(picked).toBeNull();
  });

  it("väljer billigaste offern när den sponsrade butiken har flera", () => {
    const picked = pickSponsoredOffer([
      offer({ id: "dyr", price: 15000, retailerId: "r1", retailer: { sponsored: true } }),
      offer({ id: "billig", price: 11000, retailerId: "r1", retailer: { sponsored: true } }),
    ]);
    expect(picked?.id).toBe("billig");
  });

  // Pris kan SAKNAS (direktlänk utan pris visas som "–" överallt annars) — men en
  // känd siffra vinner alltid över "vet inte".
  it("föredrar ett känt pris framför ett saknat", () => {
    const picked = pickSponsoredOffer([
      offer({ id: "utan", price: null, retailerId: "r1", retailer: { sponsored: true } }),
      offer({ id: "med", price: 20000, retailerId: "r1", retailer: { sponsored: true } }),
    ]);
    expect(picked?.id).toBe("med");
  });

  it("visar en prislös sponsrad offer hellre än ingen alls", () => {
    const picked = pickSponsoredOffer([
      offer({ id: "utan", price: null, retailer: { sponsored: true } }),
    ]);
    expect(picked?.id).toBe("utan");
  });

  // ⛔ HELA POÄNGEN: sponsringen är en PLACERING vid sidan av listan, aldrig en
  //    ändring av den. Funktionen får därför inte röra ordningen den fick in.
  it("lämnar listan orörd", () => {
    const offers = [
      offer({ id: "a", price: 9000 }),
      offer({ id: "b", price: 12000, retailer: { sponsored: true } }),
      offer({ id: "c", price: 15000 }),
    ];
    const before = offers.map((o) => o.id);
    pickSponsoredOffer(offers);
    expect(offers.map((o) => o.id)).toEqual(before);
  });
});

describe("isSponsoredNow", () => {
  const now = new Date("2026-09-08T12:00:00.000Z");

  it("null = aldrig sponsrad", () => {
    expect(isSponsoredNow(null, now)).toBe(false);
    expect(isSponsoredNow(undefined, now)).toBe(false);
  });

  it("framtida datum = sponsrad", () => {
    expect(isSponsoredNow(new Date("2026-10-01T00:00:00.000Z"), now)).toBe(true);
    expect(isSponsoredNow("2026-10-01T00:00:00.000Z", now)).toBe(true);
  });

  // ⛔ Utgången sponsring släcks av KLOCKAN, inte av att någon bockar ur i admin.
  it("passerat datum = inte sponsrad längre", () => {
    expect(isSponsoredNow(new Date("2026-09-07T23:59:59.999Z"), now)).toBe(false);
  });

  it("skräpdatum är aldrig en sponsring", () => {
    expect(isSponsoredNow("inte-ett-datum", now)).toBe(false);
  });
});
