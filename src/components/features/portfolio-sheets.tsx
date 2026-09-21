"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useRouter } from "@/i18n/navigation";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import { apiFetch, ApiError } from "@/lib/client-api";
import { openPaywallOrNavigate } from "@/lib/paywall";
import {
  normalizePortfolioName,
  PORTFOLIO_LIMIT_CODE,
  PORTFOLIO_NAME_MAX,
} from "@/lib/portfolio-limit";
import { invalidatePortfolios, type PortfolioSummary } from "@/lib/portfolios-client";
import { cn } from "@/lib/utils";

/**
 * "Ny pärm": namn + skapa. Öppnas av "+"-chipen. När servern svarar 403 med
 * kod PORTFOLIO_LIMIT glider paywall-arket upp i stället för ett fel — det är
 * gratiskontots andra pärm som är själva säljögonblicket (lib/portfolio-limit.ts).
 *
 * ⛔ Anroparen får INTE förhandsdöma på `canCreate` och gömma "+"-chipen: en
 *    gratisanvändare ska se att fler pärmar finns, och paywallen ska säga varför.
 *    Men den FÅR öppna paywallen direkt när den vet att planen är full — då slipper
 *    användaren skriva ett namn på något hen inte får skapa.
 */
export function PortfolioCreateSheet({
  open,
  onClose,
  onCreated,
  elevated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (created: PortfolioSummary) => void;
  elevated?: boolean;
}) {
  const t = useTranslations("Portfolios");
  const router = useRouter();
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setName("");
  }, [open]);

  const valid = normalizePortfolioName(name) != null;

  async function submit() {
    if (!valid || saving) return;
    setSaving(true);
    try {
      const created = await apiFetch<PortfolioSummary>("/api/portfolios", {
        method: "POST",
        body: { name: normalizePortfolioName(name) },
      });
      invalidatePortfolios();
      onClose();
      onCreated(created);
      toast({ title: t("createdToast", { name: created.name }), variant: "success" });
    } catch (e) {
      if (e instanceof ApiError && e.code === PORTFOLIO_LIMIT_CODE) {
        onClose();
        openPaywallOrNavigate(router, { source: "portfolio-limit" });
        return;
      }
      toast({
        title: t("createFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      title={t("newBinder")}
      onClose={onClose}
      closeLabel={t("cancel")}
      elevated={elevated}
      panelClassName="sm:mx-auto sm:max-w-md"
      footer={
        <BottomSheetCta onClick={submit} disabled={!valid || saving}>
          {t("create")}
        </BottomSheetCta>
      }
    >
      <label htmlFor="portfolio-name" className="block text-sm text-ink">
        {t("nameLabel")}
      </label>
      <Input
        id="portfolio-name"
        value={name}
        maxLength={PORTFOLIO_NAME_MAX}
        placeholder={t("namePlaceholder")}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void submit();
          }
        }}
        className="mt-1.5 h-11 bg-surface"
      />
      <p className="mt-2 text-xs text-ink-faint">{t("newBinderHint")}</p>
    </BottomSheet>
  );
}

/**
 * Hantera en pärm: döp om, offentlig/privat, ta bort. Standardpärmen kan
 * döpas om och publiceras men inte tas bort. Att ta bort en pärm RADERAR
 * INGA KORT — de faller tillbaka i standardpärmen (FK SetNull), och arket
 * säger det med antalet utsatt.
 */
export function PortfolioManageSheet({
  portfolio,
  onClose,
  onChanged,
  elevated,
}: {
  /** null = stängt. */
  portfolio: PortfolioSummary | null;
  onClose: () => void;
  /** Efter en lyckad ändring: null = pärmen togs bort. */
  onChanged: (next: PortfolioSummary | null) => void;
  elevated?: boolean;
}) {
  const t = useTranslations("Portfolios");
  const { toast } = useToast();
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [saving, setSaving] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);

  useEffect(() => {
    if (!portfolio) return;
    setName(portfolio.name);
    setIsPublic(portfolio.isPublic);
    setConfirmDelete(false);
  }, [portfolio]);

  const open = portfolio !== null;
  const normalized = normalizePortfolioName(name);
  const dirty =
    !!portfolio && ((normalized != null && normalized !== portfolio.name) || isPublic !== portfolio.isPublic);

  async function save() {
    if (!portfolio || !dirty || normalized == null || saving) return;
    setSaving(true);
    try {
      const updated = await apiFetch<Omit<PortfolioSummary, "itemCount">>(
        `/api/portfolios/${portfolio.id}`,
        {
          method: "PATCH",
          body: {
            ...(normalized !== portfolio.name ? { name: normalized } : {}),
            ...(isPublic !== portfolio.isPublic ? { isPublic } : {}),
          },
        }
      );
      invalidatePortfolios();
      onChanged({ ...portfolio, ...updated });
      onClose();
      toast({
        title:
          isPublic !== portfolio.isPublic
            ? isPublic
              ? t("nowPublicToast", { name: updated.name })
              : t("nowPrivateToast", { name: updated.name })
            : t("savedToast"),
        variant: "success",
      });
    } catch (e) {
      toast({
        title: t("saveFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!portfolio || saving) return;
    setSaving(true);
    try {
      await apiFetch(`/api/portfolios/${portfolio.id}`, { method: "DELETE" });
      invalidatePortfolios();
      onChanged(null);
      onClose();
      toast({ title: t("deletedToast", { name: portfolio.name }), variant: "success" });
    } catch (e) {
      toast({
        title: t("deleteFailed"),
        description: e instanceof Error ? e.message : undefined,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  }

  return (
    <BottomSheet
      open={open}
      title={t("manageTitle")}
      onClose={onClose}
      closeLabel={t("cancel")}
      elevated={elevated}
      panelClassName="sm:mx-auto sm:max-w-md"
      headerAction={
        portfolio && !portfolio.isDefault
          ? { label: t("delete"), onClick: () => setConfirmDelete(true), tone: "danger" }
          : undefined
      }
      footer={
        confirmDelete ? (
          <BottomSheetCta onClick={remove} disabled={saving} tone="danger">
            {t("deleteConfirm", { count: portfolio?.itemCount ?? 0 })}
          </BottomSheetCta>
        ) : (
          <BottomSheetCta onClick={save} disabled={!dirty || saving}>
            {t("save")}
          </BottomSheetCta>
        )
      }
    >
      <label htmlFor="portfolio-rename" className="block text-sm text-ink">
        {t("nameLabel")}
      </label>
      <Input
        id="portfolio-rename"
        value={name}
        maxLength={PORTFOLIO_NAME_MAX}
        autoComplete="off"
        enterKeyHint="done"
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            void save();
          }
        }}
        className="mt-1.5 h-11 bg-surface"
      />

      <button
        type="button"
        role="switch"
        aria-checked={isPublic}
        onClick={() => setIsPublic((v) => !v)}
        className="mt-4 flex w-full items-center justify-between gap-3 rounded-lg border border-surface-border bg-surface px-3.5 py-3 text-left"
      >
        <span className="min-w-0">
          <span className="block text-sm font-medium text-ink">{t("publicLabel")}</span>
          <span className="block text-xs text-ink-faint">{t("publicHint")}</span>
        </span>
        <span
          aria-hidden
          className={cn(
            "relative h-[26px] w-[44px] shrink-0 rounded-full transition-colors duration-200",
            isPublic ? "bg-holo-cyan" : "bg-surface-overlay ring-1 ring-inset ring-surface-border"
          )}
        >
          <span
            className={cn(
              "absolute top-[3px] h-5 w-5 rounded-full transition-[left,background-color] duration-200",
              isPublic ? "left-[21px] bg-[#04211e]" : "left-[3px] bg-ink-faint"
            )}
          />
        </span>
      </button>

      {confirmDelete && (
        <p className="mt-4 text-sm text-ink-muted" role="alert">
          {t("deleteExplain", { count: portfolio?.itemCount ?? 0 })}
        </p>
      )}
    </BottomSheet>
  );
}
