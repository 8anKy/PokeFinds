import { describe, it, expect, vi } from "vitest";
import { cachedRead, singleFlight } from "@/lib/cache";

describe("singleFlight — samtidiga identiska läsningar blir EN DB-fråga", () => {
  it("två parallella anrop med samma nyckel kör funktionen en gång", async () => {
    const raw = vi.fn(async (slug: string) => {
      await new Promise((r) => setTimeout(r, 20));
      return `data:${slug}`;
    });
    const wrapped = singleFlight(raw, (s) => s);

    // Precis produktsidans mönster: generateMetadata + sidkroppen startar parallellt.
    const [a, b] = await Promise.all([wrapped("glurak"), wrapped("glurak")]);

    expect(raw).toHaveBeenCalledTimes(1);
    expect(a).toBe("data:glurak");
    expect(b).toBe("data:glurak");
  });

  it("olika nycklar delar INTE löfte", async () => {
    const raw = vi.fn(async (slug: string) => slug);
    const wrapped = singleFlight(raw, (s) => s);
    await Promise.all([wrapped("a"), wrapped("b")]);
    expect(raw).toHaveBeenCalledTimes(2);
  });

  it("är ingen cache: ett SENARE anrop kör om (noll inaktualitet)", async () => {
    let n = 0;
    const wrapped = singleFlight(async () => ++n, () => "k");
    expect(await wrapped()).toBe(1);
    expect(await wrapped()).toBe(2);
  });

  it("ett avvisat löfte städas — nästa anrop får försöka igen", async () => {
    let attempt = 0;
    const wrapped = singleFlight(
      async () => {
        attempt++;
        if (attempt === 1) throw new Error("Neon sov");
        return "ok";
      },
      () => "k",
    );

    await expect(wrapped()).rejects.toThrow("Neon sov");
    // Utan städning i `finally` hade det trasiga löftet återanvänts för evigt.
    expect(await wrapped()).toBe("ok");
  });

  it("alla samtidiga anropare får SAMMA fel när läsningen misslyckas", async () => {
    const wrapped = singleFlight(async () => {
      await new Promise((r) => setTimeout(r, 10));
      throw new Error("P1017");
    }, () => "k");
    const results = await Promise.allSettled([wrapped(), wrapped()]);
    expect(results.every((r) => r.status === "rejected")).toBe(true);
  });
});

// Identitet: testet vaktar KOMPOSITIONEN (att cachedRead lägger singleFlight runt
// råfunktionen), inte Nexts cachelager — unstable_cache kräver en request-kontext
// som inte finns i vitest.
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));

describe("cachedRead — åskflocken deduperas", () => {
  it("två samtidiga missar på samma nyckel+args kör råfunktionen EN gång", async () => {
    const raw = vi.fn(async (days: number) => {
      await new Promise((r) => setTimeout(r, 20));
      return days * 2;
    });
    const cached = cachedRead(raw, "testKey");
    const [a, b] = await Promise.all([cached(7), cached(7)]);
    expect(raw).toHaveBeenCalledTimes(1);
    expect(a).toBe(14);
    expect(b).toBe(14);
    // Olika args = olika nycklar — deduperas INTE ihop.
    await cached(30);
    expect(raw).toHaveBeenCalledTimes(2);
  });
});
