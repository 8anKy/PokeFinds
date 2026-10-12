"use client";

import { getCsrfToken, getSession } from "next-auth/react";
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

/**
 * LÄS OM PLAN/ROLL/ONBOARDING UR DB IN I SESSIONSTOKEN — NU, inte om 30 minuter.
 *
 * ⛔ `useSession().update()` GÖR INGENTING HOS OSS. `SessionProvider` monteras med
 * `session={null}` (providers.tsx — annars hämtar den /api/auth/session på varje
 * sida), och NextAuth v4:s `update()` börjar med `if (loading || !session) return`.
 * Sessionen i providern är alltid null ⇒ inget POST, inget fel, ingenting. MÄTT
 * 2026-10-12 (Railways http-logg): en kund köpte Pro i iOS-appen 01:39:30, `/api/users/me`
 * sa Pro direkt, men inget `POST /api/auth/session` gick ut — graderade priser,
 * bulk-skanning m.m. var låsta tills token:ens 30-minuters-TTL löpte ut 01:59:40, och
 * kunden fick logga ut och in. Samma POST som `update()` hade gjort, fast utan
 * providerns tillstånd: servern kör jwt-callbacken med `trigger: "update"`
 * (auth.ts) och skriver en ny cookie.
 *
 * Fel här får aldrig fälla anroparen — DB:n är redan rätt, token:en läker via TTL:n.
 */
export async function refreshSessionToken(): Promise<void> {
  try {
    const csrfToken = await getCsrfToken();
    if (!csrfToken) return;
    await fetch("/api/auth/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ csrfToken, data: {} }),
    });
  } catch {
    // Nätverksfel: TTL:n (30 min) tar det.
  } finally {
    invalidateSharedSession();
  }
}

/**
 * Självläkning utan nya anrop: där appen ÄNDÅ läser planen färskt ur DB
 * (`/api/users/me`) jämförs svaret med sessionen, och skiljer de sig läses token:en
 * om. Täcker det köpflödet inte ser: Pro köpt på en annan enhet/webben, en
 * återställning, admin-ändrad plan, eller ett Pro som löpt ut.
 */
export async function reconcileSessionPlan(dbIsPro: boolean | undefined | null): Promise<void> {
  if (typeof dbIsPro !== "boolean") return;
  const s = await getSharedSession();
  if (!s?.user) return;
  if (!!s.user.isPro !== dbIsPro) await refreshSessionToken();
}
