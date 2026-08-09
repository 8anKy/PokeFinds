import { describe, expect, it } from "vitest";
import { readJsonCapped } from "@/lib/body-limit";
import { ServiceError } from "@/lib/errors";

function post(body: string, headers?: Record<string, string>): Request {
  return new Request("http://test.local/api", { method: "POST", body, headers });
}

async function statusOf(promise: Promise<unknown>): Promise<number | null> {
  try {
    await promise;
    return null;
  } catch (e) {
    if (e instanceof ServiceError) return e.status;
    throw e;
  }
}

describe("readJsonCapped", () => {
  it("parsar giltig JSON under taket", async () => {
    const body = JSON.stringify({ hello: "värld", n: 42 });
    await expect(readJsonCapped(post(body), 1024)).resolves.toEqual({ hello: "värld", n: 42 });
  });

  it("avvisar en body över taket med 413, även utan Content-Length", async () => {
    const body = JSON.stringify({ image: "x".repeat(10_000) });
    expect(await statusOf(readJsonCapped(post(body), 1024))).toBe(413);
  });

  it("avvisar på deklarerad Content-Length innan strömmen läses", async () => {
    const req = post("{}", { "content-length": String(50 * 1024 * 1024) });
    expect(await statusOf(readJsonCapped(req, 1024))).toBe(413);
  });

  it("avvisar trasig JSON med 400, aldrig ett okontrollerat kast", async () => {
    expect(await statusOf(readJsonCapped(post("{inte json"), 1024))).toBe(400);
  });

  it("släpper igenom en body exakt på taket", async () => {
    const body = JSON.stringify({ a: "b" });
    await expect(
      readJsonCapped(post(body), Buffer.byteLength(body))
    ).resolves.toEqual({ a: "b" });
  });
});
