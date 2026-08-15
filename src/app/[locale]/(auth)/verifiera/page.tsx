"use client";

import { Suspense, useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { EmailTypoHint, useEmailTypoHint } from "@/components/features/email-typo-hint";

type Status = "loading" | "success" | "error";

function VerifyContent() {
  const t = useTranslations("Auth");
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<Status>(token ? "loading" : "error");
  const [message, setMessage] = useState<string>(
    token ? t("verify.loading") : t("verify.missing")
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;
        if (cancelled) return;
        if (res.ok) {
          setStatus("success");
          setMessage(data?.message ?? t("verify.fallbackSuccess"));
        } else {
          setStatus("error");
          setMessage(data?.error ?? t("verify.errorRetry"));
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage(t("genericError"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="text-center">
      <h1 className="font-display text-2xl font-bold text-ink">{t("verify.title")}</h1>

      {status === "loading" && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-sm text-ink-muted">{message}</p>
        </div>
      )}

      {status === "success" && (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg border border-rise/30 bg-rise/10 px-4 py-3 text-sm text-rise">
            {message}
          </p>
          <p className="text-sm text-ink-muted">
            {t("verify.successOpenApp")}
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg border border-fall/30 bg-fall/10 px-4 py-3 text-sm text-fall">
            {message}
          </p>
          <p className="text-sm text-ink-muted">
            {t("verify.errorOpenApp")}
          </p>
          {/* En död länk är exakt det läge där man behöver en ny — och den som
              klickar i mejlet är sällan inloggad, så app-påminnelsen når hen inte. */}
          <ResendForm />
        </div>
      )}
    </div>
  );
}

/**
 * Begär en ny bekräftelselänk. Svaret är AVSIKTLIGT likadant oavsett om adressen
 * finns — endpointen får inte gå att använda för att kartlägga konton, och då får
 * den här vyn inte heller avslöja mer än den vet.
 */
function ResendForm() {
  const t = useTranslations("Auth");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);
  // Svaret är detsamma oavsett om adressen finns (kartläggningsskydd), så en
  // felstavning ser ut som en lyckad utskick. Förslaget är enda varningen.
  const emailTypo = useEmailTypoHint(setEmail);

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setSending(true);
    try {
      await fetch("/api/auth/resend-verification", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
    } catch {
      // Samma besked ändå — se doc-kommentaren ovan.
    }
    setDone(true);
    setSending(false);
  }

  if (done) {
    return (
      <p className="rounded-lg border border-holo-cyan/30 bg-holo-cyan/10 px-4 py-3 text-sm text-ink">
        {t("verify.resendDone")}
      </p>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      <div>
        <Label htmlFor="resend-email">{t("emailLabel")}</Label>
        <Input
          id="resend-email"
          type="email"
          autoComplete="email"
          required
          placeholder={t("emailPlaceholder")}
          value={email}
          {...emailTypo.fieldProps}
        />
        <EmailTypoHint suggestion={emailTypo.suggestion} onAccept={emailTypo.accept} />
      </div>
      <Button type="submit" loading={sending} variant="secondary" className="w-full">
        {t("verify.resendSubmit")}
      </Button>
      <p className="text-center text-xs text-ink-muted">{t("verify.resendHint")}</p>
    </form>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyContent />
    </Suspense>
  );
}
