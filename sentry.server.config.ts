// Sentry (server) — endast felrapportering, ingen perf-tracing (sparar fri kvot).
// DSN via env så den inte ligger i det publika repot. Init bara i prod när DSN finns.
import * as Sentry from "@sentry/nextjs";

const dsn = process.env.SENTRY_DSN;
if (dsn && process.env.NODE_ENV === "production") {
  Sentry.init({
    dsn,
    tracesSampleRate: 0,
  });
}
