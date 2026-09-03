"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { apiFetch } from "@/lib/client-api";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";
import { IconMessage } from "@/components/ui/icons";

/**
 * "Skicka meddelande" på någon annans profil. Sidan (force-dynamic) avgör redan
 * att betraktaren är inloggad, inte ägaren och släppt genom community-grinden;
 * knappen gör bara själva öppningen: POST /api/chat/conversations skapar eller
 * återanvänder parets konversation och svarar med dess id.
 */
export function MessageButton({ userId }: { userId: string }) {
  const t = useTranslations("Profile");
  const router = useRouter();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  async function open() {
    setLoading(true);
    try {
      const res = await apiFetch<{ id: string }>("/api/chat/conversations", {
        method: "POST",
        body: { userId },
      });
      router.push(`/meddelanden/${res.id}`);
      // Ingen setLoading(false) på lyckat svar: sidan byts, och en knapp som
      // "vaknar" en bråkdel innan navigeringen läser som ett fel.
    } catch (e) {
      toast({
        title: t("messageFail"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
      setLoading(false);
    }
  }

  return (
    <Button variant="secondary" loading={loading} onClick={() => void open()} className="shrink-0">
      <IconMessage size={16} />
      {t("messageButton")}
    </Button>
  );
}
