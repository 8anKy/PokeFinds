"use client";

/**
 * Liten fetch-hjälpare för klientkomponenter.
 * - Skickar JSON, kastar Error med svenskt felmeddelande vid fel.
 * - Vid 401 omdirigeras användaren till inloggningen.
 */
/** Fel ur API:t: meddelandet är serverns text, `code` en maskinläsbar nyckel när servern satt en. */
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public code: string | null = null
  ) {
    super(message);
    this.name = "ApiError";
  }
}

/** Koden ur ett fel som apiFetch kastat, annars null. */
export function apiErrorCode(e: unknown): string | null {
  return e instanceof ApiError ? e.code : null;
}

export async function apiFetch<T = unknown>(
  url: string,
  init?: Omit<RequestInit, "body"> & { body?: unknown }
): Promise<T> {
  const { body, headers, ...rest } = init ?? {};
  const res = await fetch(url, {
    // iOS-WKWebView skickar inte alltid session-cookien på fetch utan detta →
    // skrivningar (PATCH/POST) tyst-failade med 401 i native-appen. Tvinga cookies.
    credentials: "include",
    ...rest,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...headers,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });

  if (res.status === 401) {
    window.location.href = `/logga-in?callbackUrl=${encodeURIComponent(window.location.pathname)}`;
    throw new Error("Du måste vara inloggad.");
  }

  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    // tomt svar är ok
  }

  if (!res.ok) {
    const obj = data && typeof data === "object" ? (data as Record<string, unknown>) : null;
    const message =
      obj && typeof obj.error === "string" ? obj.error : "Något gick fel. Försök igen.";
    const code = obj && typeof obj.code === "string" ? obj.code : null;
    throw new ApiError(message, res.status, code);
  }

  return data as T;
}
