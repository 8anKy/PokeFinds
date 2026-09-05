import { prisma } from "@/lib/db";
import { Link } from "@/i18n/navigation";
import { formatDateTime } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

/**
 * BLOCKERADE FÖRSÖK (ordfiltret) — moderatorernas vy (2026-09-05).
 * En stoppad tråd eller ett stoppat svar publiceras aldrig och lämnade förut inget
 * spår; en användare som försöker om och om igen var osynlig. Raderna skrivs i
 * posts/comments-rutterna (ModerationEvent, kind PROFANITY) och visas här som
 * återfall per konto (30 dygn) + de senaste händelserna. Admin-sida ⇒ svenska.
 */
const WINDOW_DAYS = 30;

export async function ModerationLog() {
  const since = new Date(Date.now() - WINDOW_DAYS * 86_400_000);
  const [byUser, latest] = await Promise.all([
    prisma.moderationEvent.groupBy({
      by: ["userId"],
      where: { createdAt: { gte: since } },
      _count: { _all: true },
      _max: { createdAt: true },
      orderBy: { _count: { userId: "desc" } },
      take: 20,
    }),
    prisma.moderationEvent.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
      select: {
        id: true,
        kind: true,
        target: true,
        detail: true,
        createdAt: true,
        user: { select: { id: true, name: true } },
      },
    }),
  ]);
  const users = await prisma.user.findMany({
    where: { id: { in: byUser.map((r) => r.userId) } },
    select: { id: true, name: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name]));

  return (
    <section className="mt-10">
      <h2 className="font-display text-lg font-semibold text-ink">Blockerade ord</h2>
      <p className="mt-1 text-sm text-ink-muted">
        Försök att publicera trådar eller svar som ordfiltret stoppade. Ingenting av det här
        publicerades — listan finns för att se vem som försöker igen.
      </p>

      {byUser.length === 0 ? (
        <p className="mt-4 text-sm text-ink-faint">Inga blockerade försök de senaste {WINDOW_DAYS} dygnen.</p>
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-surface-border">
          <table className="w-full text-sm">
            <thead className="bg-surface-overlay/60 text-left text-xs uppercase tracking-wide text-ink-faint">
              <tr>
                <th className="px-3 py-2">Användare</th>
                <th className="px-3 py-2">Försök ({WINDOW_DAYS} d)</th>
                <th className="px-3 py-2">Senast</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-surface-border">
              {byUser.map((r) => (
                <tr key={r.userId}>
                  <td className="px-3 py-2">
                    <Link href={`/admin/anvandare/${r.userId}`} className="text-holo-cyan hover:underline">
                      {nameOf.get(r.userId) ?? r.userId}
                    </Link>
                  </td>
                  <td className="px-3 py-2 tabular-nums">
                    {r._count._all >= 3 ? (
                      <Badge variant="danger">{r._count._all}</Badge>
                    ) : (
                      r._count._all
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-muted">
                    {r._max.createdAt ? formatDateTime(r._max.createdAt) : "–"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {latest.length > 0 && (
        <ul className="mt-4 space-y-1.5 text-xs text-ink-muted">
          {latest.map((e) => (
            <li key={e.id} className="flex flex-wrap gap-x-2">
              <span className="tabular-nums text-ink-faint">{formatDateTime(e.createdAt)}</span>
              <span className="font-medium text-ink">{e.user.name}</span>
              <span>{e.target === "COMMENT" ? "svar" : "tråd"}</span>
              {e.detail && <span className="text-ink-faint">· {e.detail}</span>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
