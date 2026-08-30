import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { TcgdexUnavailable, isRetryableStatus, tcgdexJson } from "@/lib/tcgdex";

/**
 * 2026-08-30: api.tcgdex.net vägrade anslutningar från GitHub-runnern i några
 * minuter (ETIMEDOUT). Nämnarsteget och bildlagningen i import-new-sets.yml
 * anropade `fetch()` bart och dog på första anropet. Värre: nämnarsteget
 * behandlade ett icke-ok svar på SET-LISTAN som en tom lista, vilket hade
 * skrivit tcgdexId=null/printingsTotal=0 för alla 176 set.
 *
 * Vakten här: (1) nätverksfel ger omförsök och sedan ett SÄRSKILT fel som
 * anroparen kan skilja från "finns inte", (2) 404 är ett DATA-svar (null) och
 * ger inga omförsök, (3) inget batch-skript i veckojobbet anropar TCGdex bart.
 */

const noSleep = async () => {};
const res = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;

describe("tcgdexJson", () => {
  it("returnerar JSON vid 2xx utan att sova", async () => {
    const fetchImpl = vi.fn(async () => res(200, { id: "sv1" }));
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(tcgdexJson("u", { fetchImpl, sleep })).resolves.toEqual({ id: "sv1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("404 är ett datasvar: null, inga omförsök", async () => {
    const fetchImpl = vi.fn(async () => res(404));
    await expect(tcgdexJson("u", { fetchImpl, sleep: noSleep })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("nätverksfel ger omförsök med backoff och sedan TcgdexUnavailable", async () => {
    const fetchImpl = vi.fn(async () => {
      throw Object.assign(new TypeError("fetch failed"), { code: "ETIMEDOUT" });
    });
    const sleep = vi.fn(async (_ms: number) => {});
    const err = await tcgdexJson("https://api.tcgdex.net/v2/en/sets", { fetchImpl, sleep, retries: 3 }).catch(
      (e) => e
    );
    expect(err).toBeInstanceOf(TcgdexUnavailable);
    expect((err as Error).message).toContain("fetch failed");
    expect(fetchImpl).toHaveBeenCalledTimes(4);
    expect(sleep.mock.calls.map((c) => c[0])).toEqual([1000, 2000, 4000]);
  });

  it("5xx/429 är omförsök, 4xx i övrigt är svaret", async () => {
    expect(isRetryableStatus(500)).toBe(true);
    expect(isRetryableStatus(502)).toBe(true);
    expect(isRetryableStatus(429)).toBe(true);
    expect(isRetryableStatus(404)).toBe(false);
    expect(isRetryableStatus(403)).toBe(false);

    let calls = 0;
    const fetchImpl = vi.fn(async () => (++calls < 3 ? res(503) : res(200, [{ id: "a" }])));
    await expect(tcgdexJson("u", { fetchImpl, sleep: noSleep })).resolves.toEqual([{ id: "a" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("varje försök bär en timeout", async () => {
    const fetchImpl = vi.fn(async (_u: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      return res(200);
    });
    await tcgdexJson("u", { fetchImpl, sleep: noSleep });
  });
});

describe("veckojobbets TCGdex-anrop går via hjälparen", () => {
  it.each(["scripts/import-set-denominators.ts", "scripts/fix-card-images.ts"])("%s", (file) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(src).toMatch(/from "\.\.\/src\/lib\/tcgdex"/);
    // Ett bart fetch mot TCGdex är exakt det som dog 2026-08-30.
    expect(src).not.toMatch(/\bfetch\(\s*[`"']https:\/\/api\.tcgdex\.net/);
  });

  it("nämnarskriptet nollar aldrig TCGdex-värden när källan är otillgänglig", () => {
    const src = readFileSync(resolve(process.cwd(), "scripts/import-set-denominators.ts"), "utf8");
    expect(src).toContain("dexId: s.tcgdexId, printings: s.printingsTotal");
    expect(src).toContain("instanceof TcgdexUnavailable");
  });
});
