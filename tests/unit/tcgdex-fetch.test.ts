import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ECS_PROBES,
  TcgdexUnavailable,
  isRetryableStatus,
  resetTcgdexState,
  resolveViaDoh,
  tcgdexJson,
  tcgdexPinnedAddress,
} from "@/lib/tcgdex";

/**
 * 2026-08-30: api.tcgdex.net ligger bakom GeoDNS och GitHub-runnern (US-East) fick
 * en DÖD nordamerikansk spegel (198.27.75.82) medan Europa fick fungerande. Två
 * steg i import-new-sets.yml anropade `fetch()` bart och dog; nämnarsteget hade
 * dessutom tolkat ett icke-ok svar på SET-LISTAN som en tom lista och skrivit
 * tcgdexId=null/printingsTotal=0 för alla 176 set.
 *
 * Vakten här: (1) nätverksfel ger omförsök, sedan DNS-fallback via DoH+ECS och
 * en PINNAD adress, sedan ett SÄRSKILT fel som anroparen kan skilja från "finns
 * inte", (2) 404 är ett DATA-svar (null) utan omförsök, (3) kretsbrytaren gör att
 * en nedtid kostar en väntan, inte en per kort, (4) inget jobb/skript anropar
 * TCGdex bart.
 */

beforeEach(() => resetTcgdexState());

const noSleep = async () => {};
const noAlt = async () => [] as string[];
const res = (status: number, body: unknown = {}) =>
  ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response;
const netFail = () =>
  vi.fn(async () => {
    throw Object.assign(new TypeError("fetch failed"), { code: "ETIMEDOUT" });
  });

describe("tcgdexJson — grundkontrakt", () => {
  it("returnerar JSON vid 2xx utan att sova", async () => {
    const fetchImpl = vi.fn(async () => res(200, { id: "sv1" }));
    const sleep = vi.fn(async (_ms: number) => {});
    await expect(tcgdexJson("u", { fetchImpl, sleep })).resolves.toEqual({ id: "sv1" });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
  });

  it("404 är ett datasvar: null, inga omförsök, ingen fallback", async () => {
    const fetchImpl = vi.fn(async () => res(404));
    const resolveAlternatives = vi.fn(noAlt);
    await expect(tcgdexJson("u", { fetchImpl, sleep: noSleep, resolveAlternatives })).resolves.toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(resolveAlternatives).not.toHaveBeenCalled();
  });

  it("nätverksfel ger omförsök med backoff och sedan TcgdexUnavailable", async () => {
    const fetchImpl = netFail();
    const sleep = vi.fn(async (_ms: number) => {});
    const err = await tcgdexJson("https://api.tcgdex.net/v2/en/sets", {
      fetchImpl,
      sleep,
      retries: 3,
      resolveAlternatives: noAlt,
    }).catch((e) => e);
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

describe("tcgdexJson — DNS-fallback (död GeoDNS-spegel)", () => {
  it("nätverksfel ⇒ provar andra regioners adresser, pinnar den som svarar, och går dit direkt sedan", async () => {
    const fetchImpl = netFail();
    const resolveAlternatives = vi.fn(async (host: string) => {
      expect(host).toBe("api.tcgdex.net");
      return ["198.27.75.82", "51.68.233.163"];
    });
    const getViaAddress = vi.fn(async (_url: string, address: string) => {
      if (address === "198.27.75.82") throw new Error("timeout efter 15000 ms");
      return res(200, [{ id: "sv1" }]);
    });
    const opts = { fetchImpl, sleep: noSleep, retries: 1, resolveAlternatives, getViaAddress };

    await expect(tcgdexJson("https://api.tcgdex.net/v2/en/sets", opts)).resolves.toEqual([{ id: "sv1" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(getViaAddress.mock.calls.map((c) => c[1])).toEqual(["198.27.75.82", "51.68.233.163"]);
    expect(tcgdexPinnedAddress()).toBe("51.68.233.163");

    // Nästa anrop: pinnad adress, inget systemuppslag, ingen ny DoH-fråga.
    await expect(tcgdexJson("https://api.tcgdex.net/v2/en/sets/sv1", opts)).resolves.toEqual([{ id: "sv1" }]);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(resolveAlternatives).toHaveBeenCalledTimes(1);
    expect(getViaAddress).toHaveBeenCalledTimes(3);
  });

  it("404 via den pinnade adressen är fortfarande ett datasvar", async () => {
    const fetchImpl = netFail();
    const getViaAddress = vi.fn(async () => res(404));
    const r = await tcgdexJson("https://api.tcgdex.net/v2/en/cards/x", {
      fetchImpl,
      sleep: noSleep,
      retries: 0,
      resolveAlternatives: async () => ["51.68.233.163"],
      getViaAddress,
    });
    expect(r).toBeNull();
    expect(tcgdexPinnedAddress()).toBe("51.68.233.163");
  });

  it("ett HTTP-svar (5xx) efter alla omförsök utlöser INGEN DNS-fallback — servern nåddes", async () => {
    const fetchImpl = vi.fn(async () => res(503));
    const resolveAlternatives = vi.fn(noAlt);
    await expect(
      tcgdexJson("u", { fetchImpl, sleep: noSleep, retries: 1, resolveAlternatives })
    ).rejects.toBeInstanceOf(TcgdexUnavailable);
    expect(resolveAlternatives).not.toHaveBeenCalled();
  });

  it("resolveViaDoh frågar med tre prefix och returnerar distinkta A-svar", async () => {
    const seen: string[] = [];
    const fetchImpl = vi.fn(async (u: RequestInfo | URL) => {
      const url = new URL(String(u));
      seen.push(url.searchParams.get("edns_client_subnet")!);
      expect(url.host).toBe("dns.google");
      expect(url.searchParams.get("name")).toBe("api.tcgdex.net");
      const ip = url.searchParams.get("edns_client_subnet") === "0.0.0.0/0" ? "198.27.75.82" : "51.68.233.163";
      return res(200, { Answer: [{ type: 1, data: ip }, { type: 5, data: "cname.example." }] });
    });
    await expect(resolveViaDoh("api.tcgdex.net", fetchImpl)).resolves.toEqual(["198.27.75.82", "51.68.233.163"]);
    expect(seen).toEqual([...ECS_PROBES]);
  });

  it("resolveViaDoh ger tom lista när DoH inte svarar", async () => {
    await expect(resolveViaDoh("api.tcgdex.net", netFail())).resolves.toEqual([]);
  });
});

describe("tcgdexJson — kretsbrytare", () => {
  it("efter ett uppgivet anrop är värden nere för alla: kastar direkt utan fetch/sömn", async () => {
    const fetchImpl = netFail();
    const sleep = vi.fn(async (_ms: number) => {});
    const opts = { fetchImpl, sleep, retries: 1, resolveAlternatives: noAlt };
    const u = (p: string) => `https://api.tcgdex.net/v2/en/${p}`;
    await expect(tcgdexJson(u("sets"), opts)).rejects.toBeInstanceOf(TcgdexUnavailable);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // Körning 33324672536: 29 min av (försök + sömn + försök) per kort mot ett dött värd.
    await expect(tcgdexJson(u("cards/sv01-001"), opts)).rejects.toBeInstanceOf(TcgdexUnavailable);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(sleep).toHaveBeenCalledTimes(1);

    resetTcgdexState();
    await tcgdexJson(u("cards/sv01-002"), { ...opts, retries: 0 }).catch(() => null);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it("ett 404 öppnar INTE brytaren", async () => {
    const fetchImpl = vi.fn(async () => res(404));
    await tcgdexJson("a", { fetchImpl, sleep: noSleep });
    await tcgdexJson("b", { fetchImpl, sleep: noSleep });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe("alla TCGdex-anrop i jobb och veckoskript går via hjälparen", () => {
  it.each([
    "scripts/import-set-denominators.ts",
    "scripts/fix-card-images.ts",
    "src/jobs/cardtrader-reverse.ts",
    "src/jobs/cardtrader-first-edition.ts",
    "src/jobs/jp-set-label.ts",
  ])("%s", (file) => {
    const src = readFileSync(resolve(process.cwd(), file), "utf8");
    expect(src).toMatch(/from "(\.\.\/src|@|\.\.?)\/lib\/tcgdex"/);
    // Ett bart fetch mot TCGdex är exakt det som dog (eller tystnade) 2026-08-30.
    expect(src).not.toMatch(/\bfetch\(\s*[`"']https:\/\/api\.tcgdex\.net/);
  });

  it("nämnarskriptet nollar aldrig TCGdex-värden när källan är otillgänglig", () => {
    const src = readFileSync(resolve(process.cwd(), "scripts/import-set-denominators.ts"), "utf8");
    expect(src).toContain("dexId: s.tcgdexId, printings: s.printingsTotal");
    expect(src).toContain("instanceof TcgdexUnavailable");
  });
});
