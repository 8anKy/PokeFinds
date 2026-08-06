import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma, withDbRetry } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { legalEntity } from "@/lib/legal-entity";
import { rateLimit } from "@/lib/rate-limit";
import { automaticTaxEnabled, getStripe } from "@/lib/stripe";

export const dynamic = "force-dynamic";

/**
 * Startar ett Stripe Checkout — webbens väg till Pro.
 *
 * ⛔ Bara webben. Native köper via RevenueCat (Apple tillåter inte egen checkout
 * för digitala varor i app:en); grinden sitter i upgrade-button.tsx, som bara
 * anropar den här routen i `!native`-grenen.
 */
export async function POST() {
  try {
    const sessionUser = await requireUser();

    // Varje session skapar en Stripe-kund och en Checkout-session. Utan broms
    // kan ett kapat konto fylla vårt Stripe-konto med skräpkunder.
    const limit = await rateLimit(`billing-checkout:${sessionUser.id}`, 10, 60 * 60_000);
    if (!limit.ok) {
      throw new ServiceError(429, "För många försök. Vänta en stund och prova igen.");
    }

    const priceId = process.env.STRIPE_PRICE_ID_PRO_MONTHLY;
    const appUrl = process.env.NEXT_PUBLIC_APP_URL;
    if (!priceId || !appUrl) {
      throw new ServiceError(503, "Betalning är inte färdigkonfigurerad.");
    }

    // ⛔ SÄLJ INTE UTAN SÄLJARIDENTITET. E-handelslagen 8 § kräver att namn,
    // adress och momsreg.nr är publicerade — och /villkor renderar det blocket
    // BARA när uppgifterna är kompletta. Utan den här grinden hade en glömd
    // miljövariabel gett en fullt fungerande kassa på en sajt som inte säger vem
    // som säljer. Hellre en trasig köpknapp än ett olagligt avtal.
    if (!legalEntity()) {
      throw new ServiceError(503, "Betalning är inte färdigkonfigurerad.");
    }

    const user = await withDbRetry(() =>
      prisma.user.findUnique({
        where: { id: sessionUser.id },
        select: {
          id: true,
          email: true,
          name: true,
          planTier: true,
          stripeCustomerId: true,
          stripeProUntil: true,
        },
      })
    );
    if (!user) throw new ServiceError(404, "Kontot hittades inte.");

    // Blockera DUBBELDEBITERING, inte "har redan förmånerna". En admin är Pro via
    // sin roll utan att betala något och ska kunna teckna ett riktigt abonnemang;
    // den som redan betalar — via Apple (planTier) eller via oss (stripeProUntil)
    // — ska inte kunna göra det två gånger.
    if (user.planTier === "PREMIUM") {
      throw new ServiceError(409, "Du har redan Pro via appen. Hantera den i App Store.");
    }
    if (user.stripeProUntil && user.stripeProUntil.getTime() > Date.now()) {
      throw new ServiceError(409, "Du har redan en aktiv prenumeration.");
    }

    const stripe = getStripe();

    // Återanvänd kunden om den finns — annars får samma person en ny Stripe-kund
    // per köpförsök, och kvitton/portal splittras över flera kundposter.
    let customerId = user.stripeCustomerId;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: user.name,
        metadata: { userId: user.id },
      });
      customerId = customer.id;
      await withDbRetry(() =>
        prisma.user.updateMany({
          where: { id: user.id },
          data: { stripeCustomerId: customerId },
        })
      );
    }

    const checkout = await stripe.checkout.sessions.create({
      mode: "subscription",
      customer: customerId,
      line_items: [{ price: priceId, quantity: 1 }],
      // Identiteten bärs på TVÅ ställen med flit: `client_reference_id` räddar
      // checkout.session.completed innan någon stripeCustomerId hunnit sparas,
      // och metadatan följer med prenumerationen genom ALLA senare event.
      client_reference_id: user.id,
      subscription_data: { metadata: { userId: user.id } },
      // Stripe Tax: räknar och tar ut moms automatiskt. ⛔ Måste vara aktiverat
      // på KONTOT — annars felar hela anropet och köpknappen dör (inte bara
      // momsen). Se automaticTaxEnabled(); default AV.
      automatic_tax: { enabled: automaticTaxEnabled() },
      // Adressen krävs av Stripe Tax för att kunna bestämma momssats, och är
      // ändå rimlig att ha på ett kvitto. `customer_update` är OBLIGATORISK när
      // automatic_tax kombineras med en BEFINTLIG kund — utan den vägrar Stripe
      // skriva adressen till kunden och anropet felar.
      billing_address_collection: "required",
      customer_update: { address: "auto", name: "auto" },
      allow_promotion_codes: true,
      locale: "sv",
      // ⛔ ÅNGERRÄTTEN KRÄVER BÅDE SAMTYCKE OCH INFORMATION. Distansavtalslagen
      // 2 kap.: ångerrätten för en digital tjänst upphör när leveransen påbörjats
      // — men bara om kunden UTTRYCKLIGEN samtyckt OCH fått veta att rätten går
      // förlorad. Kryssrutan här är samtycket, /villkor § 11 är informationen.
      // Saknas endera håller inte avståendet, och kunden kan ångra köpet efter
      // att ha använt tjänsten.
      // ⚠️ `terms_of_service: "required"` kräver att en villkors-URL är satt i
      // Stripes Checkout-inställningar — utan den felar anropet.
      consent_collection: { terms_of_service: "required" },
      custom_text: {
        terms_of_service_acceptance: {
          message:
            "Foilio Pro levereras direkt. Genom att godkänna samtycker du till att leveransen påbörjas omedelbart och att din ångerrätt därmed upphör.",
        },
      },
      success_url: `${appUrl}/priser?checkout=klar&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${appUrl}/priser?checkout=avbruten`,
    });

    if (!checkout.url) throw new ServiceError(502, "Stripe gav ingen betalningslänk.");
    return jsonOk({ url: checkout.url });
  } catch (e) {
    return apiError(e);
  }
}
