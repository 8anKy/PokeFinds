/**
 * Stryker next-intls `NEXT_LOCALE`-cookie ur SVARET för de begäranden som ändå
 * aldrig kan ha nytta av den, så att Railways edge-cache får lagra svaret.
 *
 * **VARFÖR NÅGOT ATT STRYKA ÖVER HUVUD TAGET.** next-intls `syncCookie` sätter
 * cookien när språkförhandlingen inte redan pekar på den upplösta localen. Utan
 * `Accept-Language` blir den förhandlingen `undefined` — Negotiator returnerar
 * `["*"]` och `@formatjs/intl-localematcher` KASTAR på `"*"` ("Invalid language
 * tag"), next-intl fångar och ger upp. `undefined !== "sv"` ⇒ `Set-Cookie:
 * NEXT_LOCALE=sv` skrivs.
 *
 * ⚠️ **DEN GRENEN NÅS BARA NÄR BEGÄRAN SAKNAR COOKIEN.** `syncCookie` frågar
 * efter `NEXT_LOCALE` FÖRST och rör aldrig `Accept-Language` när cookien redan
 * finns och stämmer. En webbläsare utan headern får alltså skrivningen EN gång
 * och sedan aldrig mer — det är klienter som inte SPARAR cookies (crawlers,
 * `curl`) som får den om och om igen, och det är exakt den trafiken som annars
 * aldrig kan edge-cachas. Läs inte stycket som att varje människa betalar en
 * `Set-Cookie` per sidvisning; gör man det ser vinsten mångdubbelt större ut.
 *
 * **MÄTT I PRODUKTION.** Ett svar som bär `Set-Cookie` lagras aldrig av Railways
 * edge-cache: två raka begäranden UTAN `Accept-Language` gav båda `x-cache:
 * DYNAMIC`, och med cookien undertryckt blev begäran 2 `x-cache: HIT`.
 *
 * ⛔ **DEN HÄR ÄNDRINGEN SPARAR INGEN NEON-TID — KREDITERA DEN ALDRIG MED EN
 * DATABASBESPARING.** `x-nextjs-cache` gick redan MISS→HIT på egen hand i samma
 * mätning: Next:s ISR-cache bryr sig inte om `Set-Cookie`, så DB-väckningen var
 * redan bortcachad och ingen Neon-compute stod någonsin på spel. Vinsten är
 * Railway-CPU och egress (ett edge-cachat svar passerar aldrig Node) — inget mer.
 * Kostnadsdoktrinen räknar väckningar, och det här flyttar noll väckningar.
 *
 * ⛔ **INGEN NY CACHE-VARIANT SKAPAS — DET ÄR HELA SÄKERHETSARGUMENTET.**
 * next-intl sätter INGEN `Vary`-header, så en cache kan inte skilja svaren åt på
 * språk. Det svar vi gör cachebart är därför medvetet ETT SOM REDAN ÄR
 * CACHEBART: en svensk webbläsare på `/marknad` får redan idag inget
 * `Set-Cookie` (förhandlingen ger `sv`, vilket är den upplösta localen), och en
 * engelsk webbläsare på `/en/marknad` likaså. Vi lägger alltså till fler
 * PRODUCENTER av en cache-post som redan finns, inte en ny post. Hade vi strukit
 * cookien i ett läge som ger ett annat svar än det redan cachade vore det
 * cache-förgiftning.
 *
 * ⛔ **VI RADERAR ALDRIG NÅGONS SPRÅKVAL.** Det som stryks är ett `Set-Cookie` i
 * ett svar; en cookie som redan ligger i webbläsaren är oåtkomlig härifrån.
 * Språkväljaren skriver dessutom `NEXT_LOCALE` själv från klienten
 * (`locale-switcher.tsx`) just för att inte vara beroende av den här synken.
 */

/** Namnet next-intl använder. Speglas av `locale-switcher.tsx` (klientsidan). */
export const LOCALE_COOKIE_NAME = "NEXT_LOCALE";

/**
 * Ren dom: ska `NEXT_LOCALE` strykas ur det här svaret?
 *
 * ⛔ **SESSIONSKOLLEN LIGGER HÄR, INTE BARA I MIDDLEWARES KONTROLLFLÖDE.** "En
 * inloggad påverkas aldrig" ska vara en egenskap som går att testa utan
 * Request/Response, inte något som råkar följa av var anropet står. Middleware
 * är autentiseringens kritiska väg — en omflyttad rad får inte kunna ändra
 * innebörden.
 *
 * ⛔ **`ACCEPT-LANGUAGE` ÄR GRINDEN, INTE UA-STRÄNGEN.** Varje riktig webbläsare
 * skickar headern, så mänskligt beteende är bevisligen oförändrat; crawlers och
 * `curl` utelämnar den ofta. En bot-lista hade varit färskvara (se
 * `blocked-bots.ts`) — det här villkoret åldras inte.
 *
 * ⚠️ Värsta tänkbara utfall om en människa ändå saknar headern: next-intl slutar
 * MINNAS ett språkval åt henne. Sidan renderas likadant (utan cookie faller
 * upplösningen tillbaka på URL-prefixet, annars `defaultLocale`), och
 * språkväljaren fortsätter fungera eftersom den skriver cookien själv.
 */
export function shouldDropLocaleCookie(
  acceptLanguage: string | null | undefined,
  hasSessionCookie: boolean
): boolean {
  if (hasSessionCookie) return false;
  return !acceptLanguage || acceptLanguage.trim() === "";
}

/**
 * Namnet i en `Set-Cookie`-sträng, dvs allt före första `=` i första paret.
 * Ren funktion så namnjämförelsen går att testa mot verkliga strängar
 * (`NEXT_LOCALE=sv; Path=/; SameSite=lax`).
 */
export function setCookieName(setCookieHeader: string): string {
  const pair = setCookieHeader.split(";", 1)[0] ?? "";
  const eq = pair.indexOf("=");
  return (eq === -1 ? pair : pair.slice(0, eq)).trim();
}

/**
 * Tar bort ETT namngivet `Set-Cookie` ur svarets headers och lämnar resten intakta.
 *
 * ⛔ **`res.cookies.delete()` DUGER INTE.** Den är i @edge-runtime/cookies exakt
 * `set({ value: "", expires: new Date(0) })` och SÄTTER alltså en utgången
 * cookie (`Expires=Thu, 01 Jan 1970 …`) — ännu ett `Set-Cookie`, precis det som
 * gör svaret ocachebart — och den hade dessutom raderat en riktig användares
 * språkval.
 *
 * ⛔ **FILTRERA PÅ NAMN, ALDRIG "TÖM HEADERN".** `fo_auth`-rättelsen
 * (`syncAuthHint`) och kreatörscookien (`captureCreatorRef`) ligger i samma
 * header och MÅSTE överleva — båda kodar var sin dokumenterad incident.
 *
 * ⛔ **MÅSTE VARA SISTA STEGET PÅ SVARET.** `ResponseCookies` har en intern karta
 * som vi inte rör; ett senare `res.cookies.set(...)` bygger om hela headern ur
 * den och tar då tillbaka den strukna cookien.
 *
 * ⚠️ `x-middleware-set-cookie` lämnas orörd MED FLIT. Next tar bort den headern
 * innan svaret går ut på tråden (`send-response`), så den påverkar inte
 * edge-cachen alls; enda effekten är att `cookies()` under renderingen ser
 * `NEXT_LOCALE`. Ingenting i appen läser den på servern — språket kommer ur
 * `[locale]`-segmentet — och att skriva om en kommaskarvad header är precis den
 * sortens strängpillande man inte vill ha i middleware.
 */
export function dropSetCookie(headers: Headers, name: string): void {
  // Saknas `getSetCookie` i den här runtimen finns inget säkert sätt att dela upp
  // flera cookies ur en enda sträng → gör ingenting. Det här är en ren
  // prestandaoptimering; att gissa fel vore ett fel i autentiseringens väg.
  if (typeof headers.getSetCookie !== "function") return;

  const all = headers.getSetCookie();
  const kept = all.filter((c) => setCookieName(c) !== name);
  if (kept.length === all.length) return; // inget att göra — rör inte headern

  headers.delete("set-cookie");
  for (const cookie of kept) headers.append("set-cookie", cookie);
}
