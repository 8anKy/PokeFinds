"use client";

import { useState, type FormEvent } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import type { Role, PlanTier } from "@prisma/client";
import { RENEWAL_LABELS, type RenewalStatus } from "@/lib/subscription-status";
import type { NotificationSettings } from "@/lib/notification-settings";
import {
  LastSeen,
  NotificationBadges,
  PlanBadge,
  describeDevices,
  formatCostOre,
} from "./user-bits";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { isDefaultSort, type SortDir, type UserSortKey } from "./users-sort";

export interface AdminUserRow {
  id: string;
  email: string;
  name: string;
  role: Role;
  planTier: PlanTier;
  /** Gratis Pro t.o.m. (YYYY-MM-DD), null = ingen gåva. Se lib/plan.ts. */
  bonusProUntil: string | null;
  /** Sammanvägd Pro-status (isPro): planTier ∪ bonus ∪ Stripe ∪ admin-roll. */
  isPro: boolean;
  /** Förnyas den betalda prenumerationen? Se lib/subscription-status.ts. */
  renewal: RenewalStatus;
  /** Första betalda aktiveringen (YYYY-MM-DD), null = okänd/ingen. */
  proSince: string | null;
  /** RevenueCat SANDBOX — testköp, inte en kund. */
  sandbox: boolean;
  reputationScore: number;
  emailVerified: boolean;
  notifications: NotificationSettings;
  /** Plattform per registrerad push-token ("ios", "android", …). */
  devices: string[];
  lastSeenAt: string | null;
  createdAt: string;
  /** AI-kostnad i öre under kostnadsfönstret (skanner + gradering). */
  costOre: number;
  /** Rader i fönstret som saknar kostnadsavtryck — se user-costs.ts. */
  costUnmeasured: number;
  scanRows: number;
  gradeRows: number;
}

const ROLE_LABELS: Record<Role, string> = {
  USER: "Användare",
  MODERATOR: "Moderator",
  ADMIN: "Admin",
  SUPERADMIN: "Superadmin",
};

const ROLE_VARIANTS: Record<Role, BadgeVariant> = {
  USER: "default",
  MODERATOR: "info",
  ADMIN: "warning",
  SUPERADMIN: "holo",
};

const RENEWAL_VARIANTS: Record<RenewalStatus, BadgeVariant> = {
  yes: "success",
  no: "warning",
  unknown: "default",
  none: "default",
};

interface ColumnDef {
  label: string;
  title?: string;
  /** Utelämnad = kolumnen går inte att sortera på. */
  sortKey?: UserSortKey;
}

/**
 * Rubrikraden. Ordningen MÅSTE matcha cellerna i <TBody> nedan — den enda
 * kopplingen dem emellan är att båda listorna står i den här filen.
 *
 * SJU KOLUMNER, INTE FJORTON (ägaren 2026-09-16: listan rullade i sidled).
 * Bekräftad e-post, roll, skapad-datum och alla REDIGERINGSVÄLJARE (plan,
 * Pro-gåva, roll) bor på detaljsidan — listan är till för att SKUMMA, inte
 * för att ändra. Sorteringsnycklarna för de flyttade kolumnerna finns kvar i
 * users-sort.ts (URL:en kan fortfarande be om dem).
 */
function buildColumns(costWindowDays: number): ColumnDef[] {
  return [
    { label: "Användare", sortKey: "name", title: "Namn och e-post. ✓ = bekräftad adress." },
    {
      // ⛔ Sorteras på EFFEKTIV Pro (isPro), inte på `planTier` — annars hade en
      //    Stripe- eller bonuskund hamnat bland "Gratis" på en rad som synligt
      //    bär brickan "Pro". Se lib/plan.ts.
      label: "Plan",
      sortKey: "plan",
      title: "Faktisk Pro-status (planTier, bonus, Stripe eller roll). Gåva t.o.m. visas under.",
    },
    {
      // Osorterbar med flit: tre utfall (förnyas/uppsagd/okänt) har ingen
      // rangordning, och "okänt" får aldrig se ut som "sämst".
      label: "Prenumeration",
      title:
        "Betald prenumeration: sedan när, och om den förnyas automatiskt (Stripe cancel_at_period_end / RevenueCat). Okänt = inget webhook-event sedan 2026-09-02.",
    },
    {
      label: "Notiser · enheter",
      sortKey: "devices",
      title:
        "E-post · Push · Alla restocks · Veckobrev · Nytt, samt registrerade push-enheter (en token bevisar appen — tomt bevisar INTE motsatsen). Sorteras på antal enheter.",
    },
    {
      label: "Senast sedd",
      sortKey: "lastSeen",
      title: "Senaste autentiserade aktivitet (±15 min). ”Aldrig” räknas som lägst.",
    },
    {
      label: "Användning",
      sortKey: "usage",
      title: `Skanningar + graderingar de senaste ${costWindowDays} dygnen. Sorteras på antal rader.`,
    },
    {
      label: `Kostnad ${costWindowDays} d`,
      sortKey: "cost",
      title: `AI-kostnad de senaste ${costWindowDays} dygnen (uppmätta tokental). Omätta rader har inget belopp och påverkar inte ordningen.`,
    },
  ];
}

/**
 * Klickbar kolumnrubrik. Första klicket sorterar STIGANDE, andra vänder — och
 * byter alltid till sida 1, eftersom "sida 3 av den gamla ordningen" inte är en
 * position som betyder något i den nya.
 *
 * ⛔ Ligger på modulnivå, inte inuti UsersTable: en komponent som DEKLARERAS i en
 *    render får en ny identitet varje gång och React monterar då om hela
 *    rubrikraden i stället för att uppdatera den.
 */
function SortTH({
  sortKey,
  label,
  title,
  sort,
  dir,
  onSort,
}: {
  sortKey: UserSortKey;
  label: string;
  title?: string;
  sort: UserSortKey;
  dir: SortDir;
  onSort: (sort: UserSortKey, dir: SortDir) => void;
}) {
  const active = sort === sortKey;
  const nextDir: SortDir = active && dir === "asc" ? "desc" : "asc";
  return (
    <TH
      title={title}
      aria-sort={active ? (dir === "asc" ? "ascending" : "descending") : "none"}
      // Padding flyttas till knappen så HELA cellen är klickbar, inte bara texten.
      className="p-0"
    >
      <button
        type="button"
        onClick={() => onSort(sortKey, nextDir)}
        aria-label={`Sortera på ${label}, ${nextDir === "asc" ? "lägst först" : "högst först"}`}
        className={`flex w-full items-center gap-1 px-4 py-3 text-left transition-colors ${
          active ? "text-holo-cyan" : "hover:text-ink"
        }`}
      >
        <span>{label}</span>
        {/* Pilen är dekor för seende — riktningen står i aria-sort på cellen. */}
        <span aria-hidden className={active ? undefined : "text-ink-faint"}>
          {active ? (dir === "asc" ? "▲" : "▼") : "↕"}
        </span>
      </button>
    </TH>
  );
}

interface UsersTableProps {
  users: AdminUserRow[];
  total: number;
  page: number;
  totalPages: number;
  query: string;
  /** Aktiv sortering — kommer från URL:en, ordnas på servern. */
  sort: UserSortKey;
  dir: SortDir;
  /** Hur många dygn bakåt kostnadskolumnen summerar. */
  costWindowDays: number;
}

export function UsersTable({
  users,
  total,
  page,
  totalPages,
  query,
  sort,
  dir,
  costWindowDays,
}: UsersTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState(query);

  /**
   * ⛔ Sorteringen går via URL:en och servern, ALDRIG via en `users.sort()` här.
   *    Listan är serverpaginerad: en sortering i klienten hade kastat om de 25
   *    rader som råkade ligga på sidan och kallat resultatet "dyrast först".
   *    Se users-sort.ts.
   */
  function navigate(
    nextQuery: string,
    nextPage: number,
    nextSort: UserSortKey,
    nextDir: SortDir
  ) {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextPage > 1) params.set("page", String(nextPage));
    if (!isDefaultSort(nextSort, nextDir)) {
      params.set("sort", nextSort);
      params.set("dir", nextDir);
    }
    const qs = params.toString();
    router.push(`/admin/anvandare${qs ? `?${qs}` : ""}`);
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    navigate(search.trim(), 1, sort, dir);
  }

  /** Sorterar om från sida 1 — se SortTH. */
  const sortBy = (nextSort: UserSortKey, nextDir: SortDir) =>
    navigate(query, 1, nextSort, nextDir);

  const columns = buildColumns(costWindowDays);


  return (
    <div className="space-y-4">
      <form onSubmit={handleSearch} className="flex max-w-md items-center gap-2">
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Sök på e-post eller namn …"
          aria-label="Sök användare"
        />
        <Button type="submit" variant="secondary">
          Sök
        </Button>
      </form>

      <p className="text-sm text-ink-muted">
        {total === 1 ? "1 användare" : `${total} användare`}
        {query && ` matchar ”${query}”`}
      </p>

      {users.length === 0 ? (
        <EmptyState
          title="Inga användare hittades"
          description="Prova att ändra din sökning."
        />
      ) : (
        <Table>
          <THead>
            <TR>
              {columns.map((col) =>
                col.sortKey ? (
                  <SortTH
                    key={col.label}
                    sortKey={col.sortKey}
                    label={col.label}
                    title={col.title}
                    sort={sort}
                    dir={dir}
                    onSort={sortBy}
                  />
                ) : (
                  <TH key={col.label} title={col.title}>
                    {col.label}
                  </TH>
                )
              )}
            </TR>
          </THead>
          <TBody>
            {users.map((user) => (
              <TR key={user.id}>
                <TD>
                  {/* Detaljsidan bär allt som inte får plats här: kostnad per
                      funktion, bevakningar, kopplingar och redigering. */}
                  <Link
                    href={`/admin/anvandare/${user.id}`}
                    className="flex items-center gap-1.5 font-medium text-holo-cyan transition-opacity hover:opacity-80"
                  >
                    <span className="truncate">{user.name}</span>
                    {user.emailVerified && (
                      <span aria-label="Bekräftad e-post" title="Bekräftad e-postadress" className="text-rise">
                        ✓
                      </span>
                    )}
                    {user.role !== "USER" && (
                      <Badge variant={ROLE_VARIANTS[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                    )}
                  </Link>
                  <span className="block truncate text-xs text-ink-muted">{user.email}</span>
                </TD>
                <TD>
                  <PlanBadge isPro={user.isPro} planTier={user.planTier} />
                  {user.bonusProUntil && (
                    <span className="block text-xs text-ink-muted" title="Gratis Pro (bonusProUntil)">
                      gåva t.o.m. {user.bonusProUntil}
                    </span>
                  )}
                </TD>
                <TD className="whitespace-nowrap">
                  {user.renewal === "none" ? (
                    <span className="text-ink-faint">–</span>
                  ) : (
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge variant={RENEWAL_VARIANTS[user.renewal]} title={RENEWAL_LABELS[user.renewal].hint}>
                        {RENEWAL_LABELS[user.renewal].label}
                      </Badge>
                      {user.proSince && (
                        <span className="text-xs text-ink-muted" title="Första betalda aktiveringen">
                          sedan {user.proSince}
                        </span>
                      )}
                      {user.sandbox && (
                        <Badge variant="warning" title="RevenueCat SANDBOX — testköp, inte en kund">
                          Sandbox
                        </Badge>
                      )}
                    </span>
                  )}
                </TD>
                <TD>
                  <NotificationBadges settings={user.notifications} />
                  <span className="block text-xs text-ink-muted">{describeDevices(user.devices)}</span>
                </TD>
                <TD className="whitespace-nowrap">
                  <LastSeen iso={user.lastSeenAt} />
                </TD>
                <TD className="whitespace-nowrap tabular-nums text-ink-muted">
                  {user.scanRows === 0 && user.gradeRows === 0 ? (
                    <span className="text-ink-faint">–</span>
                  ) : (
                    <span title="Skanningar / graderingar">
                      {user.scanRows} skan · {user.gradeRows} grad
                    </span>
                  )}
                </TD>
                <TD className="whitespace-nowrap tabular-nums">
                  {formatCostOre(user.costOre)}
                  {/* ⛔ OMÄTTA rader visas SEPARAT, aldrig som noll: allt före
                      2026-08-14 saknar kostnadsavtryck, och en tyst nolla hade
                      fått en tung användare att se gratis ut. */}
                  {user.costUnmeasured > 0 && (
                    <span
                      className="ml-1 text-xs text-ink-faint"
                      title={`${user.costUnmeasured} rader saknar tokental (skapade före kostnadsspårningen, eller en modell utan pris) och ingår INTE i beloppet.`}
                    >
                      +{user.costUnmeasured} omätta
                    </span>
                  )}
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      )}

      <Pagination
        page={page}
        totalPages={totalPages}
        onPageChange={(p) => navigate(query, p, sort, dir)}
      />
    </div>
  );
}
