"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useSearchParams } from "next/navigation";
import { useRouter } from "@/i18n/navigation";
import { signIn } from "next-auth/react";
import { setAuthHint } from "@/lib/auth-hint";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput, Label, FieldError } from "@/components/ui/input";
import { EmailTypoHint, useEmailTypoHint } from "@/components/features/email-typo-hint";
import { SocialLoginButtons } from "@/components/features/social-login-buttons";

function LoginForm() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/produkter";
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
      <h1 className="font-display text-2xl font-bold text-ink">{t("login.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("login.subtitle")}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <Label htmlFor="email">{t("emailLabel")}</Label>
          <Input
            id="email"
            type="email"
            autoComplete="email"
            required
            placeholder={t("emailPlaceholder")}
            value={email}
            {...emailTypo.fieldProps}
          />
          <EmailTypoHint suggestion={emailTypo.suggestion} onAccept={emailTypo.accept} />
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">{t("passwordLabel")}</Label>
            <Link
              href="/glomt-losenord"
              className="mb-1.5 text-xs text-holo-cyan hover:underline"
            >
              {t("login.forgot")}
            </Link>
          </div>
          <PasswordInput
            id="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <FieldError message={error} />

        <Button type="submit" loading={loading} className="w-full" size="lg">
          {t("login.submit")}
        </Button>
      </form>

      <SocialLoginButtons next={callbackUrl} />

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
