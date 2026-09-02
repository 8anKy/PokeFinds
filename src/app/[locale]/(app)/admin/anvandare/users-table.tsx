"use client";

import { useState, type FormEvent } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import type { Role, PlanTier } from "@prisma/client";
import { formatDateTime } from "@/lib/format";
import { RENEWAL_LABELS, type RenewalStatus } from "@/lib/subscription-status";
import type { NotificationSettings } from "@/lib/notification-settings";
import {
  LastSeen,
  NotificationBadges,
  YesNo,
  describeDevices,
  formatCostOre,
} from "./user-bits";
import { Badge, type BadgeVariant } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/input";
import { Table, THead, TBody, TR, TH, TD } from "@/components/ui/table";
import { Pagination } from "@/components/ui/pagination";
import { EmptyState } from "@/components/ui/empty-state";
import { useToast } from "@/components/ui/toast";
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

const ALL_ROLES: Role[] = ["USER", "MODERATOR", "ADMIN", "SUPERADMIN"];

const PLAN_LABELS: Record<PlanTier, string> = {
  FREE: "Gratis",
  PREMIUM: "Premium",
};

const ALL_PLANS: PlanTier[] = ["FREE", "PREMIUM"];

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
 */
function buildColumns(costWindowDays: number): ColumnDef[] {
  return [
    { label: "Namn", sortKey: "name" },
    { label: "E-post", sortKey: "email" },
    {
      label: "Bekr.",
      sortKey: "verified",
      title: "Bekräftad e-postadress. Sorterat stigande = obekräftade först.",
    },
    {
      label: "Roll",
      sortKey: "role",
      title: "Sorteras efter behörighetsnivå: Användare → Moderator → Admin → Superadmin.",
    },
    {
      // ⛔ Sorteras på EFFEKTIV Pro (isPro), inte på `planTier` — annars hade en
      //    Stripe- eller bonuskund hamnat bland "Gratis" på en rad som synligt
      //    bär brickan "Pro". Se lib/plan.ts.
      label: "Plan",
      sortKey: "plan",
      title:
        "Sorteras på faktisk Pro-status (planTier, bonus, Stripe eller roll) — inte bara på väljarens värde.",
    },
    { label: "Gratis Pro t.o.m.", sortKey: "bonus" },
    {
      // Osorterbar med flit: tre utfall (förnyas/uppsagd/okänt) har ingen
      // rangordning, och "okänt" får aldrig se ut som "sämst".
      label: "Prenumeration",
      title:
        "Betald prenumeration: sedan när, och om den förnyas automatiskt (Stripe cancel_at_period_end / RevenueCat). Okänt = inget webhook-event sedan 2026-09-02.",
    },
    {
      // Notiser är fyra oberoende reglage utan inbördes ordning — det finns
      // inget "mer notiser än" att sortera på. Osorterbar med flit: en
      // godtycklig ordning hade sett ut som en rangordning.
      label: "Notiser",
      title: "E-post · Push · Alla restocks",
    },
    {
      // ⛔ Rubriken påstod förut "= appen är installerad". Det är en
      //    ÖVERTOLKNING åt fel håll: en token bevisar appen, men tomt bevisar
      //    ingenting (appen kan finnas utan push-tillstånd).
      label: "Push-enheter",
      sortKey: "devices",
      title:
        "Registrerade push-enheter. En token bevisar att appen finns — tomt bevisar INTE motsatsen (push kan vara nekad). Sorteras på antal.",
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
    { label: "Skapad", sortKey: "created" },
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
  currentUserId: string;
  isSuperAdmin: boolean;
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
  currentUserId,
  isSuperAdmin,
  costWindowDays,
}: UsersTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [search, setSearch] = useState(query);
  const [savingId, setSavingId] = useState<string | null>(null);

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

  async function handleRoleChange(userId: string, role: Role) {
    setSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Kunde inte uppdatera rollen.");
      }
      toast({
        title: "Roll uppdaterad",
        description: `Användaren har nu rollen ${ROLE_LABELS[role]}.`,
        variant: "success",
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "Fel vid uppdatering",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setSavingId(null);
    }
  }

  async function handlePlanChange(userId: string, planTier: PlanTier) {
    setSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ planTier }),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) {
        throw new Error(data.error ?? "Kunde inte uppdatera planen.");
      }
      toast({
        title: "Plan uppdaterad",
        description: `Användaren har nu ${PLAN_LABELS[planTier]}.`,
        variant: "success",
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "Fel vid uppdatering",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setSavingId(null);
    }
  }

  /**
   * Ge (eller ta bort) gratis Pro t.o.m. ett datum — kreatörssamarbeten, kompensation,
   * support. ⛔ ANVÄND INTE plan-väljaren till det: `planTier: PREMIUM` ägs av
   * RevenueCat-webhooken (EXPIRATION nollar den tyst) OCH blockerar Stripe-kassan, så
   * mottagaren kunde aldrig teckna ett riktigt abonnemang efteråt. Se lib/plan.ts.
   */
  async function handleBonusChange(userId: string, value: string) {
    setSavingId(userId);
    try {
      const res = await fetch(`/api/admin/users/${userId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ bonusProUntil: value || null }),
      });
      const data: { error?: string } = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Kunde inte uppdatera Pro-gåvan.");
      toast({
        title: value ? "Pro tilldelad" : "Pro-gåvan borttagen",
        description: value ? `Gäller t.o.m. ${value}.` : undefined,
        variant: "success",
      });
      router.refresh();
    } catch (error) {
      toast({
        title: "Fel vid uppdatering",
        description: error instanceof Error ? error.message : "Något gick fel.",
        variant: "error",
      });
    } finally {
      setSavingId(null);
    }
  }

  const today = new Date().toISOString().slice(0, 10);

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
              {isSuperAdmin && <TH>Ändra roll</TH>}
            </TR>
          </THead>
          <TBody>
            {users.map((user) => (
              <TR key={user.id}>
                <TD className="font-medium">
                  {/* Detaljsidan är den enda vy som visar kostnaden per FUNKTION
                      och alla kopplingar (Discord/Tradera/Stripe/kreatörskod). */}
                  <Link
                    href={`/admin/anvandare/${user.id}`}
                    className="text-holo-cyan transition-opacity hover:opacity-80"
                  >
                    {user.name}
                  </Link>
                </TD>
                <TD className="text-ink-muted">{user.email}</TD>
                <TD>
                  <YesNo
                    value={user.emailVerified}
                    title={
                      user.emailVerified
                        ? "E-postadressen är bekräftad"
                        : "Obekräftad — konton skapade före 2026-08-12 kan sakna bekräftelse"
                    }
                  />
                </TD>
                <TD>
                  <Badge variant={ROLE_VARIANTS[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                </TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <Select
                      value={user.planTier}
                      disabled={savingId === user.id}
                      onChange={(e) => handlePlanChange(user.id, e.target.value as PlanTier)}
                      aria-label={`Ändra plan för ${user.name}`}
                      className="h-9 w-28"
                    >
                      {ALL_PLANS.map((plan) => (
                        <option key={plan} value={plan}>
                          {PLAN_LABELS[plan]}
                        </option>
                      ))}
                    </Select>
                    {/* Väljaren visar bara `planTier`. Pro kan komma från FYRA
                        oberoende källor (planTier, bonusProUntil, stripeProUntil,
                        admin-roll) — utan den här brickan ser en Stripe-kund ut
                        som gratis i listan. Se isPro() i lib/plan.ts. */}
                    {user.isPro && user.planTier !== "PREMIUM" && (
                      <Badge
                        variant="info"
                        title="Har Pro via bonus, Stripe eller sin roll — inte via planTier"
                      >
                        Pro
                      </Badge>
                    )}
                  </div>
                </TD>
                <TD>
                  <div className="flex items-center gap-2">
                    <Input
                      type="date"
                      value={user.bonusProUntil ?? ""}
                      min={today}
                      disabled={savingId === user.id}
                      onChange={(e) => handleBonusChange(user.id, e.target.value)}
                      aria-label={`Ge ${user.name} gratis Pro till och med`}
                      className="h-9 w-40"
                    />
                    {user.bonusProUntil && (
                      <button
                        type="button"
                        onClick={() => handleBonusChange(user.id, "")}
                        disabled={savingId === user.id}
                        title="Ta bort Pro-gåvan"
                        className="text-sm text-ink-faint transition-colors hover:text-fall disabled:opacity-50"
                      >
                        Rensa
                      </button>
                    )}
                  </div>
                </TD>
                <TD className="whitespace-nowrap">
                  {user.renewal === "none" ? (
                    <span className="text-ink-faint">–</span>
                  ) : (
                    <span className="flex items-center gap-2">
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
                </TD>
                <TD className="whitespace-nowrap text-ink-muted">
                  {describeDevices(user.devices)}
                </TD>
                <TD className="whitespace-nowrap">
                  <LastSeen iso={user.lastSeenAt} />
                </TD>
                <TD className="whitespace-nowrap text-ink-muted">
                  {user.scanRows === 0 && user.gradeRows === 0 ? (
                    <span className="text-ink-faint">–</span>
                  ) : (
                    <span title="Skanningar / graderingar">
                      {user.scanRows} skan · {user.gradeRows} grad
                    </span>
                  )}
                </TD>
                <TD className="whitespace-nowrap">
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
                <TD className="whitespace-nowrap text-ink-muted">
                  {formatDateTime(user.createdAt)}
                </TD>
                {isSuperAdmin && (
                  <TD>
                    <Select
                      value={user.role}
                      disabled={savingId === user.id || user.id === currentUserId}
                      onChange={(e) => handleRoleChange(user.id, e.target.value as Role)}
                      aria-label={`Ändra roll för ${user.name}`}
                      className="h-9 w-40"
                      title={
                        user.id === currentUserId
                          ? "Du kan inte ändra din egen roll."
                          : undefined
                      }
                    >
                      {ALL_ROLES.map((role) => (
                        <option key={role} value={role}>
                          {ROLE_LABELS[role]}
                        </option>
                      ))}
                    </Select>
                  </TD>
                )}
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
