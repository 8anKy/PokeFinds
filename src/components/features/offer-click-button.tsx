"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

export interface OfferClickButtonProps {
  slug: string;
  offerId: string;
  fallbackUrl: string;
  label?: string;
}

/** Registrerar klicket via API och öppnar butikens sida i ny flik. */
export function OfferClickButton({ slug, offerId, fallbackUrl, label }: OfferClickButtonProps) {
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  async function handleClick() {
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${slug}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId }),
      });
      const data: { url?: string } = await res.json().catch(() => ({}));
      window.open(data.url ?? fallbackUrl, "_blank", "noopener,noreferrer");
    } catch {
      toast({ title: "Kunde inte öppna butiken", variant: "error" });
      window.open(fallbackUrl, "_blank", "noopener,noreferrer");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button variant="outline" size="sm" loading={loading} onClick={handleClick}>
      {label ?? "Till butik →"}
    </Button>
  );
}
