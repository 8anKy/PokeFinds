import { describe, it, expect } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { buildIndexNowPayloads, INDEXNOW_KEY, INDEXNOW_MAX_URLS } from "@/lib/indexnow";

describe("IndexNow", () => {
  it("nyckelfilen ligger i public/ och innehåller exakt nyckeln", () => {
    const file = path.join(process.cwd(), "public", `${INDEXNOW_KEY}.txt`);
    expect(fs.readFileSync(file, "utf-8").trim()).toBe(INDEXNOW_KEY);
  });

  it("tar bara med URL:er på sajtens egen värd och tar bort dubbletter", () => {
    const [p] = buildIndexNowPayloads("https://foilio.se", [
      "https://foilio.se/discord",
      "https://foilio.se/discord",
      "https://www.foilio.se/om",
      "https://example.com/x",
      "inte en url",
    ]);
    expect(p.host).toBe("foilio.se");
    expect(p.keyLocation).toBe(`https://foilio.se/${INDEXNOW_KEY}.txt`);
    expect(p.urlList).toEqual(["https://foilio.se/discord"]);
  });

  it("delar upp i protokollets tak per anrop", () => {
    const urls = Array.from({ length: INDEXNOW_MAX_URLS + 5 }, (_, i) => `https://foilio.se/p/${i}`);
    const payloads = buildIndexNowPayloads("https://foilio.se", urls);
    expect(payloads.map((p) => p.urlList.length)).toEqual([INDEXNOW_MAX_URLS, 5]);
  });

  it("inga URL:er ⇒ inga anrop", () => {
    expect(buildIndexNowPayloads("https://foilio.se", [])).toEqual([]);
  });
});
