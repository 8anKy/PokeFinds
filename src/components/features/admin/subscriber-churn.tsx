import type { ReactNode } from "react";
import { Link } from "@/i18n/navigation";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDate, formatDateTime } from "@/lib/format";

/**
 * Uppsägningar, tidigare kunder och återkomster under "Betalande kunder" på
 * adminöversikten (ägarönskemål 2026-10-04: "enkelt, direkt när jag scrollar ner").
 * Datumen kommer ur webhookarnas AuditLog-rader — se lib/subscription-history.ts.
 * Datum som ISO-strängar av samma skäl som betaltabellen.
 */
export interface CancelledRow {
  id: string;
  name: string;
  email: string;
  cancelledAt: string | null;
  cancelledApprox: boolean;
  /** Sista dagen med Pro (RevenueCat expiresAt / Stripe periodslut). */
  proUntil: string | null;
}

export interface FormerRow {
  id: string;
  name: string;
  email: string;
  firstStartAt: string | null;
  cancelledAt: string | null;
  cancelledApprox: boolean;
  endedAt: string | null;
  paidPeriods: number;
}

export interface ComebackRow {
  id: string;
  name: string;
  email: string;
  firstStartAt: string | null;
  lastComebackAt: string | null;
  comebacks: number;
  streak: number | null;
}

function Customer({ id, name, email }: { id: string; name: string; email: string }) {
  return (
    <TD>
      <Link
        href={`/admin/anvandare/${id}`}
        className="font-medium text-ink transition-colors hover:text-holo-cyan"
      >
        {name}
      </Link>
      <span className="block text-xs text-ink-faint">{email}</span>
    </TD>
  );
}

function When({ iso, approx }: { iso: string | null; approx?: boolean }) {
  if (!iso) return <span className="text-ink-faint">–</span>;
  return <>{approx ? `senast ${formatDate(iso)}` : formatDateTime(iso)}</>;
}

function Section({
  title,
  count,
  empty,
  children,
}: {
  title: string;
  count: number;
  empty: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <p className="text-xs font-medium uppercase tracking-wide text-ink-faint">
        {title} <span className="text-ink-muted">· {count}</span>
      </p>
      {count === 0 ? (
        <p className="text-sm text-ink-faint">{empty}</p>
      ) : (
        <div className="overflow-x-auto">{children}</div>
      )}
    </div>
  );
}

const months = (n: number) => `${n} mån`;

export function SubscriberChurn({
  cancelled,
  former,
  comebacks,
}: {
  cancelled: CancelledRow[];
  former: FormerRow[];
  comebacks: ComebackRow[];
}) {
  return (
    <div className="space-y-6 border-t border-surface-border pt-5">
      <Section title="Har sagt upp — Pro löper ut" count={cancelled.length} empty="Ingen har sagt upp just nu.">
        <Table>
          <THead>
            <TR>
              <TH>Kund</TH>
              <TH>Sa upp</TH>
              <TH>Pro t.o.m.</TH>
            </TR>
          </THead>
          <TBody>
            {cancelled.map((u) => (
              <TR key={u.id}>
                <Customer {...u} />
                <TD className="text-sm text-ink-muted">
                  <When iso={u.cancelledAt} approx={u.cancelledApprox} />
                </TD>
                <TD className="text-sm text-ink-muted">
                  <When iso={u.proUntil} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section title="Tidigare prenumeranter" count={former.length} empty="Ingen har slutat ännu.">
        <Table>
          <THead>
            <TR>
              <TH>Kund</TH>
              <TH>Började</TH>
              <TH>Sa upp</TH>
              <TH>Slutade</TH>
              <TH className="text-right">Betalade</TH>
            </TR>
          </THead>
          <TBody>
            {former.map((u) => (
              <TR key={u.id}>
                <Customer {...u} />
                <TD className="text-sm text-ink-muted">
                  <When iso={u.firstStartAt} />
                </TD>
                <TD className="text-sm text-ink-muted">
                  <When iso={u.cancelledAt} approx={u.cancelledApprox} />
                </TD>
                <TD className="text-sm text-ink-muted">
                  <When iso={u.endedAt} />
                </TD>
                <TD className="text-right text-ink">{months(u.paidPeriods)}</TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>

      <Section title="Kom tillbaka" count={comebacks.length} empty="Ingen har kommit tillbaka ännu.">
        <Table>
          <THead>
            <TR>
              <TH>Kund</TH>
              <TH>Började</TH>
              <TH>Kom tillbaka</TH>
              <TH className="text-right">I rad</TH>
            </TR>
          </THead>
          <TBody>
            {comebacks.map((u) => (
              <TR key={u.id}>
                <Customer {...u} />
                <TD className="text-sm text-ink-muted">
                  <When iso={u.firstStartAt} />
                </TD>
                <TD className="text-sm text-ink-muted">
                  <When iso={u.lastComebackAt} />
                  {u.comebacks > 1 && (
                    <span className="block text-xs text-ink-faint">{u.comebacks} gånger</span>
                  )}
                </TD>
                <TD className="text-right font-semibold text-rise">
                  {u.streak != null ? months(u.streak) : "–"}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Section>
    </div>
  );
}
