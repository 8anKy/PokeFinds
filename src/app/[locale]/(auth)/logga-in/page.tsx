"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { loginHintKey } from "@/lib/login-hint";
import { useRouter } from "@/i18n/navigation";
import { signIn } from "next-auth/react";
import { setAuthHint } from "@/lib/auth-hint";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput, Label, FieldError } from "@/components/ui/input";
import { EmailTypoHint, useEmailTypoHint } from "@/components/features/email-typo-hint";
import { SocialLoginButtons } from "@/components/features/social-login-buttons";

/**
 * Inloggningen får plats på EN mobilskärm utan scroll (ägarbeslut 2026-08-29):
 * e-post + lösenord med platshållare som etikett (etiketterna finns kvar för
 * skärmläsare), knapp, "– eller logga in med –" + Apple/Google-ikoner, kontolänk.
 */
function LoginForm() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/produkter";
  const hintKey = loginHintKey(callbackUrl);
  const loginHint = hintKey ? t(`login.${hintKey}`) : null;
  // NextAuth landar här med ?error=… när ett Google-/Apple-flöde inte gick att
  // slutföra (pages.error i lib/auth.ts). AccessDenied = vår signIn-callback
  // nekade (obekräftad/saknad adress), allt annat = avbrutet/tekniskt fel.
  const oauthError = searchParams.get("error");

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(
    oauthError ? t(oauthError === "AccessDenied" ? "social.denied" : "social.error") : null
  );
  const [loading, setLoading] = useState(false);
  // En felstavad domän här ger "fel e-post eller lösenord", och den som är säker
  // på sitt lösenord letar då efter fel fel. Ingen broms vid submit — ett
  // misslyckat inloggningsförsök är omedelbart synligt och kostar ingenting.
  const emailTypo = useEmailTypoHint(setEmail);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const result = await signIn("credentials", {
        email,
        password,
        redirect: false,
      });
      if (result?.error) {
        setError(t("login.badCredentials"));
        setLoading(false);
        return;
      }
      setAuthHint(true);
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError(t("genericError"));
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="mb-5 font-display text-xl font-semibold text-ink">{t("login.title")}</h1>
      {/* Varför man hamnade här — gästen som tryckte på Portfölj/Bevakningar möttes
          av en naken inloggningsvägg utan värdeord (Android-QA 09-01 fynd 6). */}
      {loginHint && <p className="-mt-3 mb-5 text-sm text-ink-muted">{loginHint}</p>}

      <form onSubmit={handleSubmit} className="space-y-3" noValidate>
        <div>
          <Label htmlFor="email" className="sr-only">
            {t("emailLabel")}
          </Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder={t("emailLabel")}
            className="h-12"
            value={email}
            {...emailTypo.fieldProps}
          />
          <EmailTypoHint suggestion={emailTypo.suggestion} onAccept={emailTypo.accept} />
        </div>
        <div>
          <Label htmlFor="password" className="sr-only">
            {t("passwordLabel")}
          </Label>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            placeholder={t("passwordLabel")}
            className="h-12"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <div className="mt-1.5 text-right">
            <Link href="/glomt-losenord" className="text-xs text-holo-cyan hover:underline">
              {t("login.forgot")}
            </Link>
          </div>
        </div>

        <FieldError message={error} className="mt-0" />

        <Button type="submit" loading={loading} className="w-full" size="lg">
          {t("login.submit")}
        </Button>
      </form>

      <SocialLoginButtons next={callbackUrl} mode="login" />

      <p className="mt-6 text-center text-sm text-ink-muted">
        {t("login.noAccount")}{" "}
        <Link href="/registrera" className="font-medium text-holo-cyan hover:underline">
          {t("login.createAccount")}
        </Link>
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense>
      <LoginForm />
    </Suspense>
  );
}
