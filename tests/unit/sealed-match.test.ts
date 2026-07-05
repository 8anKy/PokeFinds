/**
 * bestSealedMatch: set-scopad match som förr + global match för set-lösa
 * auto-importerade stubs (den nya grenen).
 */
import { describe, expect, it } from "vitest";
import { bestSealedMatch } from "@/jobs/cardmarket-refresh";

const api = [
  { name: "Mega Evolution First Partner Collection Box", cardmarket_id: 1, episode: { name: "Mega Evolution" } },
  { name: "Prismatic Evolutions Elite Trainer Box", cardmarket_id: 2, episode: { name: "Prismatic Evolutions" } },
  { name: "Surging Sparks Booster Display", cardmarket_id: 3, episode: { name: "Surging Sparks" } },
];
const byEpisode = new Map<string, typeof api>();
for (const p of api) byEpisode.set(p.episode.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim(), [p]);

describe("bestSealedMatch", () => {
  it("matchar set-lös stub globalt på namn", () => {
    const m = bestSealedMatch(
      { title: "Mega Evolution First Partner Collection Box", category: "COLLECTION_BOX", setName: null },
      api, byEpisode
    );
    expect(m?.match.cardmarket_id).toBe(1);
  });

  it("skippar set-lös stub när inget namn är tillräckligt likt (över tröskel)", () => {
    const m = bestSealedMatch(
      { title: "Random Unrelated Plush Keychain", category: "COLLECTION_BOX", setName: null },
      api, byEpisode
    );
    expect(m).toBeNull();
  });

  it("respekterar form-gate: booster-box kräver 'booster' i API-namnet", () => {
    // ETB-namn ska aldrig matcha en BOOSTER_BOX-fråga.
    const m = bestSealedMatch(
      { title: "Prismatic Evolutions Booster Box", category: "BOOSTER_BOX", setName: null },
      api, byEpisode
    );
    expect(m?.match.cardmarket_id).not.toBe(2); // inte ETB:n
  });

  it("set-scopat: matchar bara inom episoden", () => {
    const m = bestSealedMatch(
      { title: "Elite Trainer Box", category: "ETB", setName: "Prismatic Evolutions" },
      api, byEpisode
    );
    expect(m?.match.cardmarket_id).toBe(2);
  });
});
