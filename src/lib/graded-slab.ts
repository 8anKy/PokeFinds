/**
 * GRADERADE KORT I SAMLINGEN — slabben och dess etikett (ägarbeslut 2026-10-15).
 *
 * Samlingen har burit `gradingCompany` + `grade` per post sedan säljarket kom
 * (Traderas vokabulär, fritext i databasen). Den här modulen gör om de två
 * strängarna till NÅGOT VI KAN RÄKNA OCH RITA: vårt normaliserade bolag
 * (`GradingIssuer`, samma som GradedSale/GradedAsk är nyckelade på) och betyget i
 * tiondelar. REN — inga React-/DB-beroenden, testad i `graded-slab.test.ts`.
 *
 * ⛔ Bolag UTAN betyg (eller betyg utan bolag) är ingen gradering — `null`.
 *    Samma regel som exemplararket skriver med.
 * ⛔ `OTHER` ("Övriga") ritas som en slab men har inget graderat värde: ett
 *    okänt bolags 10 är inte jämförbart med PSA:s (samma skäl som karusellen
 *    döljer "Annat bolag", 2026-10-12).
 */
import type { GradingIssuer } from "@/lib/graded-listing";

/**
 * Bolagen exemplararket erbjuder. Lagras som de står här (fritext i DB):
 * Traderas fem + SGC och TAG, som Tradera saknar ("Övriga" i en annons —
 * `traderaGradingIssuer` översätter redan dit) men som är vanliga i Sverige.
 * "Beckett" heter så för att en senare Tradera-annons ska kunna bära ordet rakt av.
 */
export const COLLECTION_GRADING_ISSUERS = [
  "PSA",
  "Beckett",
  "CGC",
  "SGC",
  "TAG",
  "ACE",
  "Raukcard",
  "Övriga",
] as const;

/** Betygen exemplararket erbjuder — Traderas skala (`GRADES`), högst först. */
const ALL_GRADES = ["10", "9.5", "9", "8.5", "8", "7", "6", "5", "4", "3", "2", "1"] as const;

/**
 * Betygen ett bolag faktiskt sätter. ⛔ PSA har INGET 9.5 (halvsteg finns bara
 * 1.5–8.5) — mätt 2026-10-15 låg en "PSA 9.5" i en samling, en slab som inte
 * finns. Övriga bolag använder halvsteg genom hela skalan och får hela listan.
 */
export function gradesForCollectionIssuer(company: string | null | undefined): readonly string[] {
  return normalizeCollectionIssuer(company) === "PSA" ? ALL_GRADES.filter((g) => g !== "9.5") : ALL_GRADES;
}

/** Samlingens fritext → vårt normaliserade bolag. Tomt ⇒ null, okänt ⇒ OTHER. */
const ISSUER_MAP: Record<string, GradingIssuer> = {
  psa: "PSA",
  beckett: "BGS",
  bgs: "BGS",
  bvg: "BGS",
  cgc: "CGC",
  sgc: "SGC",
  tag: "TAG",
  ace: "ACE",
  raukcard: "RAUKCARD",
  rauk: "RAUKCARD",
  hga: "HGA",
  gma: "GMA",
  isa: "ISA",
  ags: "AGS",
  gg: "GG",
  globalgrading: "GG",
};

export function normalizeCollectionIssuer(company: string | null | undefined): GradingIssuer | null {
  const key = (company ?? "").trim().toLowerCase().replace(/\s+/g, "");
  if (!key) return null;
  return ISSUER_MAP[key] ?? "OTHER";
}

/** "9.5" / "9,5" / "10" → tiondelar (95/100). Bara hela och halva steg 1–10. */
export function parseCollectionGrade(grade: string | null | undefined): number | null {
  const v = (grade ?? "").trim().replace(",", ".");
  if (!/^\d+(?:\.\d+)?$/.test(v)) return null;
  const tenths = Math.round(parseFloat(v) * 10);
  if (tenths < 10 || tenths > 100 || tenths % 5 !== 0) return null;
  return tenths;
}

export interface CollectionGrading {
  issuer: GradingIssuer;
  gradeTenths: number;
}

/** Postens gradering, eller null när den inte är (fullständigt) graderad. */
export function collectionGrading(
  company: string | null | undefined,
  grade: string | null | undefined
): CollectionGrading | null {
  const issuer = normalizeCollectionIssuer(company);
  const gradeTenths = parseCollectionGrade(grade);
  if (!issuer || gradeTenths == null) return null;
  return { issuer, gradeTenths };
}

/**
 * ETIKETTENS BETYGSORD per bolag — orden bolagen själva trycker vid betyget.
 * Okänt (bolag, betyg) ⇒ null, och etiketten visar då bara siffran: hellre inget
 * ord än ett påhittat. Bolag vi inte känner skalan för får den generiska listan.
 */
const PSA_WORDS: Record<number, string> = {
  100: "GEM MT", 90: "MINT", 85: "NM-MT+", 80: "NM-MT", 75: "NM+", 70: "NM", 65: "EX-MT+", 60: "EX-MT",
  55: "EX+", 50: "EX", 45: "VG-EX+", 40: "VG-EX", 35: "VG+", 30: "VG", 25: "GOOD+", 20: "GOOD", 15: "FR", 10: "PR",
};
const BGS_WORDS: Record<number, string> = {
  100: "PRISTINE", 95: "GEM MINT", 90: "MINT", 85: "NM-MT+", 80: "NM-MT", 75: "NEAR MINT+", 70: "NEAR MINT",
  65: "EX-MT+", 60: "EX-MT", 55: "EX+", 50: "EX", 45: "VG-EX+", 40: "VG-EX", 35: "VG+", 30: "VG",
  25: "GOOD+", 20: "GOOD", 15: "FAIR", 10: "POOR",
};
const CGC_WORDS: Record<number, string> = {
  100: "GEM MINT", 95: "MINT+", 90: "MINT", 85: "NM/MINT+", 80: "NM/MINT", 75: "NM+", 70: "NM",
  65: "EX/NM+", 60: "EX/NM", 55: "EX+", 50: "EX", 45: "VG/EX+", 40: "VG/EX", 35: "VG+", 30: "VG",
  25: "GOOD+", 20: "GOOD", 15: "FAIR", 10: "POOR",
};
const SGC_WORDS: Record<number, string> = {
  ...CGC_WORDS,
  85: "NM/MT+",
  80: "NM/MT",
};
const GENERIC_WORDS: Record<number, string> = {
  100: "GEM MINT", 95: "MINT+", 90: "MINT", 85: "NM-MT+", 80: "NM-MT", 70: "NM", 60: "EX-MT", 50: "EX",
  40: "VG-EX", 30: "VG", 20: "GOOD", 10: "POOR",
};

const WORDS: Partial<Record<GradingIssuer, Record<number, string>>> = {
  PSA: PSA_WORDS,
  BGS: BGS_WORDS,
  CGC: CGC_WORDS,
  SGC: SGC_WORDS,
};

export function gradeWord(issuer: GradingIssuer, gradeTenths: number): string | null {
  return (WORDS[issuer] ?? GENERIC_WORDS)[gradeTenths] ?? null;
}

/** "10" / "9.5" — betyget som etiketten trycker det. */
export function gradeNumber(gradeTenths: number): string {
  return gradeTenths % 10 === 0 ? String(gradeTenths / 10) : (gradeTenths / 10).toFixed(1);
}
