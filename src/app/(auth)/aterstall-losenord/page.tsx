"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useSearchParams } from "next/navigation";
import { Button, LinkButton } from "@/components/ui/button";
import { PasswordInput, Label, FieldError } from "@/components/ui/input";

function ResetPasswordForm() {
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
      setError("Lösenordet måste vara minst 8 tecken.");
      return;
    }
    if (confirm !== password) {
      setError("Lösenorden matchar inte.");
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
        setError(data?.error ?? "Något gick fel. Försök igen.");
        setLoading(false);
        return;
      }
      setSuccess(data?.message ?? "Ditt lösenord har uppdaterats.");
    } catch {
      setError("Något gick fel. Försök igen.");
      setLoading(false);
    }
  }

  if (!token) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Ogiltig länk</h1>
        <p className="mt-2 text-sm text-ink-muted">
          Återställningslänken saknas eller är ofullständig. Begär en ny länk nedan.
        </p>
        <LinkButton href="/glomt-losenord" className="mt-6 w-full" size="lg">
          Begär ny länk
        </LinkButton>
      </div>
    );
  }

  if (success) {
    return (
      <div>
        <h1 className="font-display text-2xl font-bold text-ink">Lösenordet är uppdaterat</h1>
        <p className="mt-2 rounded-lg border border-rise/30 bg-rise/10 px-4 py-3 text-sm text-rise">
          {success}
        </p>
        <p className="mt-4 text-sm text-ink-muted">
          Klart! Öppna Foilio-appen och logga in med ditt nya lösenord.
        </p>
      </div>
    );
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Välj nytt lösenord</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Ange ditt nya lösenord nedan. Minst 8 tecken.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <Label htmlFor="password">Nytt lösenord</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="Minst 8 tecken"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <Label htmlFor="confirm">Bekräfta nytt lösenord</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            placeholder="Upprepa lösenordet"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </div>

        <FieldError message={error} />

        <Button type="submit" loading={loading} className="w-full" size="lg">
          Uppdatera lösenord
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
