/**
 * BEVISET BREDVID ANMÄLAN (2026-11-24, ägaren: "hur verifierar jag anmälningarna enkelt?").
 *
 * En anmälan säger bara "fel produkt" / "slut i lager". Det som avgör den finns redan hos oss:
 * butikens EGEN titel för sidan (huvudboken), vad vi visar just nu och när vi senast såg sidan.
 * Adminsidan visar dem sida vid sida, och den här domen säger rakt ut när svaret redan är givet.
 * Ren funktion — den föreslår, admin avgör. Okänt ⇒ null (aldrig en gissning).
 */
import { boosterBoxCountMismatch } from "@/scrapers/matching";

export interface LinkReportFacts {
  reason: string;
  /** Offerns lagerstatus hos oss nu. */
  stockStatus: string;
  /** Butikens egen titel för sidan, om vi har den. */
  storeTitle: string | null;
  productTitle: string;
  gtinMismatch: boolean;
}

export interface LinkReportHint {
  text: string;
  /** resolved = anmälan är redan inaktuell · wrong = länken är bevisat fel · check = titta själv */
  tone: "resolved" | "wrong" | "check";
}

const BUYABLE = new Set(["IN_STOCK", "LIMITED", "PREORDER"]);

export function linkReportHint(f: LinkReportFacts): LinkReportHint | null {
  if (f.gtinMismatch) return { text: "Streckkoderna skiljer sig — länken är fel.", tone: "wrong" };
  if (f.storeTitle && boosterBoxCountMismatch(f.storeTitle, f.productTitle.toLowerCase())) {
    return { text: "Butiken säljer en annan storlek (halvbox/annat antal paket) än produkten — länken är fel.", tone: "wrong" };
  }
  if (f.reason === "OUT_OF_STOCK") {
    return BUYABLE.has(f.stockStatus)
      ? { text: "Vi visar den fortfarande som köpbar — öppna butikens sida och jämför.", tone: "check" }
      : { text: "Står redan som slut hos oss — anmälan är inaktuell.", tone: "resolved" };
  }
  if (f.reason === "WRONG_PRODUCT") {
    return f.storeTitle
      ? { text: "Jämför butikens titel med vår produkt.", tone: "check" }
      : { text: "Butikens titel saknas hos oss — öppna sidan.", tone: "check" };
  }
  return null;
}
