/**
 * ÖVERLAPPET MELLAN JOBB (2026-10-11) — src/lib/discord-restock-ledger.ts + workflowet.
 * Nästa jobb tar över på förra jobbets klockslag och hoppar över det förra jobbet hann
 * posta efter ögonblicksbilden — kanalens historik är den delade liggaren.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  cutoverWaitMs,
  embedKind,
  findInLedger,
  ledgerFromMessages,
  parseHandoffMeta,
  postKind,
  publicRestockChannelIds,
} from "@/lib/discord-restock-ledger";
import { buildRestockEmbed, type RestockPost } from "@/lib/discord-restock";

const URL_A = "https://speltrollet.se/products/pk-booster-b-30th-hello";
const post: RestockPost = {
  key: `Speltrollet\t${URL_A}`,
  title: "30th Celebration Booster Bundle",
  storeName: "Speltrollet",
  storeUrl: URL_A,
  priceOre: 64900,
  imageUrl: null,
  setName: "30th Celebration",
  series: null,
  productUrl: null,
};

const T0 = Date.parse("2026-10-11T13:00:00Z");
const msg = (id: string, at: number, embeds: { url?: string; title?: string }[]) => ({
  id,
  timestamp: new Date(at).toISOString(),
  embeds,
});

describe("sorten — samma grenar som embeddens rubrik", () => {
  it("postKind och embedKind är överens för påfyllning, butiksvara och pris", () => {
    for (const p of [
      post,
      { ...post, storeOnly: true },
      { ...post, previousPriceOre: 69900 },
      { ...post, previousPriceOre: 59900 }, // höjt pris
    ]) {
      expect(embedKind(buildRestockEmbed(p).title)).toBe(postKind(p));
    }
    expect(postKind(post)).toBe("restock");
  });

  it("embeddens länk i de publika kanalerna är butikens sida (det liggaren matchar på)", () => {
    expect(buildRestockEmbed(post).url).toBe(URL_A);
  });
});

describe("ledgerFromMessages", () => {
  it("läser embeds sedan fönstrets start, hoppar egna och för gamla meddelanden", () => {
    const messages = [
      msg("m3", T0 + 30_000, [{ url: URL_A, title: post.title }]),
      msg("m2", T0 - 120_000, [{ url: "https://x.se/old", title: "Gammal" }]),
      msg("own", T0 + 40_000, [{ url: "https://x.se/own", title: "Eget" }]),
      { id: "trasig" },
    ];
    const entries = ledgerFromMessages("c1", messages, T0 - 60_000, new Set(["own"]));
    expect(entries).toEqual([{ channelId: "c1", messageId: "m3", url: URL_A, kind: "restock", at: T0 + 30_000 }]);
  });

  it("ett svar som inte är en lista ⇒ tom liggare, aldrig ett kast", () => {
    expect(ledgerFromMessages("c1", { message: "Missing Access" }, 0)).toEqual([]);
  });

  it("flera embeds i ett meddelande blir flera rader", () => {
    const entries = ledgerFromMessages(
      "c1",
      [msg("m", T0, [{ url: URL_A, title: "A" }, { url: "https://x.se/b", title: "Nytt lägre pris — B" }])],
      0
    );
    expect(entries.map((e) => e.kind)).toEqual(["restock", "price"]);
  });
});

describe("findInLedger", () => {
  const entries = ledgerFromMessages("c1", [msg("m", T0, [{ url: URL_A, title: post.title }])], 0);
  const cooldown = 15 * 60_000;

  it("förra jobbet postade samma påfyllning i samma kanal ⇒ träff", () => {
    expect(findInLedger(entries, "c1", post, T0 + 60_000, cooldown)?.messageId).toBe("m");
  });

  it("annan kanal, annan URL eller annan sort ⇒ ingen träff", () => {
    expect(findInLedger(entries, "c2", post, T0 + 60_000, cooldown)).toBeNull();
    expect(findInLedger(entries, "c1", { ...post, storeUrl: "https://x.se/b" }, T0 + 60_000, cooldown)).toBeNull();
    expect(findInLedger(entries, "c1", { ...post, previousPriceOre: 69900 }, T0 + 60_000, cooldown)).toBeNull();
    expect(findInLedger(entries, "c1", { ...post, storeOnly: true }, T0 + 60_000, cooldown)).toBeNull();
  });

  it("efter cooldownen är en ny påfyllning en ny nyhet", () => {
    expect(findInLedger(entries, "c1", post, T0 + cooldown, cooldown)).toBeNull();
  });
});

describe("överlämningsfilen", () => {
  it("tolkas strikt", () => {
    expect(parseHandoffMeta({ savedAt: 1, cutoverAt: 2, final: true })).toEqual({ savedAt: 1, cutoverAt: 2, final: true });
    expect(parseHandoffMeta({ savedAt: 1, cutoverAt: 2 })).toEqual({ savedAt: 1, cutoverAt: 2, final: false });
    expect(parseHandoffMeta({ savedAt: "1", cutoverAt: 2 })).toBeNull();
    expect(parseHandoffMeta(null)).toBeNull();
  });

  it("väntar bara på en ögonblicksbild vars slut ligger i framtiden, och aldrig längre än taket", () => {
    const snap = { savedAt: T0 - 60_000, cutoverAt: T0 + 120_000, final: false };
    expect(cutoverWaitMs(snap, T0, 600_000)).toBe(120_000);
    expect(cutoverWaitMs({ ...snap, final: true }, T0, 600_000)).toBe(0);
    expect(cutoverWaitMs({ ...snap, cutoverAt: T0 - 1 }, T0, 600_000)).toBe(0);
    expect(cutoverWaitMs({ ...snap, cutoverAt: T0 + 86_400_000 }, T0, 600_000)).toBe(600_000);
    expect(cutoverWaitMs(null, T0, 600_000)).toBe(0);
  });
});

describe("publicRestockChannelIds", () => {
  it("alla publika kanaler, unika — Pro-spegeln läses inte", () => {
    expect(
      publicRestockChannelIds({
        setChannels: { "30th Celebration": "s1", "Delta Reign": "s2" },
        seriesChannels: {},
        languageChannels: { JP: "s1" },
        defaultChannelId: "d",
        priceChannelId: null,
        storeChannelId: "st",
      }).sort()
    ).toEqual(["d", "s1", "s2", "st"]);
  });
});

describe("workflowet bär överlämningen", () => {
  const root = resolve(__dirname, "../..");
  // CRLF bort: en Windows-utcheckning (core.autocrlf) gav annars "state-\r\n" och testet föll lokalt.
  const workflow = readFileSync(resolve(root, ".github/workflows/discord-restock.yml"), "utf8").replace(/\r\n/g, "\n");
  const script = readFileSync(resolve(root, "scripts/discord-restock-run.ts"), "utf8");

  it("överlämningar får en egen concurrency-grupp — annars väntar nästa jobb ut det gamla", () => {
    expect(workflow).toContain("format('-h-{0}', github.run_id)");
  });

  it("ögonblicksbilden sparas på samma prefix som nästa jobb återställer", () => {
    expect(workflow).toContain("key: discord-restock-state-${{ github.run_id }}-h");
    expect(workflow).toContain("discord-restock-state-\n");
    expect(workflow).toContain('gh cache list --key "discord-restock-state-$ME-h"');
  });

  it("markören och överlämningstiden stämmer mellan script och workflow", () => {
    expect(script).toContain('".discord-restock-handoff.ready"');
    expect(workflow).toContain(".discord-restock-handoff.ready");
    expect(workflow).toMatch(/DISCORD_RESTOCK_HANDOFF_SECONDS: "\d+"/);
  });

  it("lanens steg ärver ingen token; skrivrätten ligger bara på handoff/kickoff", () => {
    const start = workflow.slice(workflow.indexOf("name: Starta lanen"), workflow.indexOf("name: Vakt mot dubbla laner"));
    expect(start).not.toContain("GH_TOKEN");
    expect(workflow.match(/^\s+actions: write\s*$/gm)?.length).toBe(2);
  });
});
