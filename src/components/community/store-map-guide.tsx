"use client";
/**
 * "SÅ FUNKAR KARTAN" — tre rader om hur man delar butiksstatus (2026-10-05).
 * Visas själv FÖRSTA gången kartan öppnas på enheten, sedan via "?" på kartan.
 * ⛔ Kort med flit: en förklaring, inte en grind — inget steg, ingen tur.
 */
import { useTranslations } from "next-intl";
import type { ReactNode } from "react";
import { BottomSheet, BottomSheetCta } from "@/components/ui/bottom-sheet";
import { IconSearch, IconPlus, IconClock } from "@/components/ui/icons";

const SEEN_KEY = "foilio:store-map-guide:v1";

/** Fel-säkert: kastar lagringen ⇒ "sett" (visa inte igen och igen). */
export function storeMapGuideSeen(): boolean {
  try {
    return window.localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return true;
  }
}

export function markStoreMapGuideSeen(): void {
  try {
    window.localStorage.setItem(SEEN_KEY, "1");
  } catch {
    // Blockerad lagring — guiden visas då nästa gång, vilket är ofarligt.
  }
}

export function StoreMapGuide({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations("LocalStores.guide");
  return (
    <BottomSheet
      open={open}
      title={t("title")}
      onClose={onClose}
      closeLabel={t("cta")}
      panelClassName="sm:mx-auto sm:max-w-md"
      footer={<BottomSheetCta onClick={onClose}>{t("cta")}</BottomSheetCta>}
    >
      <ol className="flex flex-col gap-3">
        <Row icon={<IconSearch size={18} />}>{t("find")}</Row>
        <Row icon={<IconPlus size={18} />} accent>{t("share")}</Row>
        <Row icon={<IconClock size={18} />}>{t("fresh")}</Row>
      </ol>
    </BottomSheet>
  );
}

function Row({ icon, accent, children }: { icon: ReactNode; accent?: boolean; children: ReactNode }) {
  return (
    <li className="flex items-start gap-3 rounded-xl border border-surface-border bg-surface p-3">
      <span className={accent ? "mt-0.5 shrink-0 text-holo-cyan" : "mt-0.5 shrink-0 text-ink-faint"}>{icon}</span>
      <span className="text-sm leading-snug text-ink">{children}</span>
    </li>
  );
}
