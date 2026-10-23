import { describe, expect, it } from "vitest";
import { boosterBoxCountMismatch } from "@/scrapers/matching";

describe("boosterBoxCountMismatch", () => {
  it("18-displayen är en annan vara än booster boxen", () => {
    expect(boosterBoxCountMismatch("Evolving Skies Booster Box (18 Boosters)", "evolving skies booster box")).toBe(true);
    expect(boosterBoxCountMismatch("Evolving Skies Booster Box", "evolving skies booster box 18 boosters")).toBe(true);
    expect(boosterBoxCountMismatch("Evolving Skies Display 36 Boosters", "evolving skies booster box 18 boosters")).toBe(true);
  });
  it("samma antal eller inget antal på någon sida = ingen konflikt", () => {
    expect(boosterBoxCountMismatch("Evolving Skies Booster Box 36-pack", "evolving skies booster box")).toBe(false);
    expect(boosterBoxCountMismatch("Evolving Skies Booster Box (18 Boosters)", "evolving skies booster box 18 boosters")).toBe(false);
    expect(boosterBoxCountMismatch("Terastal Festival Booster Box (10 packs)", "terastal festival booster box")).toBe(false);
    expect(boosterBoxCountMismatch("Surging Sparks ETB", "surging sparks elite trainer box")).toBe(false);
  });
});
