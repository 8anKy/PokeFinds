"use client";

import { getSession } from "next-auth/react";
import type { Session } from "next-auth";
import { onAuthHintChange } from "./auth-hint";

/**
 * EN sessionshämtning per sida, inte en per komponent.
 *
 * Varje klocka, prisknapp och admin-knapp läser planen klient-sida (sidorna är
 * ISR-cachade → ingen server-`auth()`), och alla gjorde det med ett EGET
 * `getSession()` vid montering. Ett rutnät med 48 produktkort fyrade därför 48
 * `/api/auth/session`-anrop på en gång — MÄTT 2026-09-01: 7 560 anrop/dygn, som
 * mest 153 på en minut, ~75 % av all trafik från appen. Anropet är DB-fritt (JWT
 * avkodas ur cookien; databasen rörs bara var 30:e minut när token är gammal),
 * så det brände Railway-CPU och batteri, inte Neon — men det var rent slöseri.
 *
 * Här delar alla anropare samma löfte: pågår en hämtning återanvänds den, och
 * svaret ligger kvar i TTL_MS så nästa sidvisning (mjuk navigering behåller
 * modulminnet) slipper fråga igen. Svaret är EXAKT det `getSession()` hade gett —
 * ingen komponent ser något annat än förut, den är bara inte längre ensam om
 * att fråga.
 *
 * ⛔ Cachen töms vid login/logout (`fo_auth`-hinten ändras) så en ny användare i
 * samma flik aldrig ärver den förras plan. Servern avgör ALLTID den riktiga
 * behörigheten — detta är UI-läsning, inte åtkomstkontroll.
 */
const TTL_MS = 60_000;

let inflight: Promise<Session | null> | null = null;
let cached: { session: Session | null; at: number } | null = null;
let subscribed = false;

/** Glöm det cachade svaret — nästa anrop frågar servern igen. */
export function invalidateSharedSession(): void {
  inflight = null;
  cached = null;
}

function subscribeOnce(): void {
  if (subscribed || typeof window === "undefined") return;
  subscribed = true;
  onAuthHintChange(invalidateSharedSession);
}

/** Samma resultat som `getSession()`, men delad mellan alla anropare på sidan. */
export function getSharedSession(): Promise<Session | null> {
  subscribeOnce();
  if (cached && Date.now() - cached.at < TTL_MS) return Promise.resolve(cached.session);
  if (inflight) return inflight;
  const p = getSession()
    .then((session) => {
      cached = { session, at: Date.now() };
      return session;
    })
    .finally(() => {
      if (inflight === p) inflight = null;
    });
  inflight = p;
  return p;
}
