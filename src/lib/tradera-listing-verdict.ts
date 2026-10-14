/**
 * TRADERA-KONTROLLENS REGELDOM UTAN AI (2026-10-14, ägarbeslut) — de handskrivna reglerna i ETT anrop.
 * Ett skäl = annonsen fälls; null = ingen regel invänder. MÄTT mot 2 146 par (≈ 725 handgranskade):
 * fångar ~84 % av de dåliga och fäller ~1 % av de goda; LLM:en fällde 13 % av de goda på öppna annonser
 * (mest danska/norska annonser — språket spelar ingen roll, ägarbeslut). Körs i SKUGGLÄGE bredvid LLM:en
 * (TraderaMatch.ruleOk) tills scripts/tradera-rule-shadow-report.ts visar att den håller på nya annonser.
 * ⛔ En regel läggs bara till efter mätning mot facit — en bred regel döljer äkta annonser för alla.
 */
import { sealedListingProblem } from "@/lib/tradera-sealed-rules";
import { listingProductProblem, listingWholeProblem } from "@/lib/tradera-listing-rules";
import { characterNames } from "@/scrapers/matching";
import { listingContradiction } from "@/lib/tradera-listing-contradictions";

export interface RuleInput {
  catalogTitle: string;
  catalogCategory: string;
  listingTitle: string;
  description: string | null | undefined;
  catalogLanguage?: string | null;
}

export function traderaRuleVerdict(x: RuleInput, setNames: readonly string[] = []): string | null {
  return (
    listingProductProblem(x.catalogTitle, x.catalogCategory, x.listingTitle) ??
    sealedListingProblem(x.listingTitle, x.description) ??
    listingWholeProblem(x.catalogTitle, x.catalogCategory, x.listingTitle, x.description, characterNames, x.catalogLanguage) ??
    listingContradiction(x.catalogTitle, x.catalogCategory, x.listingTitle, x.description, setNames)
  );
}
