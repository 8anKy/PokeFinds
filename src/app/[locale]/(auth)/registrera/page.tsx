"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { useRouter } from "@/i18n/navigation";
import { signIn } from "next-auth/react";
import { setAuthHint } from "@/lib/auth-hint";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput, Label, FieldError } from "@/components/ui/input";
import { GoogleSignInButton } from "@/components/features/google-signin-button";

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export default function RegisterPage() {
  const t = useTranslations("Auth");
  const router = useRouter();
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  function validate(): boolean {
    const errors: FieldErrors = {};
    if (name.trim().length < 2) errors.name = t("register.errName");
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = t("register.errEmail");
    if (password.length < 8) errors.password = t("register.errPassword");
    if (confirm !== password) errors.confirm = t("register.errConfirm");
    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  }

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (!validate()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim(), password }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        setError(data?.error ?? t("genericError"));
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

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">{t("register.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("register.subtitle")}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
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
            onChange={(e) => setEmail(e.target.value)}
          />
          <FieldError message={fieldErrors.email} />
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
          {t("register.submit")}
        </Button>
      </form>

      {/* Google-konton är färdigverifierade → hoppa direkt till onboarding. */}
      <GoogleSignInButton callbackUrl="/onboarding" />

      <p className="mt-6 text-center text-sm text-ink-muted">
        {t("register.haveAccount")}{" "}
        <Link href="/logga-in" className="font-medium text-holo-cyan hover:underline">
          {t("register.login")}
        </Link>
      </p>
    </div>
  );
}
