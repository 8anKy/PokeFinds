import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { jsonOrNull } from "@/lib/json-or-null";

describe("jsonOrNull", () => {
  it("läser ett helt svar", async () => {
    expect(await jsonOrNull<{ a: number }>(new Response('{"a":1}'))).toEqual({ a: 1 });
  });

  it("ger null på ett avklippt svar i stället för att kasta (nattkörningen 2026-11-24)", async () => {
    expect(await jsonOrNull(new Response('{"data":[{"name":"Pika'))).toBeNull();
  });

  it("ger null på tom kropp", async () => {
    expect(await jsonOrNull(new Response(""))).toBeNull();
  });
});

describe("cardmarket-refresh.yml: reservens spärr", () => {
  const yml = readFileSync(join(process.cwd(), ".github/workflows/cardmarket-refresh.yml"), "utf8");

  it("spärren läser ett stegnamn som faktiskt finns i jobbet", () => {
    const read = yml.match(/select\(\.name == "([^"]+)" and \.conclusion == "success"\)/)?.[1];
    expect(read).toBeTruthy();
    expect(yml).toMatch(new RegExp(`^\\s+name: ${read!.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}( #.*)?$`, "m"));
  });
});
