"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { signIn } from "next-auth/react";
import { setAuthHint } from "@/lib/auth-hint";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput, Label, FieldError } from "@/components/ui/input";
import { suggestEmailCorrection } from "@/lib/email-typo";

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
  code?: string;
}

/** Klient-sidans "skicka igen"-paus. Ingen säkerhetsspärr (servern har sina
 *  egna) — bara en ärlig indikation på att mejl tar några sekunder att landa. */
const RESEND_COOLDOWN_S = 60;

export default function RegisterPage() {
  const t = useTranslations("Auth");
  const router = useRouter();
  // Registreringen sker i två steg: uppgifterna fylls i, en 6-siffrig kod
  // mejlas ("Skicka kod"), och kontot skapas först när koden anges — beviset
  // på att adressen är användarens egen.
  const [step, setStep] = useState<"details" | "code">("details");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [code, setCode] = useState("");
  // Förslag på rättad domän ("Menade du …@gmail.com?"). En feltypad adress är
  // annars en återvändsgränd: koden mejlas till ingenstans, och vi har varken
  // ett konto att laga eller en adress att nå personen på.
  const [emailSuggestion, setEmailSuggestion] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  // Inbjudningskod (#10) ur ?invite= — läses från location (ej useSearchParams:
  // slipper Suspense-kravet). Skickas med registreringen och visas som notis.
  const [invite, setInvite] = useState<string | null>(null);
  useEffect(() => {
    const code = new URLSearchParams(window.location.search).get("invite");
    if (code) setInvite(code);
  }, []);

  useEffect(() => {
    if (resendIn <= 0) return;
    const id = setInterval(() => setResendIn((s) => s - 1), 1000);
    return () => clearInterval(id);
  }, [resendIn]);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (name.trim().length < 2) errors.name = t("register.errName");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = t("register.errEmail");
    if (password.length < 8) errors.password = t("register.errPassword");
    if (confirm !== password) errors.confirm = t("register.errConfirm");
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function sendCode(): Promise<boolean> {
    const res = await fetch("/api/auth/register/send-code", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), name: name.trim() }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as
        | { error?: string; field?: string }
        | null;
      // Upptaget namn/adress fångas redan HÄR (före något mejl skickas) och
      // fästs vid sitt fält. Kommer felet under kodsteget (namnet hann tas av
      // någon annan) skickas användaren tillbaka så fältet syns.
      if (data?.error && (data.field === "name" || data.field === "email")) {
        setFieldErrors({ [data.field]: data.error });
        setStep("details");
      } else {
        setError(data?.error ?? t("genericError"));
      }
      return false;
    }
    setResendIn(RESEND_COOLDOWN_S);
    return true;
  }

  async function handleSendCode(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    // ⛔ Förslaget stoppar aldrig mer än EN gång. Visas det redan har användaren
    // sett det och valt sin adress ändå — den kan mycket väl vara riktig, och
    // då ska den gå att skicka in. Bumpen finns för dem som trycker Enter i
    // fältet, där blur aldrig hinner visa förslaget.
    const suggestion = suggestEmailCorrection(email);
    if (suggestion && suggestion !== emailSuggestion) {
      setEmailSuggestion(suggestion);
      return;
    }
    setLoading(true);
    try {
      if (await sendCode()) {
        setCode("");
        setStep("code");
      }
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  async function handleResend() {
    setError(null);
    setLoading(true);
    try {
      await sendCode();
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  async function handleRegister(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!/^\d{6}$/.test(code)) {
      setFieldErrors({ code: t("register.errCode") });
      return;
    }
    setFieldErrors({});
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
          password,
          code,
          ...(invite ? { invite } : {}),
        }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as
          | { error?: string; field?: string }
          | null;
        // Namnet/adressen hann tas mellan kodutskicket och submit (send-code
        // fångar annars detta redan i steg 1) → tillbaka till fältet. Koden
        // förbrukas inte av det, så den gäller fortfarande efter rättelsen.
        if (data?.error && (data.field === "name" || data.field === "email")) {
          setFieldErrors({ [data.field]: data.error });
          setStep("details");
        } else {
          setError(data?.error ?? t("genericError"));
        }
        setLoading(false);
        return;
      }
      // Logga in automatiskt och gå till onboarding
      const result = await signIn("credentials", {
        email: email.trim(),
        password,
        redirect: false,
      });
      if (result?.error) {
        router.push("/logga-in");
        return;
      }
      setAuthHint(true);
      router.push("/onboarding");
      router.refresh();
    } catch {
      setError(t("genericError"));
      setLoading(false);
    }
  }

  if (step === "code") {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("register.codeTitle")}</h1>
        <p className="mt-1 text-sm text-ink-muted">{t("register.codeSentTo")}</p>
        {/* Adressen står på egen rad, i full kontrast, med utgången BREDVID sig.
            Den låg tidigare inbakad i meningen ovan medan "Ändra uppgifter" satt
            nedtonad i sidfoten — den som mejlat koden till en feltypad adress
            läste alltså rätt svar men såg aldrig vägen tillbaka. */}
        <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-sm">
          <span className="break-all font-medium text-ink">{email.trim()}</span>
          <button
            type="button"
            className="font-medium text-holo-cyan hover:underline"
            onClick={() => {
              setError(null);
              setFieldErrors({});
              setEmailSuggestion(null);
              setStep("details");
            }}
          >
            {t("register.codeWrongEmail")}
          </button>
        </p>

        <form onSubmit={handleRegister} className="mt-6 space-y-4" noValidate>
          <div>
            <Label htmlFor="code">{t("register.codeLabel")}</Label>
            <Input
              id="code"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              maxLength={6}
              placeholder="123456"
              className="text-center text-lg tracking-[0.5em]"
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
              autoFocus
            />
            <FieldError message={fieldErrors.code} />
          </div>

          <FieldError message={error} />

          <Button type="submit" loading={loading} className="w-full" size="lg">
            {t("register.submit")}
          </Button>
        </form>

        <div className="mt-6 flex items-center justify-center text-sm">
          <button
            type="button"
            disabled={resendIn > 0 || loading}
            className="font-medium text-holo-cyan hover:underline disabled:cursor-default disabled:text-ink-muted disabled:no-underline"
            onClick={handleResend}
          >
            {resendIn > 0
              ? t("register.resendWait", { seconds: resendIn })
              : t("register.resend")}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">{t("register.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("register.subtitle")}
      </p>
      {invite && (
        <p className="mt-3 rounded-lg border border-holo-cyan/30 bg-holo-cyan/10 px-3 py-2 text-sm text-ink">
          {t("register.inviteNote")}
        </p>
      )}

      <form onSubmit={handleSendCode} className="mt-6 space-y-4" noValidate>
        <div>
          <Label htmlFor="name">{t("register.nameLabel")}</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            required
            placeholder={t("register.namePlaceholder")}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <FieldError message={fieldErrors.name} />
        </div>
        <div>
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder={t("emailPlaceholder")}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              setEmailSuggestion(null);
            }}
            onBlur={(e) => setEmailSuggestion(suggestEmailCorrection(e.target.value))}
          />
          <FieldError message={fieldErrors.email} />
          {emailSuggestion && (
            <button
              type="button"
              className="mt-1.5 text-left text-sm text-holo-cyan hover:underline"
              onClick={() => {
                setEmail(emailSuggestion);
                setEmailSuggestion(null);
                setFieldErrors((prev) => ({ ...prev, email: undefined }));
              }}
            >
              {t("register.didYouMean", { email: emailSuggestion })}
            </button>
          )}
        </div>
        <div>
          <Label htmlFor="password">{t("passwordLabel")}</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder={t("register.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldError message={fieldErrors.password} />
        </div>
        <div>
          <Label htmlFor="confirm">{t("register.confirmLabel")}</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            placeholder={t("register.confirmPlaceholder")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <FieldError message={fieldErrors.confirm} />
        </div>

        <FieldError message={error} />

        <Button type="submit" loading={loading} className="w-full" size="lg">
          {t("register.sendCode")}
        </Button>
        <p className="text-center text-xs text-ink-muted">{t("register.sendCodeHint")}</p>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        {t("register.haveAccount")}{" "}
        <Link href="/logga-in" className="font-medium text-holo-cyan hover:underline">
          {t("register.login")}
        </Link>
      </p>
    </div>
  );
}
