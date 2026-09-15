"use client";

import { getSession, signIn } from "next-auth/react";
import { setAuthHint } from "@/lib/auth-hint";
import type { OAuthProvider } from "@/lib/oauth-id-token";
import type { AppleProviderResponse, GoogleLoginResponse } from "@capgo/capacitor-social-login";

/**
 * "Fortsätt med Google/Apple" — EN funktion, två vägar.
 *
 * WEBB: NextAuths vanliga OAuth-redirect (`signIn("google")`).
 * APP (Capacitor): Google blockerar sitt OAuth-webbflöde i inbäddade WebViews
 * (`disallowed_useragent`), så där körs leverantörens NATIVA SDK via
 * `@capgo/capacitor-social-login`, som ger ett id_token. Det skickas till
 * NextAuths `native-token`-provider (lib/auth.ts) som verifierar det mot
 * leverantörens JWKS och utfärdar samma session som webben.
 *
 * Apple på ANDROID har inget nativt SDK — pluginet kräver då en backend-
 * redirect. Vi tar i stället Apples webbflöde i WebView:en (Apple tillåter
 * WebViews, Google gör det inte); `appleid.apple.com` ligger därför i
 * `allowNavigation` i capacitor.config.ts.
 *
 * Klient-id:n är PUBLIKA (de står i appens binär ändå) och speglas från
 * server-variablerna i next.config.mjs — bakas in vid BYGGET.
 *
 * Efter inloggning går ALLA vägar via /api/auth/after-social, som skickar nya
 * konton till onboardingen och gamla till `next`. Beslutet tas på servern ur
 * sessionen — klienten vet inte om kontot just skapades.
 */

const GOOGLE_WEB_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || "";
const GOOGLE_IOS_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID?.trim() || "";
const APPLE_SERVICE_ID = process.env.NEXT_PUBLIC_APPLE_SERVICE_ID?.trim() || "";

export const socialProviderEnabled: Record<OAuthProvider, boolean> = {
  google: !!GOOGLE_WEB_CLIENT_ID,
  apple: !!APPLE_SERVICE_ID,
};

export function afterSocialUrl(next: string): string {
  return `/api/auth/after-social?next=${encodeURIComponent(next)}`;
}

async function platform(): Promise<"web" | "ios" | "android"> {
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return "web";
    return Capacitor.getPlatform() === "ios" ? "ios" : "android";
  } catch {
    return "web";
  }
}

let initialized = false;
async function nativePlugin(where: "ios" | "android") {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  if (!initialized) {
    await SocialLogin.initialize({
      google: {
        webClientId: GOOGLE_WEB_CLIENT_ID,
        iOSClientId: GOOGLE_IOS_CLIENT_ID || undefined,
        iOSServerClientId: GOOGLE_WEB_CLIENT_ID,
        mode: "online",
      },
      // clientId används inte på OS-nivå på iOS — bara för att aktivera providern.
      // ⛔ BARA PÅ iOS. På Android kräver pluginet `apple.android.redirectUrl`
      // (en backend-redirect vi inte har — Apple kör webbflödet i WebView:en där)
      // och kastar annars "apple.android.redirectUrl is null or empty" ur
      // initialize(), vilket tog GOOGLE med sig: ingen inloggning startade alls
      // (logcat på emulatorn 2026-09-15, sett som "kunde inte slutföras").
      ...(where === "ios" ? { apple: { clientId: APPLE_SERVICE_ID } } : {}),
    });
    initialized = true;
  }
  return SocialLogin;
}

export type SocialLoginOutcome =
  /** Webbläsaren är på väg till leverantören (full redirect) — nollställ inte laddningen. */
  | { kind: "redirecting" }
  /** Inloggad i appen — anroparen navigerar KLIENT-side till `target` (ingen omladdning). */
  | { kind: "signed-in"; target: string }
  | { kind: "cancelled" }
  /**
   * `reason` = leverantörens/pluginets egna felrad, kapad. Den visas i liten
   * stil under det generella felet: "[28444] Developer console is not set up
   * correctly" är skillnaden mellan en SHA-1-miss i Google Cloud och ett
   * serverfel, och utan den står användaren (och vi) med en gissning.
   */
  | { kind: "failed"; reason?: string };

/**
 * Starta inloggningen. Den nativa vägen slutar INTE med en omladdning: efter
 * bygge 40 (2026-08-29) tog inloggningen "extremt lång tid" — Google-arket i
 * sig är snabbt, det var vår svans efteråt: POST till NextAuth, sedan en hel
 * dokumentladdning av /api/auth/after-social som gjorde ännu en serverresa
 * innan sidan byttes. Nu läses sessionen en gång (samma svar NextAuth ändå
 * hämtar) och navigeringen sker i klienten.
 */
export async function socialLogin(provider: OAuthProvider, next: string): Promise<SocialLoginOutcome> {
  const where = await platform();
  const useNative = where === "ios" || (where === "android" && provider === "google");

  if (!useNative) {
    await signIn(provider, { callbackUrl: afterSocialUrl(next) });
    return { kind: "redirecting" };
  }

  let idToken: string | null = null;
  let name: string | null = null;
  try {
    const plugin = await nativePlugin(where === "ios" ? "ios" : "android");
    if (provider === "google") {
      // ⛔ INGA `scopes` PÅ ANDROID: pluginet lägger själv på email/profile/openid,
      // och en scopes-array — vilken som helst — kräver en patchad MainActivity
      // ("You CANNOT use scopes without modifying the main activity", sett i
      // appen 2026-09-15 direkt efter Apple-config-fixen). iOS tar dem som förut.
      const res = await plugin.login({
        provider: "google",
        options: where === "ios" ? { scopes: ["email", "profile"] } : {},
      });
      const r = res.result as GoogleLoginResponse;
      if (r.responseType === "online") {
        idToken = r.idToken;
        name = r.profile.name;
      }
    } else {
      const res = await plugin.login({ provider: "apple", options: { scopes: ["email", "name"] } });
      const r = res.result as AppleProviderResponse;
      idToken = r.idToken;
      const { givenName, familyName } = r.profile;
      name = [givenName, familyName].filter(Boolean).join(" ") || null;
    }
  } catch (e) {
    // Användaren stängde rutan ⇒ tyst. Allt annat ⇒ fel.
    const raw = e instanceof Error ? e.message : typeof e === "string" ? e : "";
    const msg = raw.toLowerCase();
    if (/cancel|canceled|cancelled|1001/.test(msg)) return { kind: "cancelled" };
    console.warn(`[social-login] ${provider} native login failed:`, raw || e);
    return { kind: "failed", reason: raw.slice(0, 160) || undefined };
  }
  if (!idToken) return { kind: "failed", reason: `${provider}: inget id_token i svaret` };

  const result = await signIn("native-token", {
    provider,
    idToken,
    name: name ?? "",
    redirect: false,
  });
  if (!result?.ok || result.error) {
    return { kind: "failed", reason: `server: ${result?.error ?? result?.status ?? "okänt"}` };
  }
  setAuthHint(true);
  // Samma beslut som /api/auth/after-social, men ur sessionen NextAuth just
  // utfärdade — nya konton till onboardingen, gamla till `next`.
  const session = await getSession();
  const done = session?.user?.onboardingCompleted === true;
  return { kind: "signed-in", target: done && /^\/(?!\/)/.test(next) ? next : "/onboarding" };
}
