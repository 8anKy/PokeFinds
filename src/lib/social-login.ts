"use client";

import { signIn } from "next-auth/react";
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
async function nativePlugin() {
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
      apple: { clientId: APPLE_SERVICE_ID },
    });
    initialized = true;
  }
  return SocialLogin;
}

export type SocialLoginOutcome = "redirecting" | "cancelled" | "failed";

/**
 * Starta inloggningen. "redirecting" = webbläsaren är på väg vidare (webb-
 * redirect eller after-social) — anroparen ska INTE nollställa sin laddning.
 */
export async function socialLogin(provider: OAuthProvider, next: string): Promise<SocialLoginOutcome> {
  const where = await platform();
  const useNative = where === "ios" || (where === "android" && provider === "google");

  if (!useNative) {
    await signIn(provider, { callbackUrl: afterSocialUrl(next) });
    return "redirecting";
  }

  let idToken: string | null = null;
  let name: string | null = null;
  try {
    const plugin = await nativePlugin();
    if (provider === "google") {
      const res = await plugin.login({ provider: "google", options: { scopes: ["email", "profile"] } });
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
    const msg = e instanceof Error ? e.message.toLowerCase() : "";
    return /cancel|canceled|cancelled|1001/.test(msg) ? "cancelled" : "failed";
  }
  if (!idToken) return "failed";

  const result = await signIn("native-token", {
    provider,
    idToken,
    name: name ?? "",
    redirect: false,
  });
  if (!result?.ok || result.error) return "failed";
  setAuthHint(true);
  window.location.assign(afterSocialUrl(next));
  return "redirecting";
}
