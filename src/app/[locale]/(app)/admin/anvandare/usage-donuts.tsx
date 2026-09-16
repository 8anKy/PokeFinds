import { Link } from "@/i18n/navigation";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LastSeen } from "./user-bits";
import { DonutChart, type DonutSlice } from "@/components/features/admin/donut-chart";
import { CATEGORICAL, TICK } from "@/components/features/admin/chart-palette";

export interface UsageSlice {
  /** null = "Övriga" (ingen länk). */
  userId: string | null;
  name: string;
  count: number;
}

/** En av de senaste raderna: vem, och när. */
export interface RecentUse {
  userId: string;
  name: string;
  at: string;
}

const nf = new Intl.NumberFormat("sv-SE");

function toSlices(rows: UsageSlice[]): DonutSlice[] {
  return rows.map((r, i) => ({
    key: r.userId ?? "rest",
    label: r.name,
    value: r.count,
    color: r.userId ? CATEGORICAL[i % CATEGORICAL.length] : TICK,
    href: r.userId ? `/admin/anvandare/${r.userId}` : undefined,
  }));
}

function UsageCard({
  title,
  unit,
  rows,
  recent,
  windowDays,
}: {
  title: string;
  unit: string;
  rows: UsageSlice[];
  recent: RecentUse[];
  windowDays: number;
}) {
  const total = rows.reduce((s, r) => s + r.count, 0);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <p className="text-sm text-ink-muted">
          Senaste {windowDays} dygnen, per konto. Klicka på ett namn för kontots egna siffror.
        </p>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-ink-faint">Inga {unit} i fönstret.</p>
        ) : (
          <DonutChart slices={toSlices(rows)} centerLabel={unit} centerValue={nf.format(total)} />
        )}
        {recent.length > 0 && (
          <div className="mt-4 border-t border-surface-border/60 pt-3">
            <p className="mb-1.5 text-xs text-ink-muted">Senaste — ett konto per rad</p>
            <ul className="grid gap-x-6 gap-y-1 text-xs sm:grid-cols-2">
              {recent.map((r) => (
                <li key={r.userId} className="flex items-center justify-between gap-3">
                  <Link href={`/admin/anvandare/${r.userId}`} className="min-w-0 truncate text-holo-cyan hover:opacity-80">
                    {r.name}
                  </Link>
                  <span className="shrink-0 tabular-nums text-ink-muted">
                    <LastSeen iso={r.at} />
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function UsageDonuts({
  scans,
  grades,
  recentScans,
  recentGrades,
  windowDays,
}: {
  scans: UsageSlice[];
  grades: UsageSlice[];
  recentScans: RecentUse[];
  recentGrades: RecentUse[];
  windowDays: number;
}) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <UsageCard title="Skanningar" unit="skanningar" rows={scans} recent={recentScans} windowDays={windowDays} />
      <UsageCard title="AI-graderingar" unit="graderingar" rows={grades} recent={recentGrades} windowDays={windowDays} />
    </div>
  );
}
