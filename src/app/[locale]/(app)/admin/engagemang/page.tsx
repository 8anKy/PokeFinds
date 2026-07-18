import { auth, hasRole } from "@/lib/auth";
import { Link } from "@/i18n/navigation";
import { formatPrice } from "@/lib/format";
import { getEngagementLeaderboard } from "@/services/market";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";
import { AdminRequired } from "../admin-required";

export const dynamic = "force-dynamic";

const nf = new Intl.NumberFormat("sv-SE");
const WINDOWS = [
  { value: "7", label: "7 dagar" },
  { value: "30", label: "30 dagar" },
] as const;

interface PageProps {
  searchParams: { period?: string };
}

/**
 * Engagemang: vilka produkter folk faktiskt tittar på, klickar sig fram till och
 * söker upp. Samma anonyma AnalyticsEvent-data som driver publika "Trendar" — här
 * för att prioritera vad som ska lyftas/lagerhållas. Poäng = vy×1 + klick×2 + sök×3.
 */
export default async function AdminEngagementPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user || !hasRole(session.user.role, "ADMIN")) {
    return <AdminRequired />;
  }

  const days = searchParams.period === "30" ? 30 : 7;
  const rows = await getEngagementLeaderboard(days, 100);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold text-ink">Engagemang</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Mest visade, klickade och sökta produkterna. Poäng = vy×1 + klick×2 + sök×3.
          </p>
        </div>
        <div className="flex gap-1 rounded-lg border border-surface-border bg-surface-raised p-1">
          {WINDOWS.map((w) => {
            const active = String(days) === w.value;
            return (
              <Link
                key={w.value}
                href={`/admin/engagemang?period=${w.value}`}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  active
                    ? "bg-surface-overlay text-holo-cyan shadow-card"
                    : "text-ink-muted hover:text-ink"
                )}
              >
                {w.label}
              </Link>
            );
          })}
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Ingen engagemangsdata ännu"
          description="Statistiken byggs framåt allt eftersom besökare tittar på, klickar på och söker fram produkter."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              <TH className="w-12">#</TH>
              <TH>Produkt</TH>
              <TH className="text-right">Vyer</TH>
              <TH className="text-right">Klick</TH>
              <TH className="text-right">Sök</TH>
              <TH className="text-right">Poäng</TH>
              <TH className="text-right">Lägsta pris</TH>
            </TR>
          </THead>
          <TBody>
            {rows.map((r, i) => (
              <TR key={r.product.id}>
                <TD className="text-ink-faint">{i + 1}</TD>
                <TD>
                  <Link
                    href={`/produkter/${r.product.slug}`}
                    className="font-medium text-ink hover:text-holo-cyan"
                  >
                    {r.product.title}
                  </Link>
                </TD>
                <TD className="text-right tabular-nums">{nf.format(r.views)}</TD>
                <TD className="text-right tabular-nums">{nf.format(r.clicks)}</TD>
                <TD className="text-right tabular-nums">{nf.format(r.searches)}</TD>
                <TD className="text-right font-semibold tabular-nums text-holo-cyan">
                  {nf.format(r.score)}
                </TD>
                <TD className="text-right tabular-nums text-ink-muted">
                  {formatPrice(r.product.lowestPriceOre)}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}
    </div>
  );
}
