"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { hasAuthHint } from "@/lib/auth-hint";

/**
 * Påminnelse för inloggade som inte bekräftat sin e-post — med en "Skicka igen"-
 * knapp mot /api/auth/resend-verification. Ingenting i appen visade förut
 * `emailVerifiedAt`, så en obekräftad användare visste varken om det eller hur
 * det lagades.
 *
 * ⛔ Sessionen läses KLIENT-sida (fo_auth-hinten + /api/users/me), aldrig med
 * server-`auth()`: ett auth()-anrop i delad chrome gör HELA appen dynamisk och
 * skjuter Neon-/Railway-notan i höjden (se "Caching/ISR" i CLAUDE.md). Samma
 * mönster som header-auth-actions.tsx.
 *
 * ⛔ Den är INGEN spärr. Verifiering krävs inte för att logga in eller använda
 * något — den här raden är hela vår "enforcement".
 *
 * Avfärdandet lagras i sessionStorage: borta resten av besöket, tillbaka nästa
 * gång. En permanent bortklickning hade gjort påminnelsen till engångsbrus.
 */
const DISMISS_KEY = "fo_verify_banner_dismissed";

type SendState = "idle" | "sending" | "sent" | "error";

interface Me {
  email?: unknown;
  emailVerifiedAt?: unknown;
}

export function VerifyEmailBanner() {
  const t = useTranslations("Auth");
  // Sätts BARA för en inloggad, obekräftad användare → ett värde, ett villkor.
  const [email, setEmail] = useState<string | null>(null);
  const [hidden, setHidden] = useState(false);
  const [state, setState] = useState<SendState>("idle");

  useEffect(() => {
    if (!hasAuthHint()) return;
    if (sessionStorage.getItem(DISMISS_KEY) === "1") return;

    let cancelled = false;
    fetch("/api/users/me", { credentials: "include" })
      .then((r) => (r.ok ? (r.json() as Promise<Me>) : null))
      .then((me) => {
        if (cancelled || !me || me.emailVerifiedAt) return;
        if (typeof me.email === "string") setEmail(me.email);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, []);

  if (hidden || !email) return null;

  async function resend() {
    setState("sending");
    try {
      const res = await fetch("/api/auth/resend-verification", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      setState(res.ok ? "sent" : "error");
    } catch {
      setState("error");
    }
  }

  function dismiss() {
    sessionStorage.setItem(DISMISS_KEY, "1");
    setHidden(true);
  }

  const message =
    state === "sent"
      ? t("verifyBanner.sent")
      : state === "error"
        ? t("verifyBanner.error")
        : t("verifyBanner.body");

  return (
    <div
      role="status"
      className="mb-3 rounded-xl border border-holo-cyan/30 bg-holo-cyan/10 px-3 py-2.5 sm:mb-4 sm:px-4 sm:py-3"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-ink">{t("verifyBanner.title")}</p>
          {/* ⛔ Adressen står på EGEN rad med `truncate`. Låg den inbakad i
              brödtexten radbröt en lång gmail-adress hela stycket till sex rader
              på telefon, och bannern sköt ner menyn under viken (2026-08-05).
              En e-postadress har ingen övre längd — den får aldrig sätta höjden. */}
          {state !== "sent" && (
            <p className="mt-0.5 truncate text-xs text-ink-muted" title={email}>
              {email}
            </p>
          )}
          <p className="mt-0.5 text-xs text-ink-muted">{message}</p>
        </div>

        <button
          type="button"
          onClick={dismiss}
          aria-label={t("verifyBanner.dismiss")}
          className="-mr-1 shrink-0 rounded-lg px-2 py-1 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          ✕
        </button>
      </div>

      {state !== "sent" && (
        // Egen rad, högerställd och auto-bred: inline bredvid texten klämde
        // ihop textkolumnen på smal skärm, vilket var halva höjdproblemet.
        <div className="mt-2 flex justify-end">
          <button
            type="button"
            onClick={resend}
            disabled={state === "sending"}
            className="rounded-lg border border-holo-cyan/40 px-3 py-1 text-xs font-semibold text-holo-cyan transition-colors hover:bg-holo-cyan/10 disabled:opacity-60 sm:text-sm"
          >
            {state === "sending" ? t("verifyBanner.sending") : t("verifyBanner.resend")}
          </button>
        </div>
      )}
    </div>
  );
}
