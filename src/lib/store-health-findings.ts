/**
 * Persistens för butiks-hälsokollens fynd (store-health.yml → /admin/halsokoll).
 *
 * Bakgrund 2026-08-31: hälsokollen hade varit röd TRE måndagar i rad (195 säkra
 * länkfel, 6 underpris-offers) utan att ägaren sett det — backloggen levde bara i
 * Actions-loggen, och adminpanelen var "ren". Det här är spegeln: varje rapportskript
 * skriver sina fynd hit så att /admin/halsokoll visar samma backlog som loggen.
 *
 * ⛔ RAPPORTSKRIPTEN ÄR LÄS-ONLY AV KONTRAKT (audit-links utan --prune "skriver
 *    INGENTING"). Persistensen gatas därför på STORE_HEALTH_DB=1, som BARA sätts i
 *    store-health.yml — en lokal körning av samma skript förblir skrivfri.
 *
 * ⛔ VARJE SKRIPT ERSÄTTER SIN EGEN SEKTION, i en transaktion. Tabellen håller alltid
 *    SENASTE körningens backlog — en tom sektion skrivs också, det är så "fixat"
 *    blir synligt i admin. Historik = Actions-loggen, aldrig den här tabellen.
 *
 * ⛔ SKRIVNINGEN ÄR BEST-EFFORT: loggen är fortfarande facit. Ett DB-fel här får
 *    inte dölja rapportens eget utfall (exit-koden är larmmekanismen), så felet
 *    loggas som ::warning:: och sväljs.
 */
import type { PrismaClient } from "@prisma/client";

export type HealthSeverity = "DEFINITE" | "REVIEW" | "INFO";

export interface HealthFindingInput {
  severity: HealthSeverity;
  title: string;
  detail?: string | null;
  url?: string | null;
  offerId?: string | null;
  productSlug?: string | null;
  retailer?: string | null;
}

/** Sektionsnycklar + adminvyns copy, i visningsordning. */
export const HEALTH_SECTIONS = {
  STORE_ADAPTER: {
    label: "Döda butiksadaptrar",
    blurb:
      "Butiker vars adapter gav 0 produkter. AVVISAR = brandvägg (rör inte adaptern); annars har butiken troligen bytt plattform/HTML.",
    canDeleteOffer: false,
  },
  UNDERPRICE: {
    label: "Tradera-underpris (förgiftar priset)",
    blurb:
      "Tradera-offers under 15 % av CM-priset = falskt/spelat/öppnat ex. Radera-knappen kör hela purge-receptet (dom på annons-id + förgiftade observationer).",
    canDeleteOffer: true,
  },
  LINK_DEFINITE: {
    label: "Säkra länkfel",
    blurb:
      "Butikslänkar som bevisligen pekar fel (vakt motsäger sidan, blockerat språk). Döda länkar (404) rensas automatiskt av nästa veckokörning — radera dem inte härifrån.",
    canDeleteOffer: true,
  },
  LINK_REVIEW: {
    label: "Länkar att granska",
    blurb:
      "Sidans titel avviker utan att någon vakt slår till — öppna länken och avgör själv. Radera bara vid bekräftat fel (raderingen denylistar URL:en permanent).",
    canDeleteOffer: true,
  },
  GTIN_CONFLICT: {
    label: "Motstridiga streckkoder",
    blurb:
      "Produkter vars offers bär OLIKA streckkoder — minst en butikslänk är fel. Granska i Länkfel-fliken (filtrerad vy med kvittering).",
    canDeleteOffer: false,
  },
  GTIN_CLASH: {
    label: "Vakt-krock (merga aldrig)",
    blurb:
      "Streckkoden säger \"samma produkt\", en titelvakt säger emot. Vanligast: butiken säljer ett sortiment under en kod. Alltid människa.",
    canDeleteOffer: false,
  },
  GTIN_DUPE: {
    label: "Säkra dubblettgrupper",
    blurb: "Olika katalogprodukter, samma streckkod, ingen vakt protesterar — merge-kandidater.",
    canDeleteOffer: false,
  },
  CM_SINGLE_LINK: {
    label: "Sealed → singel-länk",
    blurb:
      "Sealed-produkter vars CM-offer pekar på ett enstaka kort/ogiltigt idProduct. Repeka till rätt sealed-id — radera inte (receptet i loggen).",
    canDeleteOffer: false,
  },
  CM_MISMATCH: {
    label: "CM-länk med låg namnlikhet",
    blurb: "Informativ: kan innehålla falska positiva (generiska/reprint-namn). Granska och repeka bekräftade fel.",
    canDeleteOffer: false,
  },
  DEDUPE_PROPOSAL: {
    label: "Dubblettförslag (stub-dedup)",
    blurb: "LLM:en sa \"samma SKU\" men ordmängdsvakten protesterade — mergas aldrig automatiskt.",
    canDeleteOffer: false,
  },
  LINK_EMPTIED: {
    label: "Produkter utan butikslänk",
    blurb: "Auto-rensningen tog sista butikslänken — produkten visar inget pris. Rätt utfall, men ska vara känt.",
    canDeleteOffer: false,
  },
  LINK_REFUSED: {
    label: "Butiker som avvisar oss",
    blurb:
      "Butikens brandvägg sa nej till Actions-IP:n — länkarna är INTE döda och revideras inte. Verifiera från annan IP innan något rörs.",
    canDeleteOffer: false,
  },
} as const;

export type HealthSection = keyof typeof HEALTH_SECTIONS;

/**
 * KVITTERING ("fyndet är fel — offern är korrekt"). Nyckeln måste överleva veckans
 * omskrivning av fyndraderna (nya cuid varje körning): offer-id när det finns,
 * annars titeln. Sektionen ingår med flit — en granska-länk som kvitterats och
 * SENARE dör hamnar i en annan sektion, matchar inte nyckeln och återuppstår.
 */
export function healthAckKey(section: string, f: { offerId?: string | null; title: string }): string {
  return `${section}:${f.offerId ?? f.title}`;
}

/**
 * Läser alla kvitteringsnycklar. Best-effort med flit: rapportskripten ska fungera
 * mot en dev-databas som inte migrerats än — då finns inga kvitteringar, inte ett fel.
 */
export async function loadHealthAckKeys(prisma: PrismaClient): Promise<Set<string>> {
  try {
    const rows = await prisma.storeHealthAck.findMany({ select: { key: true } });
    return new Set(rows.map((r) => r.key));
  } catch {
    return new Set();
  }
}

/** Tak per sektion — adminvyn är en arbetslista, inte en dump; loggen har alltid allt. */
const MAX_ROWS = 400;

export function storeHealthDbEnabled(): boolean {
  return process.env.STORE_HEALTH_DB === "1";
}

export async function replaceHealthSection(
  prisma: PrismaClient,
  section: HealthSection,
  rows: HealthFindingInput[]
): Promise<void> {
  if (!storeHealthDbEnabled()) return;
  const data = rows.slice(0, MAX_ROWS).map((r) => ({
    section,
    severity: r.severity,
    title: r.title.slice(0, 300),
    detail: r.detail ? r.detail.slice(0, 500) : null,
    url: r.url ? r.url.slice(0, 500) : null,
    offerId: r.offerId ?? null,
    productSlug: r.productSlug ?? null,
    retailer: r.retailer ?? null,
  }));
  try {
    await prisma.$transaction([
      prisma.storeHealthFinding.deleteMany({ where: { section } }),
      ...(data.length > 0 ? [prisma.storeHealthFinding.createMany({ data })] : []),
    ]);
    console.log(`[halsokoll→db] ${section}: ${data.length} fynd skrivna${rows.length > MAX_ROWS ? ` (kapade från ${rows.length})` : ""}.`);
  } catch (e) {
    // Best-effort: loggen är facit, exit-koden är larmet — dölj inget bakom ett DB-fel.
    console.log(`::warning::[halsokoll→db] kunde inte skriva ${section}: ${e instanceof Error ? e.message : e}`);
  }
}
