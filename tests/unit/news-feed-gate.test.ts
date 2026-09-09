/**
 * Lanseringsspaken för nyheter & evenemang. Testet vaktar det som faktiskt kan
 * gå fel: att en OSATT variabel skulle släppa ut en oavslutad yta.
 */
import { afterEach, describe, expect, it } from "vitest";
import { newsFeedPublic } from "@/lib/news-feed-gate";

const original = process.env.NEXT_PUBLIC_NEWS_FEED_PUBLIC;
afterEach(() => {
  if (original === undefined) delete process.env.NEXT_PUBLIC_NEWS_FEED_PUBLIC;
  else process.env.NEXT_PUBLIC_NEWS_FEED_PUBLIC = original;
});

describe("newsFeedPublic", () => {
  it("är DOLD när variabeln saknas — en osatt spak får aldrig öppna en oavslutad yta", () => {
    delete process.env.NEXT_PUBLIC_NEWS_FEED_PUBLIC;
    expect(newsFeedPublic()).toBe(false);
  });

  it("är dold för allt utom exakt \"1\"", () => {
    for (const value of ["", "0", "true", "yes", "2"]) {
      process.env.NEXT_PUBLIC_NEWS_FEED_PUBLIC = value;
      expect(newsFeedPublic(), value).toBe(false);
    }
  });

  it("öppnar på \"1\"", () => {
    process.env.NEXT_PUBLIC_NEWS_FEED_PUBLIC = "1";
    expect(newsFeedPublic()).toBe(true);
  });
});
