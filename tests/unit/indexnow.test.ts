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
    const [p] = buildIndexNowPayloads("https://scoutr.se", [
      "https://scoutr.se/discord",
      "https://scoutr.se/discord",
      "https://www.scoutr.se/om",
      "https://example.com/x",
      "inte en url",
    ]);
    expect(p.host).toBe("scoutr.se");
    expect(p.keyLocation).toBe(`https://scoutr.se/${INDEXNOW_KEY}.txt`);
    expect(p.urlList).toEqual(["https://scoutr.se/discord"]);
  });

  it("delar upp i protokollets tak per anrop", () => {
    const urls = Array.from({ length: INDEXNOW_MAX_URLS + 5 }, (_, i) => `https://scoutr.se/p/${i}`);
    const payloads = buildIndexNowPayloads("https://scoutr.se", urls);
    expect(payloads.map((p) => p.urlList.length)).toEqual([INDEXNOW_MAX_URLS, 5]);
  });

  it("inga URL:er ⇒ inga anrop", () => {
    expect(buildIndexNowPayloads("https://scoutr.se", [])).toEqual([]);
  });
});
