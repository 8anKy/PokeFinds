"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

export default function ForgotPasswordPage() {
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
        setError(data?.error ?? "Något gick fel. Försök igen.");
        setLoading(false);
        return;
      }
      setSuccess(data?.message ?? "Om kontot finns skickar vi en återställningslänk.");
    } catch {
      setError("Något gick fel. Försök igen.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Glömt lösenordet?</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Ingen fara. Ange din e-postadress så skickar vi en länk för att återställa det.
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
            Tillbaka till inloggning
          </Link>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
          <div>
            <Label htmlFor="email">E-postadress</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="din@epost.se"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <FieldError message={error} />

          <Button type="submit" loading={loading} className="w-full" size="lg">
            Skicka återställningslänk
          </Button>

          <p className="text-center text-sm text-ink-muted">
            <Link href="/logga-in" className="font-medium text-holo-cyan hover:underline">
              Tillbaka till inloggning
            </Link>
          </p>
        </form>
      )}
    </div>
  );
}
