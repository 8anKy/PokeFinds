/**
 * LANSERINGSSPAKEN FÖR NYHETER & EVENEMANG (2026-09-09).
 *
 * Ytan är byggd men INTE färdig (ägarbeslut) — den ska inte gå att nå av någon
 * förrän ägaren säger till. Spaken stänger tre saker samtidigt, och alla tre
 * behövs: knappen i headern (annars syns vägen dit), sidorna själva (annars når
 * en gissad URL fram ändå) och sitemapen (annars bjuder vi in Google till en
 * sida vi själva kallar oavslutad — och den stämpeln sitter kvar på URL:en långt
 * efter att sidan blivit bra).
 *
 * PÅ = `NEWS_FEED_PUBLIC=1` i Railway. ⛔ Värdet BAKAS IN VID BYGGET (speglas till
 * `NEXT_PUBLIC_NEWS_FEED_PUBLIC` i next.config.mjs och måste därför också stå som
 * `ARG` + `ENV` i Dockerfile) — samma fälla som RESTOCK_ALERTS_PAUSED gick i
 * 2026-09-06, där rutten var påslagen men copyn fortfarande sa "pausat".
 * Ett påslag kräver alltså en ny deploy, inte bara en variabel.
 *
 * ⛔ INGEN `auth()`, ingen databas: funktionen används i headern, som renderas i
 *    rot-nära layouter — allt sådant hade gjort HELA appen dynamisk (ISR-regeln).
 * ⛔ Default är DOLT. En osatt variabel ska aldrig kunna släppa ut något halvfärdigt.
 *
 * Jobben (`news-feed.yml`, steget i `scrape-all`) fortsätter fylla flödet medan
 * det är dolt — det är meningen: när spaken slås på ska innehållet redan finnas
 * där, inte byggas upp inför öppna ögon.
 */
export function newsFeedPublic(): boolean {
  return process.env.NEXT_PUBLIC_NEWS_FEED_PUBLIC === "1";
}
