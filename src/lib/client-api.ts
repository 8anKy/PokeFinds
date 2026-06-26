"use client";

/**
 * Liten fetch-hjälpare för klientkomponenter.
 * - Skickar JSON, kastar Error med svenskt felmeddelande vid fel.
 * - Vid 401 omdirigeras användaren till inloggningen.
 */
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
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : "Något gick fel. Försök igen.";
    throw new Error(message);
  }

  return data as T;
}
