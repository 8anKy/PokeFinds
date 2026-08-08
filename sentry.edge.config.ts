// Sentry (edge runtime — middleware). Samma minimala felrapportering som server.
import * as Sentry from "@sentry/nextjs";
import { scrubEvent } from "@/lib/sentry-scrub";

const dsn = process.env.SENTRY_DSN;
if (dsn && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
    // Personuppgifter skalas bort innan eventet skickas (se sentry-scrub.ts).
    sendDefaultPii: false,
    beforeSend: scrubEvent,
  });
}
