"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { signIn } from "next-auth/react";
import { setAuthHint } from "@/lib/auth-hint";
import { Button } from "@/components/ui/button";
import { Input, PasswordInput, Label, FieldError } from "@/components/ui/input";

interface FieldErrors {
  name?: string;
  email?: string;
  password?: string;
  confirm?: string;
}

export default function RegisterPage() {
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
    if (name.trim().length < 2) errors.name = "Namnet måste vara minst 2 tecken.";
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) errors.email = "Ogiltig e-postadress.";
    if (password.length < 8) errors.password = "Lösenordet måste vara minst 8 tecken.";
    if (confirm !== password) errors.confirm = "Lösenorden matchar inte.";
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
        setError(data?.error ?? "Något gick fel. Försök igen.");
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
      setError("Något gick fel. Försök igen.");
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Skapa konto</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Gratis att komma igång. Bevaka priser, restocks och din samling.
      </p>

      <form onSubmit={handleSubmit} className="mt-6 space-y-4" noValidate>
        <div>
          <Label htmlFor="name">Namn</Label>
          <Input
            id="name"
            type="text"
            autoComplete="name"
            required
            placeholder="Ditt namn"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <FieldError message={fieldErrors.name} />
        </div>
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
          <FieldError message={fieldErrors.email} />
        </div>
        <div>
          <Label htmlFor="password">Lösenord</Label>
          <PasswordInput
            id="password"
            autoComplete="new-password"
            required
            minLength={8}
            placeholder="Minst 8 tecken"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <FieldError message={fieldErrors.password} />
        </div>
        <div>
          <Label htmlFor="confirm">Bekräfta lösenord</Label>
          <PasswordInput
            id="confirm"
            autoComplete="new-password"
            required
            placeholder="Upprepa lösenordet"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          <FieldError message={fieldErrors.confirm} />
        </div>

        <FieldError message={error} />

        <Button type="submit" loading={loading} className="w-full" size="lg">
          Skapa konto
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Har du redan ett konto?{" "}
        <Link href="/logga-in" className="font-medium text-holo-cyan hover:underline">
          Logga in
        </Link>
      </p>
    </div>
  );
}
