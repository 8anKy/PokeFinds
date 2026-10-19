/**
 * Skapar Pro-priserna för planerna 2026-10-19 i Stripe (idempotent på lookup key):
 *   • scoutr_pro_monthly_59 — 59 kr/mån, månadsplanen för NYA kunder
 *   • scoutr_pro_commit_39  — 39 kr/mån, 12-månadersplanen (bindningen sköts av webhooken)
 *
 * Båda på SAMMA produkt som det gamla 49 kr-priset (läses ur STRIPE_PRICE_ID_PRO_MONTHLY),
 * moms-INKLUSIVA som det gamla. ⛔ Det gamla priset arkiveras INTE — befintliga
 * prenumerationer ligger kvar på det (ägarbeslut: de behåller 49 kr).
 *
 * Kollar också kundportalen: uppsägning måste vara "at_period_end" — en omedelbar
 * uppsägning hade avslutat en 12-månadersplan innan webhooken hann flytta den.
 *
 * Kör (nyckeln injiceras som env, aldrig på kommandoraden):
 *   railway run npx tsx scripts/stripe-create-pro-prices.ts          # torrkörning
 *   railway run npx tsx scripts/stripe-create-pro-prices.ts --apply
 * Sätt sedan STRIPE_PRICE_ID_PRO_MONTHLY / STRIPE_PRICE_ID_PRO_COMMIT i Railway till id:na.
 */
import Stripe from "stripe";

const apply = process.argv.includes("--apply");
const key = process.env.STRIPE_SECRET_KEY;
const oldPriceId = process.env.STRIPE_PRICE_ID_PRO_MONTHLY;
if (!key || !oldPriceId) {
  console.error("STRIPE_SECRET_KEY och STRIPE_PRICE_ID_PRO_MONTHLY måste finnas i miljön.");
  process.exit(1);
}
const stripe = new Stripe(key);

const WANTED = [
  { lookup: "scoutr_pro_monthly_59", amount: 5_900, nickname: "Pro månadsvis 59 kr", env: "STRIPE_PRICE_ID_PRO_MONTHLY" },
  { lookup: "scoutr_pro_commit_39", amount: 3_900, nickname: "Pro 12 månader 39 kr/mån", env: "STRIPE_PRICE_ID_PRO_COMMIT" },
] as const;

async function main() {
  console.log(`Läge: ${key!.startsWith("sk_live") ? "LIVE" : "TEST"}${apply ? "" : " (torrkörning)"}`);
  const old = await stripe.prices.retrieve(oldPriceId!);
  const product = typeof old.product === "string" ? old.product : old.product.id;
  console.log(`Nuvarande pris ${old.id}: ${(old.unit_amount ?? 0) / 100} ${old.currency}, produkt ${product}, tax_behavior ${old.tax_behavior}`);

  const existing = await stripe.prices.list({ lookup_keys: WANTED.map((w) => w.lookup), limit: 10 });
  for (const w of WANTED) {
    const found = existing.data.find((p) => p.lookup_key === w.lookup);
    if (found) {
      console.log(`${w.env}=${found.id}  (finns redan, ${(found.unit_amount ?? 0) / 100} kr)`);
      continue;
    }
    if (!apply) {
      console.log(`skulle skapa ${w.lookup}: ${w.amount / 100} kr/mån på ${product}`);
      continue;
    }
    const created = await stripe.prices.create({
      product,
      currency: "sek",
      unit_amount: w.amount,
      recurring: { interval: "month" },
      tax_behavior: "inclusive",
      lookup_key: w.lookup,
      nickname: w.nickname,
    });
    console.log(`${w.env}=${created.id}  (skapad)`);
  }

  const portals = await stripe.billingPortal.configurations.list({ is_default: true, limit: 1 });
  const cancel = portals.data[0]?.features.subscription_cancel;
  console.log(
    `Kundportalen: uppsägning ${cancel?.enabled ? "på" : "av"}, läge ${cancel?.mode ?? "?"}` +
      (cancel?.enabled && cancel.mode !== "at_period_end" ? "  ⛔ MÅSTE vara at_period_end" : "")
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
