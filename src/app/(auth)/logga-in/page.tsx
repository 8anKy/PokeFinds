"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { signIn } from "next-auth/react";
import { Button } from "@/components/ui/button";
import { Input, Label, FieldError } from "@/components/ui/input";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/dashboard";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

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
        setError("Fel e-post eller lösenord.");
        setLoading(false);
        return;
      }
      router.push(callbackUrl);
      router.refresh();
    } catch {
      setError("Något gick fel. Försök igen.");
      setLoading(false);
    }
  }

  return (
    <div>
      <h1 className="font-display text-2xl font-bold text-ink">Logga in</h1>
      <p className="mt-1 text-sm text-ink-muted">
        Välkommen tillbaka! Logga in för att se dina bevakningar.
      </p>

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
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Lösenord</Label>
            <Link
              href="/glomt-losenord"
              className="mb-1.5 text-xs text-holo-cyan hover:underline"
            >
              Glömt lösenordet?
            </Link>
          </div>
          <Input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            placeholder="••••••••"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        <FieldError message={error} />

        <Button type="submit" loading={loading} className="w-full" size="lg">
          Logga in
        </Button>
      </form>

      <p className="mt-6 text-center text-sm text-ink-muted">
        Har du inget konto?{" "}
        <Link href="/registrera" className="font-medium text-holo-cyan hover:underline">
          Skapa konto
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
