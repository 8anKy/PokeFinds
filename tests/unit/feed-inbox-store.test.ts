/**
 * Inkorgens lager: en oläsbar fil får ALDRIG skrivas över med en tom inkorg, och ett
 * anrop som inte ändrar något skriver ingenting. Så förlorades fem utkast 2026-09-11.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "foilio-inbox-"));
  process.env.FEED_DIR = dir;
});

afterEach(() => {
  delete process.env.FEED_DIR;
  rmSync(dir, { recursive: true, force: true });
});

async function store() {
  // Färsk modulinstans per test så FEED_DIR läses om.
  return await import("@/lib/feed-inbox-store");
}

describe("updateInbox", () => {
  it("vägrar skriva över en fil som inte går att läsa", async () => {
    const file = path.join(dir, "drafts.json");
    writeFileSync(file, "{ trasig json", "utf8");
    const { updateInbox, InboxCorruptError } = await store();
    await expect(updateInbox((d) => ({ ...d, updatedAt: new Date().toISOString() }))).rejects.toBeInstanceOf(InboxCorruptError);
    expect(readFileSync(file, "utf8")).toBe("{ trasig json");
  });

  it("skriver ingenting när fn lämnar dokumentet orört, men skriver när det ändras", async () => {
    const file = path.join(dir, "drafts.json");
    const original = JSON.stringify({ updatedAt: "2026-09-10T00:00:00.000Z", items: [] });
    writeFileSync(file, original, "utf8");
    const { updateInbox } = await store();
    await updateInbox((d) => d);
    expect(readFileSync(file, "utf8")).toBe(original);
    await updateInbox((d) => ({ ...d, updatedAt: "2026-09-11T00:00:00.000Z" }));
    expect(JSON.parse(readFileSync(file, "utf8")).updatedAt).toBe("2026-09-11T00:00:00.000Z");
  });

  it("en saknad fil är ingen korruption — första skrivningen skapar den", async () => {
    const { updateInbox } = await store();
    const doc = await updateInbox((d) => ({ ...d, updatedAt: "2026-09-11T00:00:00.000Z" }));
    expect(doc.items).toEqual([]);
    expect(JSON.parse(readFileSync(path.join(dir, "drafts.json"), "utf8")).updatedAt).toBe("2026-09-11T00:00:00.000Z");
  });
});
