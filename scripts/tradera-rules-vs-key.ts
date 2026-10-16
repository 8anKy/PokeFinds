/** Tradera-reglerna mot facit (LLM-domen rättad med det handgranskade facit), bara föreslagna par.
 *   npx tsx scripts/tradera-rules-vs-key.ts        (SHOW=1 listar felträffarna)
 * Kräver .spike/tradera-eval/ (gitignorerat; byggs av scripts/tradera-eval-build.ts). Kör FÖRE varje ny regel. */
import fs from "node:fs";
import path from "node:path";
import { sealedListingProblem } from "../src/lib/tradera-sealed-rules";
import { listingProductProblem, listingWholeProblem } from "../src/lib/tradera-listing-rules";
import { listingContradiction } from "../src/lib/tradera-listing-contradictions";
const SETS: string[] = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".spike", "tradera-eval", "set-names.json"), "utf8"));
import { characterNames } from "../src/scrapers/matching";
const R = path.join(process.cwd(), ".spike", "tradera-eval");
const data: any[] = JSON.parse(fs.readFileSync(path.join(R, "train.json"), "utf8"));
const key: Record<string, boolean> = JSON.parse(fs.readFileSync(path.join(R, "answer-key.json"), "utf8"));
let tp = 0, fp = 0, fn = 0, tn = 0;
const flags: Record<number, string> = {};
const by: Record<string, [number, number]> = {};
data.forEach((d, i) => {
  if (!d.proposed) return;
  const ok = key[i] ?? d.ok;
  const why = listingProductProblem(d.catalogTitle, d.catalogCategory, d.listingTitle) ?? sealedListingProblem(d.listingTitle, d.description) ?? listingWholeProblem(d.catalogTitle, d.catalogCategory, d.listingTitle, d.description, characterNames, d.catalogLanguage) ?? listingContradiction(d.catalogTitle, d.catalogCategory, d.listingTitle, d.description, SETS);
  if (why) {
    flags[i] = why;
    const k = why.split(" (")[0].split(" ≠")[0];
    if (ok && process.env.SHOW) console.log(`FALSE #${i} ${why} :: ${d.catalogTitle} <- ${d.listingTitle} || ${String(d.description).replace(/<[^>]+>/g," ").slice(0,140)}`);
    by[k] ??= [0, 0];
    if (!ok) { tp++; by[k][0]++; } else { fp++; by[k][1]++; }
  } else if (!ok) fn++; else tn++;
});
console.log(`reglerna: fäller ${tp + fp} · rätt ${tp} · fel ${fp} (av ${fp + tn} OK = ${(100 * fp / (fp + tn)).toFixed(1)} %) · fångar ${tp}/${tp + fn} dåliga (${(100 * tp / (tp + fn)).toFixed(1)} %)`);
console.log("per regel [rätt, fel]:", JSON.stringify(by));

fs.writeFileSync(path.join(R, "rule-flags.json"), JSON.stringify(flags));
