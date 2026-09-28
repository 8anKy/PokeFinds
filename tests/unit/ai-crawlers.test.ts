/**
 * AI-ASSISTENTERNAS CRAWLERS (ägarbeslut 2026-09-28): indexerarna får navsidorna men
 * ALDRIG katalogens produktsidor (det var svepet som höll Neon vaken), användarhämtarna
 * får allt publikt, träningscrawlarna är kvar i blocklistan.
 */
import { describe, expect, it } from "vitest";
import { AI_INDEXER, aiIndexerMayFetch } from "@/lib/ai-crawlers";
import { isBlockedBot } from "@/lib/blocked-bots";
import robots from "@/app/robots";

describe("AI-indexerarna: navsidor ja, katalog nej", () => {
  it.each(["/", "/en", "/sets", "/sets/sv8", "/en/sets/sv8", "/guider", "/guider/kommande-pokemon-set", "/om", "/priser", "/discord", "/produkter", "/en/produkter"])(
    "får hämta %s",
    (path) => expect(aiIndexerMayFetch(path)).toBe(true)
  );

  it.each(["/produkter/30th-celebration-elite-trainer-box", "/en/produkter/x", "/samling", "/forum", "/setsx", "/profil/milos"])(
    "får INTE hämta %s",
    (path) => expect(aiIndexerMayFetch(path)).toBe(false)
  );

  it("känner igen de tre indexerarna, inte användarhämtarna", () => {
    expect(AI_INDEXER.test("compatible; OAI-SearchBot/1.3")).toBe(true);
    expect(AI_INDEXER.test("compatible; Claude-SearchBot/1.0")).toBe(true);
    expect(AI_INDEXER.test("compatible; PerplexityBot/1.0")).toBe(true);
    expect(AI_INDEXER.test("compatible; ChatGPT-User/1.0")).toBe(false);
    expect(AI_INDEXER.test("compatible; Perplexity-User/1.0")).toBe(false);
  });

  it("träningscrawlarna är fortfarande blockerade", () => {
    expect(isBlockedBot("compatible; GPTBot/1.1; +https://openai.com/gptbot")).toBe(true);
    expect(isBlockedBot("compatible; ClaudeBot/1.0; +claudebot@anthropic.com")).toBe(true);
    expect(isBlockedBot("CCBot/2.0 (https://commoncrawl.org/faq/)")).toBe(true);
  });
});

describe("robots.txt speglar samma regler", () => {
  const rules = robots().rules as { userAgent: string | string[]; allow?: string | string[]; disallow?: string | string[] }[];
  const groupFor = (ua: string) => rules.find((r) => ([] as string[]).concat(r.userAgent).includes(ua));

  it("indexerarnas grupp: Disallow / med navsidorna tillåtna, katalogen bara EXAKT (aldrig produktsidorna)", () => {
    const g = groupFor("OAI-SearchBot")!;
    expect(g.disallow).toBe("/");
    const allow = ([] as string[]).concat(g.allow ?? []);
    expect(allow).toEqual(expect.arrayContaining(["/$", "/sets", "/guider", "/en/sets", "/llms.txt"]));
    expect(allow.filter((a) => a.includes("produkter"))).toEqual(["/produkter$", "/en/produkter$"]);
  });

  it("användarhämtarna följer besökarreglerna (samma disallow som *)", () => {
    const star = groupFor("*")!;
    const user = groupFor("ChatGPT-User")!;
    expect(user.disallow).toEqual(star.disallow);
  });

  it("ingen AI-assistent ligger kvar i den totalblockerade gruppen", () => {
    const blocked = rules.find((r) => r.disallow === "/" && ([] as string[]).concat(r.userAgent).includes("GPTBot"))!;
    const uas = ([] as string[]).concat(blocked.userAgent);
    for (const ua of ["OAI-SearchBot", "ChatGPT-User", "Claude-SearchBot", "Claude-User", "PerplexityBot", "Perplexity-User"]) {
      expect(uas).not.toContain(ua);
    }
  });
});
