import { formatPrice, formatDate } from "@/lib/format";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { EmptyState } from "@/components/ui/empty-state";
import { StatCard } from "@/components/features/stat-card";
import {
  IconGem,
  IconPackage,
  IconReceipt,
  IconTrendingDown,
  IconTrendingUp,
} from "@/components/ui/icons";
import { salesSummary, type SaleRow } from "@/services/sales";
import { CONDITION_LABELS } from "./collection-client";

/** Resultat före avgifter (sålt − inköp), eller null om inköpspris saknas. */
function resultOre(s: SaleRow): number | null {
  return s.purchasePriceOre == null ? null : s.salePriceOre - s.purchasePriceOre;
}

function ResultText({ value }: { value: number | null }) {
  if (value == null) return <span className="text-ink-muted">–</span>;
  const cls = value > 0 ? "text-rise" : value < 0 ? "text-fall" : "text-ink-muted";
  return (
    <span className={`font-medium tabular-nums ${cls}`}>
      {value > 0 ? "+" : ""}
      {formatPrice(value)}
    </span>
  );
}

export function SoldList({ sales }: { sales: SaleRow[] }) {
  if (sales.length === 0) {
    return (
      <EmptyState
        icon={<IconPackage size={32} />}
        title="Inga sålda objekt än"
        description="När en av dina Tradera-annonser säljs dyker objektet upp här med försäljningspris och resultat."
      />
    );
  }

  const summary = salesSummary(sales);

  return (
    <>
      {/* Realiserad performance (före Traderas avgifter) */}
      <div className="mb-6 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          label="Sålt totalt"
          value={formatPrice(summary.totalSaleOre)}
          icon={<IconReceipt size={20} />}
        />
        <StatCard
          label="Resultat (före avgifter)"
          value={formatPrice(summary.resultOre)}
          change={summary.resultPercent ?? undefined}
          icon={summary.resultOre >= 0 ? <IconTrendingUp size={20} /> : <IconTrendingDown size={20} />}
        />
        <StatCard label="Antal sålda" value={`${summary.count}`} icon={<IconPackage size={20} />} />
        <StatCard
          label="Bästa affär"
          value={summary.bestResultOre != null ? formatPrice(summary.bestResultOre) : "–"}
          icon={<IconGem size={20} />}
        />
      </div>

      {/* Mobil: kort */}
      <div className="space-y-3 lg:hidden">
        {sales.map((s) => (
          <div key={s.id} className="card-surface flex items-center gap-3 p-3">
            {s.imageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={s.imageUrl}
                alt=""
                className="h-16 w-12 shrink-0 rounded object-contain bg-surface-overlay"
                loading="lazy"
              />
            ) : (
              <span className="flex h-16 w-12 shrink-0 items-center justify-center rounded bg-surface-overlay text-ink-faint">
                <IconPackage size={18} />
              </span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-ink">{s.name}</p>
              {s.setName && <p className="truncate text-xs text-ink-muted">{s.setName}</p>}
              <p className="text-xs text-ink-muted">{formatDate(s.soldAt)}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-semibold tabular-nums text-ink">{formatPrice(s.salePriceOre)}</p>
              <ResultText value={resultOre(s)} />
            </div>
          </div>
        ))}
      </div>

      {/* Desktop: tabell */}
      <div className="hidden lg:block">
        <Table>
          <THead>
            <TR>
              <TH>Namn</TH>
              <TH>Set</TH>
              <TH>Skick</TH>
              <TH>Såld</TH>
              <TH>Inköp</TH>
              <TH>Sålt för</TH>
              <TH>Resultat (före avgifter)</TH>
            </TR>
          </THead>
          <TBody>
            {sales.map((s) => (
              <TR key={s.id}>
                <TD className="font-medium">
                  <div className="flex items-center gap-3">
                    {s.imageUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={s.imageUrl}
                        alt=""
                        className="h-12 w-9 shrink-0 rounded object-contain bg-surface-overlay"
                        loading="lazy"
                      />
                    ) : (
                      <span className="flex h-12 w-9 shrink-0 items-center justify-center rounded bg-surface-overlay text-ink-faint">
                        <IconPackage size={16} />
                      </span>
                    )}
                    <span>{s.name}</span>
                  </div>
                </TD>
                <TD className="text-ink-muted">{s.setName ?? "–"}</TD>
                <TD>{CONDITION_LABELS[s.condition] ?? s.condition}</TD>
                <TD className="text-ink-muted">{formatDate(s.soldAt)}</TD>
                <TD data-price>{formatPrice(s.purchasePriceOre)}</TD>
                <TD data-price className="font-semibold">
                  {formatPrice(s.salePriceOre)}
                </TD>
                <TD>
                  <ResultText value={resultOre(s)} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </div>
    </>
  );
}
