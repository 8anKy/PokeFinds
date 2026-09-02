"use client";

import { useState } from "react";
import { Link } from "@/i18n/navigation";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { formatDateTime } from "@/lib/format";
import { RENEWAL_LABELS, type RenewalStatus } from "@/lib/subscription-status";
import { LastSeen } from "@/app/[locale]/(app)/admin/anvandare/user-bits";

/**
 * Betalande kunder på adminöversikten — sorterbar per kolumn (ägarönskemål
 * 2026-09-02: "förnyas överst", "skapade kontot först", "prenumererade först").
 *
 * Sorteringen sker i KLIENTEN, till skillnad från användarlistan (users-sort.ts):
 * den listan är serverpaginerad, men betalande kunder är en handfull rader som
 * alla redan ligger i props — en omsortering här kastar aldrig om ett urval.
 * Datum kommer som ISO-strängar: Date-objekt kan inte korsa server→klient-gränsen.
 */
export interface PayingCustomerRow {
  id: string;
  name: string;
  email: string;
  channel: "store" | "stripe";
  environment: string | null;
  proSince: string | null;
  renewal: RenewalStatus;
  rcExpiresAt: string | null;
  createdAt: string;
  watchlistCount: number;
  collectionCount: number;
  lastSeenAt: string | null;
}

type SortKey =
  | "name"
  | "channel"
  | "proSince"
  | "renewal"
  | "created"
  | "watchlist"
  | "collection"
  | "lastSeen";
type SortDir = "asc" | "desc";

/** Förnyas = grönt, uppsagd = varning, okänt/inget = neutralt. Aldrig rött: en uppsägning är ett faktum, inte ett fel. */
const RENEWAL_VARIANTS: Record<RenewalStatus, BadgeVariant> = {
  yes: "success",
  no: "warning",
  unknown: "default",
  none: "default",
};

/** Fallande ordning = förnyas överst. Okänt hamnar mellan uppsagd och inget — det är osorterat, inte sämst. */
const RENEWAL_RANK: Record<RenewalStatus, number> = { yes: 3, no: 2, unknown: 1, none: 0 };

const nf = (n: number) => new Intl.NumberFormat("sv-SE").format(n);
const ts = (iso: string | null) => (iso ? new Date(iso).getTime() : Number.NEGATIVE_INFINITY);

function rank(row: PayingCustomerRow, key: SortKey): number | string {
  switch (key) {
    case "name":
      return row.name.toLocaleLowerCase("sv-SE");
    case "channel":
      return row.channel;
    case "proSince":
      return ts(row.proSince);
    case "renewal":
      return RENEWAL_RANK[row.renewal];
    case "created":
      return ts(row.createdAt);
    case "watchlist":
      return row.watchlistCount;
    case "collection":
      return row.collectionCount;
    case "lastSeen":
      return ts(row.lastSeenAt);
    default: {
      const missing: never = key;
      throw new Error(`rank saknar gren för "${String(missing)}"`);
    }
  }
}

function sortRows(rows: PayingCustomerRow[], key: SortKey, dir: SortDir): PayingCustomerRow[] {
  const sign = dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ra = rank(a, key);
    const rb = rank(b, key);
    const cmp =
      typeof ra === "string" && typeof rb === "string"
        ? ra.localeCompare(rb, "sv-SE")
        : Number(ra) - Number(rb);
    // `id` sist: utan ett unikt led är ordningen inom en grupp godtycklig och
    // hoppar mellan renderingar.
    return cmp * sign || a.id.localeCompare(b.id);
  });
}

interface ColumnDef {
  key: SortKey;
  label: string;
  title?: string;
  align?: "right";
  /** Första klicket: datum/tal visas störst först, text A→Ö. */
  firstDir: SortDir;
}

const COLUMNS: ColumnDef[] = [
  { key: "name", label: "Kund", firstDir: "asc" },
  { key: "channel", label: "Kanal", firstDir: "asc" },
  {
    key: "proSince",
    label: "Prenumerant sedan",
    title: "Första betalda aktiveringen. Saknas för köp gjorda innan loggningen fanns — de hamnar sist.",
    firstDir: "desc",
  },
  {
    key: "renewal",
    label: "Förnyas",
    title: "Auto-förnyelse enligt leverantörens senaste webhook-event. Fallande = förnyas överst.",
    firstDir: "desc",
  },
  { key: "created", label: "Konto skapat", firstDir: "desc" },
  { key: "watchlist", label: "Bevakningar", align: "right", firstDir: "desc" },
  { key: "collection", label: "Samling", align: "right", firstDir: "desc" },
  { key: "lastSeen", label: "Senast sedd", title: "Senaste autentiserade aktivitet (±15 min).", firstDir: "desc" },
];

/**
 * Klickbar rubrik — samma mönster som användarlistans SortTH. Ligger på modulnivå:
 * en komponent som deklareras i en render får ny identitet varje gång och React
 * monterar då om hela rubrikraden.
 */
function SortTH({
  col,
  sort,
  dir,
  onSort,
}: {
  col: ColumnDef;
  sort: SortKey;
  dir: SortDir;
  onSort: (key: SortKey, dir: SortDir) => void;
}) {
  const active = sort === col.key;
  const nextDir: SortDir = active ? (dir === "asc" ? "desc" : "asc") : col.firstDir;
  return (
    <TH
      title={col.title}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      className="p-0"
    >
      <button
        type="button"
        onClick={() => onSort(col.key, nextDir)}
        aria-label={`Sortera på ${col.label}, ${nextDir === "asc" ? "lägst först" : "högst först"}`}
        className={`flex w-full items-center gap-1 px-4 py-3 transition-colors ${
          col.align === "right" ? "justify-end text-right" : "text-left"
        } ${active ? "text-holo-cyan" : "hover:text-ink"}`}
      >
        <span>{col.label}</span>
        <span aria-hidden className={active ? undefined : "text-ink-faint"}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </TH>
  );
}

export function PayingCustomersTable({ rows }: { rows: PayingCustomerRow[] }) {
  // Standard = senaste prenumerant först, samma som serverns ordning.
  const [sort, setSort] = useState<SortKey>("proSince");
  const [dir, setDir] = useState<SortDir>("desc");
  const sorted = sortRows(rows, sort, dir);

  const onSort = (key: SortKey, nextDir: SortDir) => {
    setSort(key);
    setDir(nextDir);
  };

  if (rows.length === 0) {
    return <p className="text-sm text-ink-faint">Inga betalande kunder ännu.</p>;
  }

  return (
    <div className="overflow-x-auto">
      <Table>
        <THead>
          <TR>
            {COLUMNS.map((col) => (
              <SortTH key={col.key} col={col} sort={sort} dir={dir} onSort={onSort} />
            ))}
          </TR>
        </THead>
        <TBody>
          {sorted.map((u) => (
            <TR key={u.id}>
              <TD>
                <Link
                  href={`/admin/anvandare/${u.id}`}
                  className="font-medium text-ink transition-colors hover:text-holo-cyan"
                >
                  {u.name}
                </Link>
                <span className="block text-xs text-ink-faint">{u.email}</span>
              </TD>
              <TD>
                <Badge variant={u.channel === "stripe" ? "info" : "default"}>
                  {u.channel === "stripe" ? "Stripe" : "App Store / Play"}
                </Badge>
                {u.environment === "SANDBOX" && (
                  <Badge
                    variant="warning"
                    className="ml-1"
                    title="RevenueCat SANDBOX — ett testköp som Apple/Google aldrig debiterat. Inte en kund."
                  >
                    Sandbox
                  </Badge>
                )}
              </TD>
              <TD className="text-sm text-ink-muted">
                {u.proSince ? (
                  formatDateTime(u.proSince)
                ) : (
                  <span className="text-ink-faint" title="Köpt innan loggningen fanns">
                    –
                  </span>
                )}
              </TD>
              <TD>
                <Badge variant={RENEWAL_VARIANTS[u.renewal]} title={RENEWAL_LABELS[u.renewal].hint}>
                  {RENEWAL_LABELS[u.renewal].label}
                </Badge>
                {u.renewal === "no" && u.rcExpiresAt && (
                  <span className="block text-xs text-ink-faint">t.o.m. {formatDateTime(u.rcExpiresAt)}</span>
                )}
              </TD>
              <TD className="text-sm text-ink-muted">{formatDateTime(u.createdAt)}</TD>
              <TD className="text-right">
                {/* Noll bevakningar hos en betalande kund är ett larm, inte en siffra. */}
                <span className={u.watchlistCount === 0 ? "font-semibold text-holo-gold" : "text-ink"}>
                  {nf(u.watchlistCount)}
                </span>
              </TD>
              <TD className="text-right text-ink">{nf(u.collectionCount)}</TD>
              <TD className="text-sm text-ink-muted">
                <LastSeen iso={u.lastSeenAt} />
              </TD>
            </TR>
          ))}
        </TBody>
      </Table>
    </div>
  );
}
