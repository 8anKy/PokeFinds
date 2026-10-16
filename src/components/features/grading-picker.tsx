"use client";

import { useTranslations } from "next-intl";
import { cn } from "@/lib/utils";
import { COLLECTION_GRADING_ISSUERS, gradesForCollectionIssuer, gradingPayload as payloadOf } from "@/lib/graded-slab";

export interface GradingValue {
  /** "" = ograderat. Samlingens vokabulär (Traderas + SGC/TAG), se lib/graded-slab.ts. */
  gradingCompany: string;
  grade: string;
}

/**
 * Bolag + betyg som chips — EN väljare för exemplararket och tilläggsarken
 * ("+"-arket, produktsidan), så att samma kort graderas likadant var man än
 * lägger in det. ⛔ Ett bolag utan betyg är ingen gradering: anroparen skickar
 * bara båda (`gradingPayload`). Byte till ett bolag som inte sätter det valda
 * betyget (PSA 9.5) nollar betyget.
 */
export function GradingPicker({
  value,
  onChange,
  size = "md",
}: {
  value: GradingValue;
  onChange: (next: GradingValue) => void;
  size?: "sm" | "md";
}) {
  const t = useTranslations("GradingPicker");
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <GradingChip size={size} active={!value.gradingCompany} onClick={() => onChange({ gradingCompany: "", grade: "" })}>
          {t("none")}
        </GradingChip>
        {COLLECTION_GRADING_ISSUERS.map((issuer) => (
          <GradingChip
            key={issuer}
            size={size}
            active={value.gradingCompany === issuer}
            onClick={() =>
              onChange({
                gradingCompany: issuer,
                grade: gradesForCollectionIssuer(issuer).includes(value.grade) ? value.grade : "",
              })
            }
          >
            {issuer}
          </GradingChip>
        ))}
      </div>
      {value.gradingCompany && (
        <>
          <p className="mb-2 mt-3 text-xs text-ink-muted">{t("grade")}</p>
          <div className="flex flex-wrap gap-2">
            {gradesForCollectionIssuer(value.gradingCompany).map((g) => (
              <GradingChip key={g} size={size} active={value.grade === g} onClick={() => onChange({ ...value, grade: g })}>
                {g}
              </GradingChip>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

/** Bara när BÅDE bolag och betyg är valda — annars inget alls i API-anropet. */
export function gradingPayload(v: GradingValue): { gradingCompany?: string; grade?: string } {
  return payloadOf(v.gradingCompany, v.grade);
}

function GradingChip({
  active,
  onClick,
  size,
  children,
}: {
  active: boolean;
  onClick: () => void;
  size: "sm" | "md";
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "rounded-full font-semibold transition-colors",
        size === "sm" ? "px-3 py-1.5 text-[13px]" : "px-3.5 py-2 text-sm",
        active ? "bg-holo-cyan text-surface" : "bg-surface-overlay text-ink-muted hover:text-ink"
      )}
    >
      {children}
    </button>
  );
}
