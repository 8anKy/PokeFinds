import type { ErrorEvent, EventHint } from "@sentry/nextjs";

/**
 * Tar bort personuppgifter ur ett Sentry-event innan det lämnar servern.
 *
 * Sentry är deklarerat som personuppgiftsbiträde i integritetspolicyn, men vi
 * skickar hellre så lite som möjligt: felrapporter behöver stacken och ungefär
 * VAR felet skedde, inte VEM det drabbade. `sendDefaultPii` är av (default), och
 * det här stänger de vägar där en personuppgift ändå kan slinka med:
 *  - `event.user` (id/e-post/ip) nollas helt,
 *  - cookies och auktoriserings-/cookie-headers strippas,
 *  - query-strängen kapas från URL:en (kan bära e-post, token, sökord).
 *
 * ⛔ Får ALDRIG kasta: en scrubber som kraschar sväljer hela felrapporten. Vid
 * minsta osäkerhet returneras eventet oförändrat är fel — då hellre släppa det.
 */
export function scrubEvent(event: ErrorEvent, _hint: EventHint): ErrorEvent | null {
  try {
    delete event.user;

    const req = event.request;
    if (req) {
      delete req.cookies;
      if (req.headers) {
        for (const key of Object.keys(req.headers)) {
          const k = key.toLowerCase();
          if (k === "cookie" || k === "authorization" || k === "x-forwarded-for" || k === "x-real-ip") {
            delete req.headers[key];
          }
        }
      }
      if (typeof req.url === "string") {
        const q = req.url.indexOf("?");
        if (q !== -1) req.url = req.url.slice(0, q);
      }
    }
  } catch {
    // Scrubbern får inte fälla rapporten; misslyckas den droppar vi eventet hellre
    // än att riskera att skicka ostädad data.
    return null;
  }
  return event;
}
