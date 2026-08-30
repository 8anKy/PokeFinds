/**
 * Två leverantörer, ett vägval per mejl. Det som INTE får hända: att ett bulk-mejl
 * går till båda (dubblett till mottagaren), att transaktionellt hamnar hos Brevo,
 * eller att avanmälningsheadrarna tappas på vägen till Brevo.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Call = { url: string; init: RequestInit };

function stubFetch(calls: Call[], body: unknown = { id: "re_1", messageId: "<b1@brevo>" }) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
    })
  );
}

async function mailer() {
  vi.resetModules();
  return import("@/lib/mailer");
}

describe("mailer-lanes", () => {
  const calls: Call[] = [];
  beforeEach(() => {
    calls.length = 0;
    process.env.RESEND_API_KEY = "re_test";
    process.env.BREVO_API_KEY = "xkeysib_test";
    delete process.env.EMAIL_MODE;
    stubFetch(calls);
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    delete process.env.BREVO_API_KEY;
    delete process.env.RESEND_API_KEY;
  });

  it("bulk → Brevo, EN begäran, med båda avanmälningsheadrarna", async () => {
    const { sendMail } = await mailer();
    const res = await sendMail({
      to: "a@b.se",
      subject: "Hej",
      html: "<p>x</p>",
      text: "x",
      unsubscribeUrl: "https://foilio.se/api/unsubscribe?token=news.u.s",
      lane: "bulk",
    });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.brevo.com/v3/smtp/email");
    expect((calls[0].init.headers as Record<string, string>)["api-key"]).toBe("xkeysib_test");
    const body = JSON.parse(String(calls[0].init.body));
    expect(body.to).toEqual([{ email: "a@b.se" }]);
    expect(body.sender.email).toMatch(/@foilio\.se$/);
    expect(body.headers["List-Unsubscribe"]).toBe("<https://foilio.se/api/unsubscribe?token=news.u.s>");
    expect(body.headers["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect(res.provider).toBe("brevo");
    expect(res.id).toBe("<b1@brevo>");
  });

  it("en nyckel med BOM/radbrytning (gh secret set via pipe) skickas städad", async () => {
    process.env.BREVO_API_KEY = "﻿xkeysib_test\n";
    const { sendMail } = await mailer();
    await sendMail({ to: "a@b.se", subject: "Hej", html: "<p>x</p>", text: "x", lane: "bulk" });
    expect((calls[0].init.headers as Record<string, string>)["api-key"]).toBe("xkeysib_test");
  });

  it("transaktionellt → Resend även när Brevo-nyckeln finns", async () => {
    const { sendMail } = await mailer();
    const res = await sendMail({ to: "a@b.se", subject: "Hej", html: "<p>x</p>", text: "x" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
    expect(res.provider).toBe("resend");
  });

  it("bulk utan Brevo-nyckel → Resend (samma mejl, ingen dubblett)", async () => {
    delete process.env.BREVO_API_KEY;
    const { sendMail, providerFor } = await mailer();
    expect(providerFor({ lane: "bulk" })).toBe("resend");
    await sendMail({ to: "a@b.se", subject: "Hej", html: "<p>x</p>", text: "x", lane: "bulk" });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe("https://api.resend.com/emails");
  });

  it("Brevo-fel döms som Resend-fel: 4xx permanent, 429/5xx övergående", async () => {
    const { sendMail, isPermanentMailError } = await mailer();
    const input = { to: "a@b.se", subject: "Hej", html: "<p>x</p>", text: "x", lane: "bulk" as const };
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    await expect(sendMail(input)).rejects.toSatisfy((e) => isPermanentMailError(e));
    vi.stubGlobal("fetch", vi.fn(async () => new Response("slow", { status: 429 })));
    await expect(sendMail(input)).rejects.toSatisfy((e) => !isPermanentMailError(e));
  });
});
