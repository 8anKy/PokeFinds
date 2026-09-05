/**
 * SERVERFEL PÅ RÄTT SPRÅK (2026-09-05).
 *
 * Tjänsterna kastar `ServiceError` med svensk text — ~130 ställen. Att ge varje
 * kast en kod vore en veckas arbete för ett problem som bara syns i /en/: en
 * engelsk användare fick "Tråden hittades inte." i ett engelskt gränssnitt.
 * I stället slår `apiError` upp den SVENSKA texten här och får en nyckel i
 * `ApiErrors`-namnrymden; på engelska översätts den, på svenska returneras
 * originalet orört. En text som inte finns i tabellen (dynamiska belopp,
 * ovanliga fel) går ut som den är — hellre svenska än en rå nyckel.
 *
 * ⛔ Nyckeln är också API-svarets `code` när ingen explicit kod satts, så att
 * klienter kan reagera på den utan att tolka text. Lägg till rader här när en
 * ny användarvänd text tillkommer; testet vaktar att varje nyckel finns i
 * BÅDA språkfilerna.
 */
export const API_ERROR_KEYS: Record<string, string> = {
  // auth
  "Du måste vara inloggad.": "loginRequired",
  "Du saknar behörighet.": "forbidden",
  "Användaren hittades inte.": "userNotFound",
  "Användarnamnet är upptaget. Välj ett annat.": "usernameTaken",
  // generic (apiError)
  "Posten finns redan.": "alreadyExists",
  "Posten hittades inte.": "notFound",
  "Ogiltig indata.": "invalidInput",
  "Något gick fel. Försök igen.": "internal",
  "Hittades inte.": "notFound",
  "Tom förfrågan.": "emptyRequest",
  "Ogiltig JSON.": "invalidJson",
  // forum
  "Tråden hittades inte.": "threadNotFound",
  "Tråden är ingen annons.": "notAListing",
  "Du får inte ändra annonsens status.": "listingStatusForbidden",
  "Du får inte ta bort den här tråden.": "deleteForbidden",
  "Rapporten hittades inte.": "reportNotFound",
  "Gruppen hittades inte.": "groupNotFound",
  "Ogiltig bildnyckel.": "invalidImageKey",
  "Produkten hittades inte.": "productNotFound",
  "Godkänn forumets regler innan du skriver.": "forumRules",
  "Inlägget innehåller ord som inte är tillåtna i forumet. Ändra texten och försök igen.": "profanityPost",
  "Svaret innehåller ord som inte är tillåtna i forumet. Ändra texten och försök igen.": "profanityReply",
  "Du har skapat för många trådar på kort tid. Försök igen om en stund.": "rateLimitPosts",
  "Du har svarat för många gånger på kort tid. Försök igen om en stund.": "rateLimitComments",
  "Du har rapporterat för många trådar på kort tid. Försök igen om en stund.": "rateLimitReports",
  "Bilduppladdning är inte tillgänglig just nu.": "uploadUnavailable",
  "Du har laddat upp för många bilder. Försök igen om en stund.": "rateLimitUploads",
  "Ingen bild skickades.": "noImage",
  "Bilden är för stor (max 2 MB efter nedskalning).": "imageTooLarge",
  "Bara JPEG, PNG och WebP kan laddas upp.": "imageType",
  "Bildens filtyp stämmer inte med innehållet.": "imageTypeMismatch",
  // listing rules
  "Köp/sälj/byt-fält kan bara användas i marknadsgruppen.": "listingOnlyMarket",
  "Välj om tråden är Säljes, Köpes eller Bytes.": "listingKindRequired",
  "Okänd annonstyp.": "listingKindUnknown",
  "Priset måste vara ett positivt belopp.": "listingPricePositive",
  "Priset är orimligt högt — kontrollera beloppet.": "listingPriceTooHigh",
  "Ange ett pris för det du säljer.": "listingPriceRequired",
  "En bytesannons har inget pris — vill du sälja, välj Säljes.": "listingTradeNoPrice",
  "Okänt skick.": "listingConditionUnknown",
  "Tradera-länken måste börja med https://www.tradera.com/.": "listingTraderaUrl",
  // chat
  "Du kan inte skicka meddelanden till dig själv.": "chatSelf",
  "Det går inte att skicka meddelanden till den här användaren.": "chatBlocked",
  "Du har startat många nya samtal idag. Försök igen i morgon.": "chatNewLimit",
  "Samtalet hittades inte.": "conversationNotFound",
  "Kontot du skrev med är raderat.": "chatOtherDeleted",
  "Det går inte att skicka meddelanden i det här samtalet.": "chatConversationBlocked",
  "Lugn — du skickar för snabbt. Vänta en minut.": "chatSendLimit",
  "Meddelandet saknas.": "chatMessageMissing",
  "Skriv något först.": "chatMessageEmpty",
  "Det är din egen samling.": "askOwnCollection",
  "Samlingen är inte offentlig.": "askNotPublic",
  "Ägaren tar inte emot köpförfrågningar.": "askOptedOut",
  "Objektet finns inte i samlingen.": "askItemMissing",
  "Du har skickat många köpförfrågningar. Vänta en stund.": "askRateLimit",
  "Du kan inte blockera dig själv.": "blockSelf",
  // watchlist / sets / collection
  "Produkten finns redan i din bevakningslista.": "watchExists",
  "Bevakningen hittades inte.": "watchNotFound",
  "Setet hittades inte.": "setNotFound",
  "Kortet hittades inte.": "cardNotFound",
  "Samlingsobjektet hittades inte.": "collectionItemNotFound",
  "Aviseringen hittades inte.": "alertNotFound",
  "Erbjudandet hittades inte.": "offerNotFound",
  "productId saknas.": "productIdMissing",
  // scanner / grading
  "Bildformatet stöds inte. Använd JPG, PNG, WEBP eller GIF.": "imageFormat",
  "Kunde inte läsa kortdata. Försök igen.": "scanFailed",
  "Kortet kunde inte tolkas. Försök igen.": "scanFailed",
  "För många skanningar på kort tid. Vänta en stund.": "scanRateLimit",
  "För många förfrågningar — vänta en stund.": "rateLimit",
  "För många förfrågningar.": "rateLimit",
  "Bulkskanning är en Pro-funktion.": "bulkPro",
  "Bilden är för stor. Skala ner videorutan innan den skickas.": "scanImageTooLarge",
  "Skanningen hittades inte.": "scanNotFound",
  "Okänt kort.": "unknownCard",
  "Tryckningen hör inte till det valda kortet.": "printingMismatch",
  "För många rapporter på kort tid.": "rateLimitReports",
  "Graderingsleverantör ej konfigurerad.": "gradingUnavailable",
  "Graderingen kunde inte tolkas. Försök igen.": "gradingFailed",
  "För många nya enheter från den här adressen.": "deviceRateLimit",
  // billing / tradera
  "Betalning är inte färdigkonfigurerad.": "billingUnavailable",
  "Betalning är inte tillgänglig just nu.": "billingUnavailable",
  "Du har ingen prenumeration via webben.": "noWebSubscription",
  "För många försök. Vänta en stund och prova igen.": "rateLimit",
  "Kontot hittades inte.": "userNotFound",
  "Du har redan Pro via appen. Hantera den i App Store.": "proViaApp",
  "Du har redan en aktiv prenumeration.": "alreadySubscribed",
  "Stripe gav ingen betalningslänk.": "billingNoLink",
  "Anslut ditt Tradera-konto först (Inställningar).": "traderaConnectFirst",
  "Tradera-kopplingen har gått ut. Anslut kontot igen.": "traderaExpired",
  "Objektet hittades inte i din samling.": "collectionItemNotFound",
  "Discord-koppling är inte tillgänglig just nu.": "discordUnavailable",
  "För många klick. Försök igen om en stund.": "rateLimit",
  "För många anmälningar. Försök igen senare.": "rateLimitReports",
};

export function apiErrorKeyFor(message: string): string | null {
  return API_ERROR_KEYS[message] ?? null;
}
