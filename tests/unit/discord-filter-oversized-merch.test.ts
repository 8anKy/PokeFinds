import { describe, it, expect } from "vitest";
import { classifyDiscordListing, isOversizedCardOnly } from "@/lib/discord-restock-filter";

// 2026-10-14: tre slags skräp nådde kanalerna — ett överdimensionerat kort (gömd produkt,
// räddad av rutten), Phoenix Shields akrylskydd och Polaroid-kamerapaket.
const ctx = { setNames: ["30th celebration", "first partner"], sets: [] } as never;

describe("Discord-filtret: kort, skydd och kameror", () => {
  it("⛔ överdimensionerat kort utan boosters", () => {
    const t = 'Pokemon TCG: First Partner 25th Anniversary Oversized Card Promo Pack "Kalos"';
    expect(isOversizedCardOnly(t)).toBe(true);
    expect(classifyDiscordListing({ title: t, url: "https://x.se/a" }, ctx)).toMatchObject({ ok: false, reason: "oversized-card" });
  });
  it("jumbo-kollektioner med boosters är riktiga varor", () => {
    expect(isOversizedCardOnly("Jumbo Card Collection - Mew")).toBe(false);
    expect(isOversizedCardOnly("Oversized Card Collection with 4 Booster Packs")).toBe(false);
  });
  it("⛔ akrylskydd och Polaroid-paket", () => {
    expect(classifyDiscordListing({ title: "Phoenix Shield: Pokemon Booster Box Crystal Box Protection 99% UVR (6-Pack)", url: "https://x.se/b" }, ctx).ok).toBe(false);
    expect(classifyDiscordListing({ title: "Pokemon × Polaroid: Polaroid Go Generation 3 Pikachu + 30th celebration Elite Trainer", url: "https://x.se/c" }, ctx)).toMatchObject({ ok: false, reason: "merch" });
  });
  it("en vanlig ETB går igenom", () => {
    expect(classifyDiscordListing({ title: "Pokémon TCG: 30th Celebration Elite Trainer Box", url: "https://x.se/d" }, ctx).ok).toBe(true);
  });
});
