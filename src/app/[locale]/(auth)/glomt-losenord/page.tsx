"use client";

import { useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

export default function ForgotPasswordPage() {
  const t = useTranslations("Auth");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const res = await fetch("/api/auth/forgot", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim() }),
      });
      const data = (await res.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;
      if (!res.ok) {
        setError(data?.error ?? t("genericError"));
        setLoading(false);
        return;
      }
      setSuccess(data?.message ?? t("forgot.fallbackSuccess"));
    } catch {
      setError(t("genericError"));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">{t("forgot.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("forgot.subtitle")}
      </p>

      {success ? (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg border border-rise/30 bg-rise/10 px-4 py-3 text-sm text-rise">
            {success}
          </p>
          <Link
            href="/logga-in"
            className="block text-center text-sm font-medium text-holo-cyan hover:underline"
          >
            {t("forgot.backToLogin")}
          </Link>
        </div>
      ) : (
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
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <FieldError message={error} />

          <Button type="submit" loading={loading} className="w-full" size="lg">
            {t("forgot.submit")}
          </Button>

          <p className="text-center text-sm text-ink-muted">
            <Link href="/logga-in" className="font-medium text-holo-cyan hover:underline">
              {t("forgot.backToLogin")}
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
