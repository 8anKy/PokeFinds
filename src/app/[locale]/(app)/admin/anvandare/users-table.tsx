"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "@/i18n/navigation";
import type { Role, PlanTier } from "@prisma/client";
import { formatDateTime } from "@/lib/format";
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
  reputationScore: number;
  createdAt: string;
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
}

export function UsersTable({
  users,
  total,
  page,
  totalPages,
  query,
  currentUserId,
  isSuperAdmin,
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
              <TH>Roll</TH>
              <TH>Plan</TH>
              <TH>Skapad</TH>
              <TH>Rykte</TH>
              {isSuperAdmin && <TH>Ändra roll</TH>}
            </TR>
          </THead>
          <TBody>
            {users.map((user) => (
              <TR key={user.id}>
                <TD className="font-medium">{user.name}</TD>
                <TD className="text-ink-muted">{user.email}</TD>
                <TD>
                  <Badge variant={ROLE_VARIANTS[user.role]}>{ROLE_LABELS[user.role]}</Badge>
                </TD>
                <TD>
                  <Select
                    value={user.planTier}
                    disabled={savingId === user.id}
                    onChange={(e) => handlePlanChange(user.id, e.target.value as PlanTier)}
                    aria-label={`Ändra plan för ${user.name}`}
                    className="h-9 w-32"
                  >
                    {ALL_PLANS.map((plan) => (
                      <option key={plan} value={plan}>
                        {PLAN_LABELS[plan]}
                      </option>
                    ))}
                  </Select>
                </TD>
                <TD className="whitespace-nowrap text-ink-muted">
                  {formatDateTime(user.createdAt)}
                </TD>
                <TD>{user.reputationScore}</TD>
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
