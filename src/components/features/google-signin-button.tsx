"use client";

import { useEffect, useState } from "react";
import { signIn } from "next-auth/react";
import { Capacitor } from "@capacitor/core";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { setAuthHint } from "@/lib/auth-hint";

/**
 * "Fortsätt med Google" (#12). Två vägar till samma session:
 *
 * WEBB: NextAuths redirect-OAuth (signIn("google") → Google → callback). Renderas
 * bara när providern faktiskt är konfigurerad — kollas via /api/auth/providers så
 * ingen env behöver dupliceras till klienten.
 *
 * APP (Capacitor): Google BLOCKERAR redirect-OAuth i inbäddade webviews
 * ("disallowed_useragent") → @capgo/capacitor-social-login kör Googles NATIVA
 * dialog och ger en id-token, som växlas till en session via "google-idtoken"-
 * providern (kryptografiskt verifierad server-sida). Kräver
 * NEXT_PUBLIC_GOOGLE_CLIENT_ID vid bygge + att appen byggts med pluginen
 * (npx cap sync android).
 *
 * Auth-hinten sätts optimistiskt (samma mönster som credentials-flödet) —
 * inaktuell hint vid avbrott är ofarlig och self-healing (se lib/auth-hint.ts).
 */
export function GoogleSignInButton({ callbackUrl }: { callbackUrl: string }) {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const isNative = Capacitor.isNativePlatform();

  useEffect(() => {
    if (isNative) {
      // I appen avgörs allt vid byggtid: utan client id (eller utan pluginen i
      // app-bygget, se catch i handleNative) finns ingen fungerande väg.
      setEnabled(Boolean(process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID));
      return;
    }
    fetch("/api/auth/providers")
      .then((r) => (r.ok ? r.json() : null))
      .then((providers: Record<string, unknown> | null) => {
        if (providers && "google" in providers) setEnabled(true);
      })
      .catch(() => {});
  }, [isNative]);

  if (!enabled) return null;

  async function handleNative() {
    setBusy(true);
    setError(false);
    try {
      const { SocialLogin } = await import("@capgo/capacitor-social-login");
      await SocialLogin.initialize({
        google: { webClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID },
      });
      const { result } = await SocialLogin.login({
        provider: "google",
        options: { scopes: ["email", "profile"] },
      });
      const idToken = result.responseType === "online" ? result.idToken : null;
      if (!idToken) throw new Error("ingen idToken från Google");
      const res = await signIn("google-idtoken", { idToken, redirect: false });
      if (res?.error) throw new Error(res.error);
      setAuthHint(true);
      router.push(callbackUrl);
      router.refresh();
    } catch (e) {
      // Avbrutet val i Google-dialogen hamnar också här — visa lugnt fel, ingen spam.
      console.warn("[google-login]", e instanceof Error ? e.message : e);
      setError(true);
      setBusy(false);
    }
  }

  function handleClick() {
    if (isNative) {
      void handleNative();
      return;
    }
    setAuthHint(true);
    void signIn("google", { callbackUrl });
  }

  return (
    <div className="mt-5">
      <div className="flex items-center gap-3" aria-hidden>
        <div className="h-px flex-1 bg-surface-border" />
        <span className="text-xs uppercase tracking-wide text-ink-faint">{t("orDivider")}</span>
        <div className="h-px flex-1 bg-surface-border" />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={handleClick}
        className="mt-5 inline-flex w-full items-center justify-center gap-3 rounded-lg border border-surface-border bg-surface-raised px-4 py-2.5 text-sm font-semibold text-ink transition-colors hover:border-holo-cyan/40 hover:bg-surface-overlay disabled:opacity-60"
      >
        <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
          <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
        </svg>
        {busy ? t("googleBusy") : t("continueWithGoogle")}
      </button>
      {error && (
        <p className="mt-2 text-center text-xs text-fall" role="alert">
          {t("genericError")}
        </p>
      )}
    </div>
  );
}
