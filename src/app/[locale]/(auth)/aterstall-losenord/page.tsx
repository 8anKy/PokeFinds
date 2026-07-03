"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Button, LinkButton } from "@/components/ui/button";
import { PasswordInput, Label, FieldError } from "@/components/ui/input";

function ResetPasswordForm() {
  const t = useTranslations("Auth");
  const searchParams = useSearchParams();
  const token = searchParams.get("token") ?? "";

  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError(t("reset.errPassword"));
      return;
    }
    if (confirm !== password) {
      setError(t("reset.errConfirm"));
      return;
    }
    setLoading(true);
    try {
      const res = await fetch("/api/auth/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password }),
      });
      const data = (await res.json().catch(() => null)) as
        | { message?: string; error?: string }
        | null;
      if (!res.ok) {
        setError(data?.error ?? t("genericError"));
        setLoading(false);
        return;
      }
      setSuccess(data?.message ?? t("reset.fallbackSuccess"));
    } catch {
      setError(t("genericError"));
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("reset.invalidTitle")}</h1>
        <p className="mt-2 text-sm text-ink-muted">
          {t("reset.invalidBody")}
        </p>
        <LinkButton href="/glomt-losenord" className="mt-6 w-full" size="lg">
          {t("reset.requestNew")}
        </LinkButton>
      </div>
    );
  }

  if (success) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">{t("reset.successTitle")}</h1>
        <p className="mt-2 rounded-lg border border-rise/30 bg-rise/10 px-4 py-3 text-sm text-rise">
          {success}
        </p>
        <p className="mt-4 text-sm text-ink-muted">
          {t("reset.successOpenApp")}
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">{t("reset.title")}</h1>
      <p className="mt-1 text-sm text-ink-muted">
        {t("reset.subtitle")}
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <Label htmlFor="password">{t("reset.newPasswordLabel")}</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder={t("register.passwordPlaceholder")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="confirm">{t("reset.confirmNewLabel")}</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            placeholder={t("register.confirmPlaceholder")}
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <FieldError message={error} />

        <Button type="submit" loading={loading} className="w-full" size="lg">
          {t("reset.submit")}
        </Button>
      </form>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense>
      <ResetPasswordForm />
    </Suspense>
  );
}
