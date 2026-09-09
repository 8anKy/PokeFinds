/**
 * Dela-knappen på ett evenemang — samma cirkel som appens övriga åtgärder.
 *
 * ⛔ Samma fälla som inbjudningssidan (2026-08): `navigator.share` öppnar OS-arket
 *    och promiset HÄNGER tills användaren stänger det, vilket på desktop lämnade
 *    knappen i väntläge för evigt. Delningsarket bara på pekskärm; desktop kopierar.
 */
"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { CircleButton } from "@/components/ui/back-circle";
import { IconCheck, IconShare } from "@/components/ui/icons";

export function EventShare({ title }: { title: string }) {
  const t = useTranslations("News");
  const [copied, setCopied] = useState(false);

  async function share() {
    const url = window.location.href;
    const touch = window.matchMedia("(pointer: coarse)").matches;
    if (touch && navigator.share) {
      try {
        await navigator.share({ title, url });
        return;
      } catch {
        /* avbruten delning → kopiera i stället */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      /* utan urklippsrättighet finns inget vettigt att visa — adressfältet står kvar */
    }
  }

  return (
    <CircleButton label={t("share")} onClick={() => void share()}>
      {copied ? <IconCheck size={19} className="text-holo-cyan" /> : <IconShare size={19} />}
    </CircleButton>
  );
}
