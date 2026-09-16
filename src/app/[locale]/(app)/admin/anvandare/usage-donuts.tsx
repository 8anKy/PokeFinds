import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DonutChart, type DonutSlice } from "@/components/features/admin/donut-chart";
import { CATEGORICAL, TICK } from "@/components/features/admin/chart-palette";

export interface UsageSlice {
  /** null = "Övriga" (ingen länk). */
  userId: string | null;
  name: string;
  count: number;
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

function UsageCard({ title, unit, rows, windowDays }: { title: string; unit: string; rows: UsageSlice[]; windowDays: number }) {
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
      </CardContent>
    </Card>
  );
}

export function UsageDonuts({ scans, grades, windowDays }: { scans: UsageSlice[]; grades: UsageSlice[]; windowDays: number }) {
  return (
    <div className="grid gap-4 xl:grid-cols-2">
      <UsageCard title="Skanningar" unit="skanningar" rows={scans} windowDays={windowDays} />
      <UsageCard title="AI-graderingar" unit="graderingar" rows={grades} windowDays={windowDays} />
    </div>
  );
}
