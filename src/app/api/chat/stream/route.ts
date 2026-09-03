import { requireUser } from "@/lib/auth";
import { communityV2Request } from "@/lib/community-v2-server";
import { SSE_HEARTBEAT, SSE_HEARTBEAT_MS, encodeSse, subscribe } from "@/lib/chat-hub";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Meddelandeströmmen (SSE). En öppen ström per monterad meddelandevy; navet
 * (lib/chat-hub.ts) skriver händelser rakt in här. ⛔ Ingen databas i den här
 * filen — strömmen kostar noll Neon-tid hur länge den än står öppen.
 *
 * Svaren är RÅA `Response`-objekt, inte JSON: EventSource kan inte läsa en
 * felkropp och följer inte omdirigeringar meningsfullt, så 401/404 räcker.
 */
export async function GET(req: Request) {
  let user: Awaited<ReturnType<typeof requireUser>>;
  try {
    user = await requireUser();
  } catch {
    return new Response("Unauthorized", { status: 401 });
  }
  if (!(await communityV2Request(user.role))) return new Response("Not found", { status: 404 });

  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let closed = false;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Skriv säkert: när klienten försvunnit kastar enqueue på en stängd
      // ström, och det felet får aldrig nå navet (som då hade tappat de andra
      // lyssnarna i samma publicering).
      const write = (chunk: string) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup();
        }
      };
      const cleanup = () => {
        if (closed) return;
        closed = true;
        unsubscribe?.();
        unsubscribe = null;
        if (heartbeat) clearInterval(heartbeat);
        heartbeat = null;
        try {
          controller.close();
        } catch {
          // redan stängd
        }
      };

      write(": connected\n\n");
      unsubscribe = subscribe(user.id, (event) => write(encodeSse(event)));
      heartbeat = setInterval(() => write(SSE_HEARTBEAT), SSE_HEARTBEAT_MS);
      req.signal.addEventListener("abort", cleanup, { once: true });
    },
    cancel() {
      closed = true;
      unsubscribe?.();
      unsubscribe = null;
      if (heartbeat) clearInterval(heartbeat);
      heartbeat = null;
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
