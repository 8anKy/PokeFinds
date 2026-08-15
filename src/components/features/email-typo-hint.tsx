"use client";

import { useState, type ChangeEvent, type FocusEvent } from "react";
import { useTranslations } from "next-intl";
import { suggestEmailCorrection } from "@/lib/email-typo";

/**
 * "Menade du …@gmail.com?" — en KNAPP under e-postfältet, aldrig ett fel.
 *
 * EN implementation för alla fyra ställen där appen tar emot en e-postadress
 * (registrering, inloggning, glömt lösenord, begär ny bekräftelselänk). Fyra
 * kopior av samma femton rader hade drivit isär: den som lägger till en domän
 * eller ändrar tonen i texten skulle rätta ett ställe och missa tre.
 *
 * ⛔ FÖRSLAGET BLOCKERAR ALDRIG. Det är en gissning om en domän vi inte känner
 * igen, och en riktig adress på en ovanlig domän måste alltid gå att skicka in.
 * Registreringen bromsar EN gång (se `handleSendCode`) eftersom ett utskick till
 * fel adress är svårt att ta tillbaka; övriga sidor bromsar inte alls.
 */

/** Tillstånd + fält-props. Suggestion ligger hos anroparen så registreringen
 *  kan läsa den vid submit; övriga sidor bryr sig bara om `fieldProps`. */
export function useEmailTypoHint(setEmail: (value: string) => void) {
  const [suggestion, setSuggestion] = useState<string | null>(null);
  return {
    suggestion,
    setSuggestion,
    /** Sprids på <Input>. Beräknar vid blur, rensar vid varje ändring — annars
     *  hänger förslaget kvar och pekar på en adress användaren redan lämnat. */
    fieldProps: {
      onChange: (e: ChangeEvent<HTMLInputElement>) => {
        setEmail(e.target.value);
        setSuggestion(null);
      },
      onBlur: (e: FocusEvent<HTMLInputElement>) =>
        setSuggestion(suggestEmailCorrection(e.target.value)),
    },
    accept: () => {
      if (!suggestion) return;
      setEmail(suggestion);
      setSuggestion(null);
    },
  };
}

export interface EmailTypoHintProps {
  suggestion: string | null;
  onAccept: () => void;
}

export function EmailTypoHint({ suggestion, onAccept }: EmailTypoHintProps) {
  const t = useTranslations("Auth");
  if (!suggestion) return null;
  return (
    <button
      type="button"
      className="mt-1.5 text-left text-sm text-holo-cyan hover:underline"
      onClick={onAccept}
    >
      {t("didYouMean", { email: suggestion })}
    </button>
  );
}
