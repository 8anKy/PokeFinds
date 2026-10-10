/**
 * /pris (Pro, 2026-10-10): sök, autocomplete, svaret ur snapshoten och signaturen.
 */
import { describe, expect, it } from "vitest";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  autocompleteChoices,
  buildPriceEmbed,
  normalizeSearch,
  proRequiredMessage,
  resolveQuery,
  searchCatalogIndex,
} from "@/lib/discord-price-command";
import { memberHasPro, verifyDiscordSignature } from "@/lib/discord-interactions";
import type { SnapshotEntry, SnapshotIndexEntry } from "@/lib/catalog-snapshot";

const INDEX: SnapshotIndexEntry[] = [
  { s: "pitch-black-etb", t: "Pitch Black Elite Trainer Box", set: "Pitch Black", l: "EN", n: null, sold: [105000, 6] },
  { s: "pitch-black-etb-pc", t: "Pitch Black Elite Trainer Box (Pokémon Center)", set: "Pitch Black", l: "EN", n: null },
  { s: "pitch-black-box-jp", t: "Pitch Black Booster Box", set: "Pitch Black", l: "JP", n: null },
  { s: "charizard-ex-199", t: "Charizard ex", set: "Obsidian Flames", l: "EN", n: "199/197" },
  { s: "charizard-ex-125", t: "Charizard ex", set: "Obsidian Flames", l: "EN", n: "125/197" },
];

describe("sökning", () => {
  it("normaliserar diakriter och skiljetecken", () => {
    expect(normalizeSearch("Pokémon: Pitch-Black!")).toBe("pokemon pitch black");
  });

  it("alla ord måste finnas; exakt titel vinner över varianter", () => {
    const hits = searchCatalogIndex(INDEX, "pitch black elite trainer box");
    expect(hits.map((h) => h.s)).toEqual(["pitch-black-etb", "pitch-black-etb-pc"]);
  });

  it("kortnummer: '199' träffar 199/197, inte 125/197", () => {
    expect(searchCatalogIndex(INDEX, "charizard 199").map((h) => h.s)).toEqual(["charizard-ex-199"]);
  });

  it("'jp' filtrerar på språket i stället för att krävas i titeln", () => {
    expect(searchCatalogIndex(INDEX, "pitch black jp").map((h) => h.s)).toEqual(["pitch-black-box-jp"]);
  });

  it("förkortningar: etb hittar Elite Trainer Box", () => {
    expect(searchCatalogIndex(INDEX, "pitch black etb")[0]?.s).toBe("pitch-black-etb");
  });

  it("tom fråga ⇒ inga träffar", () => {
    expect(searchCatalogIndex(INDEX, "  ")).toEqual([]);
  });

  it("autocomplete: slug som värde, etikett med nummer och (JP)", () => {
    const choices = autocompleteChoices(searchCatalogIndex(INDEX, "charizard"));
    expect(choices).toContainEqual({ name: "Charizard ex · #199/197 · Obsidian Flames", value: "charizard-ex-199" });
    expect(autocompleteChoices([INDEX[2]])[0].name).toBe("Pitch Black Booster Box (JP)");
  });

  it("inskickat värde: slug ur autocomplete vinner, annars bästa sökträffen", () => {
    expect(resolveQuery(INDEX, "charizard-ex-199")?.s).toBe("charizard-ex-199");
    expect(resolveQuery(INDEX, "pitch black etb pokemon center")?.s).toBe("pitch-black-etb-pc");
    expect(resolveQuery(INDEX, "finns inte")).toBeNull();
  });
});

describe("svaret", () => {
  const offer = (name: string, price: number, stockStatus = "IN_STOCK") => ({
    id: name,
    price,
    shippingPrice: null,
    stockStatus,
    url: `https://${name.toLowerCase()}.se/p`,
    retailerId: name,
    retailer: { id: name, name, logoUrl: null, websiteUrl: "", affiliateEnabled: false, sponsored: false },
  });
  const entry = {
    id: "p1",
    slug: "pitch-black-etb",
    title: "Pitch Black Elite Trainer Box",
    category: "ETB",
    language: "EN",
    description: null,
    imageUrl: "/api/cm-image/1",
    set: { id: "s1", name: "Pitch Black" },
    facts: null,
    variants: [],
    prices: {
      offers: [
        offer("Speltrollet", 54900),
        offer("Goblinen", 59900),
        offer("Alphaspel", 49900, "OUT_OF_STOCK"),
        offer("Cardmarket", 69900, "OUT_OF_STOCK"),
        offer("Tradera", 40000),
      ],
      stats: { lowestPrice: 54900, lowestPriceStockStatus: "IN_STOCK", highestPrice: 59900, avgPrice: 57400, offerCount: 2 },
      affiliateRetailerIds: [],
      at: "2026-10-10T03:00:00.000Z",
    },
  } as unknown as SnapshotEntry;
  const nb = (s: string | undefined) => s?.replace(/ /g, " ");

  it("butiker i lager billigast först — aldrig slutsålda, aldrig marknadsplatser", () => {
    const e = buildPriceEmbed(entry, INDEX[0], "https://foilio.se");
    const stores = nb(e.fields.find((f) => f.name === "I lager i butik")?.value);
    expect(stores).toBe("[Speltrollet](https://speltrollet.se/p) · 549 kr\n[Goblinen](https://goblinen.se/p) · 599 kr");
  });

  it("marknadsvärde mot billigaste butik, Tradera sålt, grön kant, nattens tid", () => {
    const e = buildPriceEmbed(entry, INDEX[0], "https://foilio.se");
    expect(nb(e.fields.find((f) => f.name === "Marknadsvärde")?.value)).toBe("699 kr · 21 % under (billigaste butik)");
    expect(nb(e.fields.find((f) => f.name === "Tradera sålt")?.value)).toBe("1 050 kr · median av 6 sålda, 30 d");
    expect(e.color).toBe(0x22c55e);
    expect(e.description).toContain(`<t:${Date.parse("2026-10-10T03:00:00.000Z") / 1000}:R>`);
    expect(e.url).toBe("https://foilio.se/produkter/pitch-black-etb");
    expect(e.thumbnail).toEqual({ url: "https://foilio.se/api/cm-image/1" });
  });

  it("utan lager: säger det i stället för att tiga", () => {
    const empty = { ...entry, prices: { ...entry.prices, offers: [] } } as SnapshotEntry;
    const e = buildPriceEmbed(empty, null, "https://foilio.se");
    expect(e.fields[0].value).toContain("Ingen butik");
    expect(e.fields.some((f) => f.name === "Marknadsvärde")).toBe(false);
  });

  it("utan Pro: efemär uppmaning med länk till prissidan", () => {
    const m = proRequiredMessage("https://foilio.se");
    expect(m.flags).toBe(64);
    expect(m.content).toContain("https://foilio.se/priser");
  });
});

describe("interaktionernas säkerhet", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawPub = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
  const body = JSON.stringify({ type: 1 });
  const ts = "1760000000";
  const sig = sign(null, Buffer.from(ts + body), privateKey).toString("hex");

  it("godtar en äkta signatur", () => {
    expect(verifyDiscordSignature(rawPub, sig, ts, body)).toBe(true);
  });

  it("⛔ underkänner ändrad kropp, fel tid, saknad signatur och skräp", () => {
    expect(verifyDiscordSignature(rawPub, sig, ts, body + " ")).toBe(false);
    expect(verifyDiscordSignature(rawPub, sig, "1760000001", body)).toBe(false);
    expect(verifyDiscordSignature(rawPub, null, ts, body)).toBe(false);
    expect(verifyDiscordSignature("zz", sig, ts, body)).toBe(false);
  });

  it("Pro = Pro-rollen på medlemmen; ingen roll konfigurerad ⇒ nej", () => {
    expect(memberHasPro({ type: 2, member: { roles: ["r-pro"] } }, "r-pro")).toBe(true);
    expect(memberHasPro({ type: 2, member: { roles: ["r-x"] } }, "r-pro")).toBe(false);
    expect(memberHasPro({ type: 2 }, "r-pro")).toBe(false);
    expect(memberHasPro({ type: 2, member: { roles: ["r-pro"] } }, undefined)).toBe(false);
  });
});
