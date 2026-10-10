/**
 * LARM SOM DISCORD-DM (Pro, 2026-10-10) — src/lib/discord-dm.ts.
 * Bästa försök: stängda DM är ett normalt utfall och inget får kasta (ett kast hade
 * gjort larmet PENDING igen och skickat mejlet en gång till).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildAlertDmEmbed, sendAlertDm } from "@/lib/discord-dm";
import { parseNotificationSettings } from "@/lib/notification-settings";

const CONTENT = {
  title: "Åter i lager!",
  body: "Pitch Black ETB finns i lager hos Speltrollet.",
  url: "https://speltrollet.se/products/etb",
  imageUrl: "https://foilio.se/api/cm-image/1",
};

describe("buildAlertDmEmbed", () => {
  it("bär rubrik, text, länk och bild", () => {
    const e = buildAlertDmEmbed(CONTENT);
    expect(e.title).toBe("Åter i lager!");
    expect(e.description).toContain("Speltrollet");
    expect(e.url).toBe(CONTENT.url);
    expect(e.thumbnail).toEqual({ url: CONTENT.imageUrl });
    expect(e.footer.text).toContain("Inställningar");
  });

  it("utan länk/bild: inga tomma fält (Discord svarar 400 på url: null)", () => {
    const e = buildAlertDmEmbed({ ...CONTENT, url: null, imageUrl: null });
    expect("url" in e).toBe(false);
    expect("thumbnail" in e).toBe(false);
  });
});

describe("sendAlertDm", () => {
  const env = { ...process.env };
  beforeEach(() => {
    process.env.DISCORD_ENABLED = "true";
    process.env.DISCORD_BOT_TOKEN = "test-token";
  });
  afterEach(() => {
    process.env = { ...env };
    vi.unstubAllGlobals();
  });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

  it("av utan spak eller token — ingen förfrågan", async () => {
    process.env.DISCORD_ENABLED = "false";
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendAlertDm("u-off", CONTENT)).toBe("off");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("öppnar DM-kanalen en gång och återanvänder den", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(json(200, { id: "dm-1" }))
      .mockResolvedValueOnce(json(200, { id: "m1" }))
      .mockResolvedValueOnce(json(200, { id: "m2" }));
    vi.stubGlobal("fetch", fetchMock);
    expect(await sendAlertDm("u-reuse", CONTENT)).toBe("sent");
    expect(await sendAlertDm("u-reuse", CONTENT)).toBe("sent");
    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(String(fetchMock.mock.calls[0][0])).toContain("/users/@me/channels");
    expect(String(fetchMock.mock.calls[2][0])).toContain("/channels/dm-1/messages");
  });

  it("stängda DM (403) ⇒ 'closed', aldrig ett kast", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValueOnce(json(200, { id: "dm-2" }))
        .mockResolvedValueOnce(json(403, { code: 50007, message: "Cannot send messages to this user" }))
    );
    expect(await sendAlertDm("u-closed", CONTENT)).toBe("closed");
  });

  it("nätfel ⇒ 'failed', aldrig ett kast", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));
    await expect(sendAlertDm("u-net", CONTENT)).resolves.toBe("failed");
  });
});

describe("notificationSettings.discord", () => {
  it("är OPT-IN: saknad nyckel ⇒ av", () => {
    expect(parseNotificationSettings({}).discord).toBe(false);
    expect(parseNotificationSettings(null).discord).toBe(false);
    expect(parseNotificationSettings({ discord: true }).discord).toBe(true);
    expect(parseNotificationSettings({ discord: "ja" }).discord).toBe(false);
  });
});
