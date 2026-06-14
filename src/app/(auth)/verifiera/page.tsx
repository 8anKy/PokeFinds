"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { LinkButton } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";

type Status = "loading" | "success" | "error";

function VerifyContent() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<Status>(token ? "loading" : "error");
  const [message, setMessage] = useState<string>(
    token ? "Verifierar din e-postadress…" : "Verifieringslänken saknas eller är ofullständig."
  );

  useEffect(() => {
    if (!token) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        const data = (await res.json().catch(() => null)) as
          | { message?: string; error?: string }
          | null;
        if (cancelled) return;
        if (res.ok) {
          setStatus("success");
          setMessage(data?.message ?? "Din e-postadress är nu bekräftad.");
        } else {
          setStatus("error");
          setMessage(data?.error ?? "Verifieringen misslyckades. Försök igen.");
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Något gick fel. Försök igen.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  return (
    <div className="text-center">
      <h1 className="font-display text-2xl font-bold text-ink">Bekräfta e-postadress</h1>

      {status === "loading" && (
        <div className="mt-6 flex flex-col items-center gap-3">
          <Spinner />
          <p className="text-sm text-ink-muted">{message}</p>
        </div>
      )}

      {status === "success" && (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg border border-rise/30 bg-rise/10 px-4 py-3 text-sm text-rise">
            {message}
          </p>
          <LinkButton href="/logga-in" className="w-full" size="lg">
            Logga in
          </LinkButton>
        </div>
      )}

      {status === "error" && (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg border border-fall/30 bg-fall/10 px-4 py-3 text-sm text-fall">
            {message}
          </p>
          <LinkButton href="/logga-in" variant="secondary" className="w-full" size="lg">
            Till inloggning
          </LinkButton>
        </div>
      )}
    </div>
  );
}

export default function VerifyPage() {
  return (
    <Suspense>
      <VerifyContent />
    </Suspense>
  );
}
