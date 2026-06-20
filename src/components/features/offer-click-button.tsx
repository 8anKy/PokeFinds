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
    // Öppna fliken SYNKRONT i klick-gesten — mobila webbläsare blockerar
    // window.open som sker efter en await. Vi navigerar den när URL:en lösts.
    const win = window.open("about:blank", "_blank");
    if (win) win.opener = null;
    setLoading(true);
    try {
      const res = await fetch(`/api/products/${slug}/click`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ offerId }),
      });
      const data: { url?: string } = await res.json().catch(() => ({}));
      const url = data.url ?? fallbackUrl;
      if (win) win.location.href = url;
      else window.location.href = url; // popup blockerad → samma flik
    } catch {
      toast({ title: "Kunde inte öppna butiken", variant: "error" });
      if (win) win.location.href = fallbackUrl;
      else window.location.href = fallbackUrl;
    } finally {
      setLoading(false);
    }
  }

  return (
    <Button
      variant="outline"
      size="sm"
      loading={loading}
      onClick={handleClick}
      className="whitespace-nowrap"
    >
      {label ?? "Till butik →"}
    </Button>
  );
}
