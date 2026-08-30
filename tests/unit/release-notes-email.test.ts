/**
 * Nyhetsmejlet är produktnyheter, inte drift: avanmälan måste finnas i BÅDA
 * formaten, typen `news` måste gå hela vägen (token → verifiering → rätt spak),
 * och en användare som aldrig rört reglaget ska räknas som PÅ — annars når
 * utskicket ingen.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { releaseNotesEmail } from "@/emails/templates";
import { APP_STORE_URL } from "@/lib/social-links";
import { NOTIFICATION_DEFAULTS, parseNotificationSettings } from "@/lib/notification-settings";
import { createUnsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken } from "@/lib/unsubscribe-token";

describe("releaseNotesEmail", () => {
  const unsub = "https://foilio.se/api/unsubscribe?token=news.abc.sig";
  const mail = releaseNotesEmail({ name: "Milos", unsubscribeUrl: unsub });

  it("bär avanmälan i både html och text, och App Store-knappen", () => {
    expect(mail.html).toContain(unsub);
    expect(mail.text).toContain(unsub);
    expect(mail.html).toContain(APP_STORE_URL);
    expect(mail.text).toContain(APP_STORE_URL);
    expect(mail.subject.length).toBeGreaterThan(10);
  });

  it("hälsar med förnamnet", () => {
    expect(mail.html).toContain("Hej Milos!");
    expect(mail.text.startsWith("Hej Milos!")).toBe(true);
  });
});

describe("news-spaken", () => {
  it("saknad nyckel läses som PÅ (speglar coalesce(..., true) i utskicket)", () => {
    expect(NOTIFICATION_DEFAULTS.news).toBe(true);
    expect(parseNotificationSettings({}).news).toBe(true);
    expect(parseNotificationSettings({ email: true, weekly: false }).news).toBe(true);
    expect(parseNotificationSettings({ news: false }).news).toBe(false);
  });
});

describe("unsubscribe-token: typen news", () => {
  beforeAll(() => {
    process.env.UNSUBSCRIBE_SECRET = "test-secret-for-news";
  });

  it("signeras och verifieras som `news`, inte `weekly`", () => {
    const token = createUnsubscribeToken("user_1", "news");
    expect(token.startsWith("news.user_1.")).toBe(true);
    expect(verifyUnsubscribeToken(token)).toEqual({ userId: "user_1", type: "news" });
    // Byte av typ i en signerad token ogiltigförklarar den — ingen kan avregistrera
    // veckobrevet med en nyhetslänk.
    expect(verifyUnsubscribeToken(token.replace(/^news\./, "weekly."))).toBeNull();
  });

  it("bygger URL:en mot apex", () => {
    expect(unsubscribeUrl("https://foilio.se", "user_1", "news")).toMatch(
      /^https:\/\/foilio\.se\/api\/unsubscribe\?token=news\.user_1\./
    );
  });
});
