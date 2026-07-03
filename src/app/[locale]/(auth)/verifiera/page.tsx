"use client";

import { Suspense, useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useSearchParams } from "next/navigation";
import { Spinner } from "@/components/ui/spinner";

type Status = "loading" | "success" | "error";

function VerifyContent() {
  const t = useTranslations("Auth");
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [status, setStatus] = useState<Status>(token ? "loading" : "error");
  const [message, setMessage] = useState<string>(
    token ? t("verify.loading") : t("verify.missing")
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
          setMessage(data?.message ?? t("verify.fallbackSuccess"));
        } else {
          setStatus("error");
          setMessage(data?.error ?? t("verify.errorRetry"));
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage(t("genericError"));
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  return (
    <div className="text-center">
      <h1 className="font-display text-2xl font-bold text-ink">{t("verify.title")}</h1>

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
          <p className="text-sm text-ink-muted">
            {t("verify.successOpenApp")}
          </p>
        </div>
      )}

      {status === "error" && (
        <div className="mt-6 space-y-4">
          <p className="rounded-lg border border-fall/30 bg-fall/10 px-4 py-3 text-sm text-fall">
            {message}
          </p>
          <p className="text-sm text-ink-muted">
            {t("verify.errorOpenApp")}
          </p>
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
