"use client";
/**
 * Skjuter EN spårningshändelse när komponenten monteras — för sidor som är
 * serverrenderade (ISR) och därför inte kan spåra själva. `/priser` räknas som
 * en paywall-öppning med källan "priser" så tratten i admin → Engagemang ser
 * både arket och sidan. Opersonligt, databaslöst i requesten (/api/track köar).
 */
import { useEffect } from "react";
import { track, type TrackType } from "@/lib/track";

export function TrackOnMount({ type, slug }: { type: TrackType; slug: string }) {
  useEffect(() => {
    track(type, slug);
  }, [type, slug]);
  return null;
}
