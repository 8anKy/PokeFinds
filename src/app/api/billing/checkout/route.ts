import { apiError, jsonOk } from "@/lib/api";
import { requireUser } from "@/lib/auth";
import { prisma, withDbRetry } from "@/lib/db";
import { ServiceError } from "@/lib/errors";
import { legalEntity } from "@/lib/legal-entity";
import { rateLimit } from "@/lib/rate-limit";
import { automaticTaxEnabled, getStripe } from "@/lib/stripe";
import { checkoutPromotionCodeFor } from "@/services/creator-codes";

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

    // Kom användaren in via en kreatörslänk vars kod har ett Stripe promotion code
    // förifylls rabatten, annars visas den vanliga "har du en rabattkod?"-rutan.
    //
    // ⛔ `discounts` och `allow_promotion_codes` UTESLUTER VARANDRA i Stripe
    // Checkout — skickas båda felar hela anropet och köpknappen dör. Därför ETT av
    // dem, aldrig båda.
    //
    // ⚠️ Rabatten gäller BARA webben. Native köper via App Store/Google Play, som
    // har sina egna rabattsystem — en iOS-användare med kreatörskod betalar fullt
    // pris i app:en. Skicka kreatörstrafiken till webben (den är dessutom
    // billigare för oss än butikernas provision).
    const promotionCodeId = await checkoutPromotionCodeFor(user.id);

    const buildSession = (discountId: string | null) =>
      stripe.checkout.sessions.create({
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
        ...(discountId
          ? { discounts: [{ promotion_code: discountId }] }
          : { allow_promotion_codes: true }),
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
            // ⛔ Måste säga SAMMA sak som villkorens ångerrättsavsnitt. Modellen är
            // den proportionella (digital TJÄNST, den försiktigare tolkningen av
            // distansavtalslagen): ångerrätten försvinner inte helt vid omedelbar
            // leverans, men den som ångrar sig betalar för nyttjad tid. Den gamla
            // texten ("ångerrätten upphör") var innehålls-modellen — håller den
            // inte rättsligt hade kunden BEHÅLLIT full ångerrätt, vilket är sämre
            // för oss än att lova pro rata. Se villkoren avsnitt 12 + jurist-TODO.
            message:
              "Foilio Pro levereras direkt. Genom att godkänna samtycker du till att leveransen påbörjas under ångerfristen; ångrar du dig inom 14 dagar betalar du för den tid du haft tillgång och får resten åter.",
          },
        },
        success_url: `${appUrl}/priser?checkout=klar&session_id={CHECKOUT_SESSION_ID}`,
        cancel_url: `${appUrl}/priser?checkout=avbruten`,
      });

    // ⛔ EN UTGÅNGEN RABATTKOD FÅR ALDRIG DÖDA KÖPKNAPPEN. Ett promotion code blir
    // PERMANENT inaktivt när det passerar `expires_at` eller `max_redemptions`
    // (Stripes egen formulering) — och det är själva POÄNGEN med en kampanj som
    // tar slut. Skickar vi då `discounts` med ett dött id felar HELA anropet, så
    // alla kreatörsvärvade användare hade mött en trasig uppgradering i stället
    // för bara ett uteblivet avdrag. Tyst, och bara för dem.
    //
    // Vi speglar därför INTE Stripes kampanjstatus i vår databas (två sanningar
    // som glider isär) utan gör om försöket utan rabatt. Faller även det andra
    // försöket är felet något annat än koden — då kastas det vidare som vanligt.
    let checkout;
    try {
      checkout = await buildSession(promotionCodeId);
    } catch (stripeError) {
      if (!promotionCodeId) throw stripeError;
      console.warn(
        `[billing] Rabattkoden ${promotionCodeId} nekades av Stripe (troligen utgången kampanj) — kassan öppnas till fullt pris.`,
        stripeError
      );
      checkout = await buildSession(null);
    }

    if (!checkout.url) throw new ServiceError(502, "Stripe gav ingen betalningslänk.");
    return jsonOk({ url: checkout.url });
  } catch (e) {
    return apiError(e);
  }
}
