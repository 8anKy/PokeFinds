"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Link, usePathname } from "@/i18n/navigation";
import { LinkButton } from "@/components/ui/button";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { ProHoloCard } from "@/components/features/pro-holo-card";
import { UpgradeButton } from "@/components/features/upgrade-button";
import {
  registerPaywallOpen,
  type PaywallCardPreview,
  type PaywallPreview,
  type PaywallSlabPreview,
} from "@/lib/paywall";
import { IconLock } from "@/components/ui/icons";
import { formatPrice } from "@/lib/format";
import { ProBullets, ProPlanPicker, usePlanCopy, useProPlans } from "@/components/features/pro-plan-picker";
import type { ProPlanChoice } from "@/lib/pro-plans";
import { GradedSlab } from "@/components/features/graded-slab";
import { ISSUER_LABELS, type GradingIssuer } from "@/lib/graded-listing";
import { gradeNumber } from "@/lib/graded-slab";
import { hasAuthHint } from "@/lib/auth-hint";
import { getSharedSession } from "@/lib/client-session";
import { onOverlayElevationChange, overlayIsElevated } from "@/lib/product-overlay-open";
import { restockAlertsPausedClient } from "@/lib/restock-alerts-pause";

/**
 * Paywall-arket — Pro-kortet, det du låser upp och köpknappen, i ett bottenark
 * över den vy användaren står i. Monteras EN gång i rot-layouten och öppnas
 * imperativt via `openPaywall()` (lib/paywall.ts) från varje Pro-låst yta.
 *
 * ⛔ Arket ÄR INTE en andra paywall. Köpknappen är samma `UpgradeButton` som på
 * `/priser` (Apple/Google i appen, Stripe på webben, aldrig tvärtom), och raderna
 * kommer ur samma `Pricing.specRows*` med samma pausflaggor — så en avstängd
 * larmfunktion kan inte säljas här och glömmas där. Förnyelsevillkoret och båda de
 * legala länkarna står vid knappen även här (Apple 3.1.2 gäller varje köpställe).
 *
 * `webCheckout` kommer från servern (rot-layouten läser `stripeCheckoutAdvertised()`)
 * av samma skäl som på prissidan: en egen NEXT_PUBLIC_-flagga hade blivit en andra
 * sanning om huruvida det går att betala.
 *
 * Innehållet renderas BARA när arket är öppet: UpgradeButton bär en effekt som
 * hanterar återkomsten från Stripe (`?checkout=klar`) och den ska köras av sidans
 * instans, inte av ett stängt ark i rot-layouten.
 */
export function PaywallSheetHost({
  webCheckout,
  webYearPlan = false,
}: {
  webCheckout: boolean;
  /** Stripe-priset för 12-månadersplanen finns (rot-layouten läser env). */
  webYearPlan?: boolean;
}) {
  const [open, setOpen] = useState(false);
  /**
   * Vilket ark som ska upp. ⛔ VALET GÖRS HÄR, INTE HOS ANROPAREN: varje Pro-låst
   * yta (grafens MAX, Tradera-chippet, set-bevakningen, skannerns bulkläge …)
   * anropar `openPaywall()` utan att veta vem som tittar, och får ändå rätt
   * prompt. Lägger man domen hos anroparen glöms den på det ställe som byggs näst.
   *
   * Hinten läses SYNKRONT så arket öppnar direkt, och bekräftas sedan mot den
   * delade sessionen: `fo_auth` sätts med 30 dygns max-age men WebKit kapar
   * JS-skrivna cookies till 7 (incidenten 2026-08-06), så en inloggad kan sakna
   * hint — och en utloggad flik kan ha kvar en. Bekräftelsen rättar båda hållen,
   * och kostar inget extra i praktiken: `getSharedSession` är sidans delade,
   * DB-fria hämtning och är oftast redan besvarad.
   */
  const [variant, setVariant] = useState<"pro" | "signup">("pro");
  const [preview, setPreview] = useState<PaywallPreview | null>(null);
  const [source, setSource] = useState<string | null>(null);
  // Skannern är fixed z-[60] över hela appen; öppnas arket därifrån måste det
  // lyftas över den — samma mekanism som produkt-overlayn (registerFullscreenHost).
  const [elevated, setElevated] = useState(false);

  useEffect(() => {
    setElevated(overlayIsElevated());
    return onOverlayElevationChange(setElevated);
  }, []);

  useEffect(() => {
    let alive = true;
    registerPaywallOpen((opts) => {
      const forced = opts?.mode;
      setVariant(forced ?? (hasAuthHint() ? "pro" : "signup"));
      setPreview(opts?.preview ?? null);
      setSource(opts?.source ?? null);
      setOpen(true);
      if (forced) return;
      void getSharedSession().then((session) => {
        if (alive) setVariant(session?.user ? "pro" : "signup");
      });
    });
    return () => {
      alive = false;
      registerPaywallOpen(null);
    };
  }, []);

  if (!open) return null;
  if (variant === "signup") return <SignupSheet onClose={() => setOpen(false)} elevated={elevated} />;
  return (
    <PaywallSheet
      onClose={() => setOpen(false)}
      webCheckout={webCheckout}
      webYearPlan={webYearPlan}
      elevated={elevated}
      preview={preview}
      source={source}
    />
  );
}

/**
 * Kontoarket — samma gest och samma ram som paywallen, men det ber om ett KONTO.
 *
 * ⛔ Ingen prislapp, ingen köpknapp och inget Pro-kort: den som inte har ett konto
 * har inte sett produkten än, och en prenumerationsprompt som första möte är att
 * ta betalt för något man inte fått prova. Pro nämns ändå i EN dämpad rad — annars
 * hade arket antytt att ett gratiskonto låser upp Tradera-kurvan och hela
 * historiken, och det gör det inte.
 *
 * "Jag har redan ett konto" står kvar även om hinten sa "utloggad": den kan vara
 * fel (se värden ovan), och då måste det finnas en väg vidare som inte är att
 * skapa ett andra konto.
 */
function SignupSheet({ onClose, elevated }: { onClose: () => void; elevated: boolean }) {
  const t = useTranslations("Paywall");
  const pathname = usePathname();
  // Tillbaka till exakt den produkt man stod på — annars är kontot skapat och
  // kurvan man ville se borta.
  const back = encodeURIComponent(pathname || "/produkter");

  return (
    <BottomSheet
      open
      title={t("signupTitle")}
      onClose={onClose}
      closeLabel={t("close")}
      elevated={elevated}
      panelClassName="sm:mx-auto sm:mb-6 sm:w-full sm:max-w-md sm:rounded-[20px]"
      footer={
        <>
          <LinkButton href={`/registrera?callbackUrl=${back}`} className="w-full justify-center">
            {t("signupCreate")}
          </LinkButton>
          <LinkButton
            href={`/logga-in?callbackUrl=${back}`}
            variant="outline"
            className="mt-2 w-full justify-center"
          >
            {t("signupLogin")}
          </LinkButton>
          <button
            type="button"
            onClick={onClose}
            className="mt-1.5 w-full py-2 text-center text-sm text-ink-faint transition-colors hover:text-ink-muted"
          >
            {t("notNow")}
          </button>
        </>
      }
    >
      <div className="pb-2 pt-1">
        <p className="text-sm leading-relaxed text-ink-muted">{t("signupLead")}</p>
        <p className="mt-3 border-t border-surface-border pt-3 text-[13px] leading-relaxed text-ink-faint">
          {t("signupProNote")}
        </p>
      </div>
    </BottomSheet>
  );
}

/** Rubriken följer prompten man tryckte på — arket säljer det man just ville ha. */
function headlineKey(source: string | null, preview: PaywallPreview | null): string {
  if (preview?.kind === "card" || preview?.kind === "slab") return "headlineSold";
  if (source?.startsWith("chart") || source === "graded") return "headlineSold";
  if (source?.startsWith("scan")) return "headlineScan";
  if (source?.includes("restock") || source?.includes("watch") || source?.includes("alert")) return "headlineAlerts";
  return "headlineDefault";
}

/**
 * PRO-ARKET, design "A+" (ägarbeslut 2026-10-19): kortet man stod på (eller slabben,
 * eller Pro-kortet), en rubrik efter prompten, tre rader, planvalet (12 månader
 * förvalt) och EN knapp. Hela jämförelsen bor på /priser ("Jämför allt").
 *
 * ⛔ Villkorsraden vid knappen följer vald plan och plattform (Apple 3.1.2: pris,
 * period, förnyelse) — samma text som checkoutens samtycke på webben.
 * ⛔ Restock-raden följer pausflaggan, som spec-raderna gör.
 */
function PaywallSheet({
  onClose,
  webCheckout,
  webYearPlan,
  elevated,
  preview,
  source,
}: {
  onClose: () => void;
  webCheckout: boolean;
  webYearPlan: boolean;
  elevated: boolean;
  preview: PaywallPreview | null;
  source: string | null;
}) {
  const t = useTranslations("Paywall");
  const tp = useTranslations("Pricing");
  const plans = useProPlans(webCheckout && webYearPlan);
  const [choice, setChoice] = useState<ProPlanChoice>("year");
  // Ingen årsplan (gammal app, butiken svarar inte, Stripe-priset saknas) ⇒ månad.
  const effective: ProPlanChoice = plans.year ? choice : "month";
  const { cta, note } = usePlanCopy(plans, effective);
  const bullets: [string, string][] = [[t("bulletSoldTitle"), t("bulletSoldBody")]];
  if (!restockAlertsPausedClient()) bullets.push([t("bulletRestockTitle"), t("bulletRestockBody")]);
  bullets.push([t("bulletScanTitle"), t("bulletScanBody")]);

  return (
    <BottomSheet
      open
      title={t("title")}
      onClose={onClose}
      closeLabel={t("close")}
      elevated={elevated}
      // Desktop: ett ark som spänner hela fönsterbredden läser som en banner, inte
      // som en dialog. Centrerat och kortsmalt från sm: — mobilen är orörd.
      panelClassName="sm:mx-auto sm:mb-6 sm:w-full sm:max-w-md sm:rounded-[20px]"
      footer={
        <>
          <UpgradeButton webCheckout={webCheckout} compact plan={effective} label={cta} tone="light" />
          {!plans.pro && (
            <p className="mt-2.5 text-center text-[11px] leading-snug text-ink-faint">
              {note ?? tp("subRenewNote")}
            </p>
          )}
          <p className="mt-1.5 flex flex-wrap items-center justify-center gap-x-2 text-[11px] text-ink-muted">
            <Link href="/priser" onClick={onClose} className="underline underline-offset-2 hover:text-ink">
              {t("compareAll")}
            </Link>
            <span aria-hidden="true" className="text-ink-faint">
              ·
            </span>
            <Link href="/villkor" onClick={onClose} className="underline underline-offset-2 hover:text-ink">
              {tp("legalTerms")}
            </Link>
            <span aria-hidden="true" className="text-ink-faint">
              ·
            </span>
            <Link href="/integritetspolicy" onClick={onClose} className="underline underline-offset-2 hover:text-ink">
              {tp("legalPrivacy")}
            </Link>
          </p>
          <button
            type="button"
            onClick={onClose}
            className="mt-1.5 w-full py-2 text-center text-sm text-ink-faint transition-colors hover:text-ink-muted"
          >
            {t("notNow")}
          </button>
        </>
      }
    >
      <div className="flex flex-col items-center pb-2 pt-1">
        {preview?.kind === "slab" ? (
          <SlabPreview preview={preview} />
        ) : preview?.kind === "card" ? (
          <CardPreview preview={preview} />
        ) : (
          <ProHoloCard size="compact" showHint={false} />
        )}
        <p className="mt-5 w-full text-left font-display text-[22px] font-bold leading-tight tracking-tight text-ink">
          {t(headlineKey(source, preview))}
        </p>
        <ProBullets items={bullets} className="mt-3.5" />
        {plans.year && plans.month ? (
          <div className="mt-5 w-full">
            <ProPlanPicker plans={plans} choice={effective} onChoose={setChoice} />
          </div>
        ) : plans.ready && !plans.store && !plans.pro ? (
          <p className="mt-5 w-full text-left font-display text-lg font-bold text-ink">{tp("heroPrice")}</p>
        ) : null}
      </div>
    </BottomSheet>
  );
}

/**
 * KORTET MAN STOD PÅ (A+): bild, namn, set, priset man redan såg — och de låsta
 * raderna i turkos med lås. ⛔ Den suddiga siffran är en PLATSHÅLLARE ("0 000 kr"),
 * aldrig det riktiga talet: det når aldrig klienten utan Pro.
 */
function CardPreview({ preview }: { preview: PaywallCardPreview }) {
  const t = useTranslations("Paywall");
  const locked = [t("lockedTradera"), ...(preview.graded ? [t("lockedGraded")] : [])];
  return (
    <div className="flex w-full gap-3.5 rounded-2xl border border-surface-border p-3">
      <div className="h-[118px] w-[84px] shrink-0 overflow-hidden rounded-md bg-surface-overlay">
        {preview.imageUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={preview.imageUrl} alt="" className="h-full w-full object-contain" loading="eager" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col justify-center">
        <p className="truncate text-[15px] font-semibold text-ink">{preview.name}</p>
        {preview.setName && <p className="truncate text-xs text-ink-muted">{preview.setName}</p>}
        <div className="mt-2.5 flex flex-col gap-1.5 text-[13px]">
          <div className="flex items-center justify-between gap-2">
            <span className="text-ink-muted">{t("cardPriceNow")}</span>
            <span className="font-semibold text-ink">
              {preview.priceOre != null ? formatPrice(preview.priceOre) : "–"}
            </span>
          </div>
          {locked.map((label) => (
            <div key={label} className="flex items-center justify-between gap-2">
              <span className="font-medium text-holo-cyan">{label}</span>
              <span className="flex items-center gap-1.5" aria-label={t("lockedValue")}>
                <IconLock aria-hidden="true" className="h-3 w-3 text-holo-cyan" />
                <span aria-hidden="true" className="select-none font-semibold text-ink blur-[5px]">
                  0 000 kr
                </span>
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * FÖRHANDSVISNINGEN (ägarbeslut 2026-10-15): gratiskontot som graderar ett kort ser
 * sitt EGET kort i sin slab — det är precis det Pro ger dem. Värdet står LÅST: vi
 * visar inte ett tal vi bara ger Pro, och vi hittar inte på ett.
 */
function SlabPreview({ preview }: { preview: PaywallSlabPreview }) {
  const t = useTranslations("Paywall");
  const issuer = preview.issuer as GradingIssuer;
  const grading = `${ISSUER_LABELS[issuer] ?? preview.issuer} ${gradeNumber(preview.gradeTenths)}`;
  return (
    <div className="flex flex-col items-center">
      <div className="h-[230px]">
        <GradedSlab imageUrl={preview.imageUrl} issuer={issuer} gradeTenths={preview.gradeTenths} alt={preview.name} />
      </div>
      <p className="mt-4 max-w-[18rem] truncate text-center text-sm font-semibold text-ink">{preview.name}</p>
      <p className="mt-1 text-center text-xs text-ink-muted">{t("slabValueLocked", { grading })}</p>
    </div>
  );
}
