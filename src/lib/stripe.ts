/**
 * Stripe-klienten — webbens betalväg. Native (Capacitor) köper via RevenueCat och
 * rör ALDRIG den här modulen: Apple förbjuder egen checkout för digitala varor
 * i app:en, så `purchasesAvailable()` i upgrade-button.tsx är gränsen.
 */
import Stripe from "stripe";
import { ServiceError } from "@/lib/errors";

let client: Stripe | null = null;

/**
 * Betalning påslagen? `STRIPE_ENABLED` är en egen spak vid sidan av nyckeln så
 * att en felkonfigurerad prod inte börjar ta betalt av misstag — och så att
 * checkout kan stängas av utan att nycklarna rensas.
 */
export function stripeEnabled(): boolean {
  return process.env.STRIPE_ENABLED === "true" && !!process.env.STRIPE_SECRET_KEY;
}

/**
 * ⛔ LAT med flit. En `new Stripe(...)` på modulnivå körs redan när Next
 * BYGGER routen, och Railway bygger i en container utan runtime-env → bygget
 * hade kraschat på en saknad nyckel. Ingen nyckel ska betyda "betalning
 * avstängd", aldrig "appen går inte att bygga".
 */
export function getStripe(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!stripeEnabled() || !key) {
    throw new ServiceError(503, "Betalning är inte tillgänglig just nu.");
  }
  if (!client) {
    // apiVersion utelämnad → SDK:ns egen pinning. Att skriva en egen sträng här
    // låser fältformen (se subscriptionPeriodEnd) till en version vi inte testat.
    client = new Stripe(key, { maxNetworkRetries: 2, typescript: true });
  }
  return client;
}

/**
 * Ska Stripe räkna och ta ut moms åt oss (Stripe Tax)?
 *
 * ⛔ ÄGARBESLUT 2026-08-06: NEJ. Momsen redovisas manuellt. EN produkt, ETT pris,
 * ETT land ⇒ talet är konstant (49 kr = 39,20 netto + 9,80 moms, varje gång), och
 * Stripe Tax kostar 0,5 % per transaktion för att automatisera just den
 * aritmetiken. Priset är moms-INKLUSIVT, så kunden betalar 49 kr oavsett.
 *
 * ⚠️ Att inte använda Stripe Tax betyder INTE att momsen försvinner — bolaget är
 * momsregistrerat och 25 % på digitala tjänster till svenska konsumenter är
 * lagkrav. Skillnaden är bara vem som räknar. (Att App Store "inte tar moms" är
 * en synvilla: Apple är merchant of record och redovisar den åt oss. Stripe är
 * det INTE — där är vi säljare och momsen är vår.)
 *
 * ⏭️ Ompröva vid 10 000 EUR/år i EU-försäljning UTANFÖR Sverige: under tröskeln
 * får svensk sats tas ut även på EU-kunder, över den krävs kundlandets sats via
 * OSS — och då tjänar Stripe Tax in sina 0,5 %.
 *
 * ⛔ Sätt inte `true` "för säkerhets skull": `automatic_tax` mot ett konto utan
 * aktiverade skatteregistreringar får HELA checkout-anropet att fela, dvs varenda
 * köpknapp dör — inte bara momsen.
 */
export function automaticTaxEnabled(): boolean {
  return process.env.STRIPE_AUTOMATIC_TAX === "true";
}

/**
 * Prenumerationens periodslut, i sekunder.
 *
 * ⛔ LÄS ALDRIG `subscription.current_period_end` — fältet FINNS INTE på
 * Subscription-objektet i den API-version SDK:n (v22) pinnar. Det flyttade till
 * SubscriptionItem (`items.data[].current_period_end`), och en läsning på
 * toppnivån ger `undefined` → ingen får någonsin Pro, tyst och bara i drift.
 * Verifierat mot node_modules/stripe: 0 träffar i Subscription-objektet,
 * 1 i SubscriptionItem.
 *
 * Vi tar det SENASTE slutet över alla poster (en prenumeration kan bära flera)
 * och faller tillbaka på toppnivåfältet ifall någon pinnar en äldre version.
 */
export function subscriptionPeriodEnd(sub: Stripe.Subscription): number | null {
  const ends = (sub.items?.data ?? [])
    .map((item) => item.current_period_end)
    .filter((n): n is number => typeof n === "number" && n > 0);
  if (ends.length > 0) return Math.max(...ends);
  const legacy = (sub as unknown as { current_period_end?: number }).current_period_end;
  return typeof legacy === "number" && legacy > 0 ? legacy : null;
}
