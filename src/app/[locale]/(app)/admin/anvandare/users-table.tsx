"use client";

import { useState, type FormEvent } from "react";
import { Link, useRouter } from "@/i18n/navigation";
import type { Role, PlanTier } from "@prisma/client";
import { formatDateTime } from "@/lib/format";
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

interface UsersTableProps {
  users: AdminUserRow[];
  total: number;
  page: number;
  totalPages: number;
  query: string;
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
  currentUserId,
  isSuperAdmin,
  costWindowDays,
}: UsersTableProps) {
  const router = useRouter();
  const { toast } = useToast();
  const [search, setSearch] = useState(query);
  const [savingId, setSavingId] = useState<string | null>(null);

  function navigate(nextQuery: string, nextPage: number) {
    const params = new URLSearchParams();
    if (nextQuery) params.set("q", nextQuery);
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    router.push(`/admin/anvandare${qs ? `?${qs}` : ""}`);
  }

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    navigate(search.trim(), 1);
  }

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
              <TH>Namn</TH>
              <TH>E-post</TH>
              <TH title="Bekräftad e-postadress">Bekr.</TH>
              <TH>Roll</TH>
              <TH>Plan</TH>
              <TH>Gratis Pro t.o.m.</TH>
              <TH title="E-post · Push · Alla restocks">Notiser</TH>
              {/* ⛔ Rubriken påstod förut "= appen är installerad". Det är en
                  ÖVERTOLKNING åt fel håll: en token bevisar appen, men tomt
                  bevisar ingenting (appen kan finnas utan push-tillstånd). */}
              <TH title="Registrerade push-enheter. En token bevisar att appen finns — tomt bevisar INTE motsatsen (push kan vara nekad).">
                Push-enheter
              </TH>
              <TH title="Senaste autentiserade aktivitet (±15 min)">Senast sedd</TH>
              <TH title={`Skanningar + graderingar de senaste ${costWindowDays} dygnen`}>
                Användning
              </TH>
              <TH title={`AI-kostnad de senaste ${costWindowDays} dygnen (uppmätta tokental)`}>
                Kostnad {costWindowDays} d
              </TH>
              <TH>Skapad</TH>
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
        onPageChange={(p) => navigate(query, p)}
      />
    </div>
  );
}
