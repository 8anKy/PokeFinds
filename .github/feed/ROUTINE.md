# Daglig nyhetsrutin — instruktion till molnagenten

Du kör en gång per dygn i ett färskt klon av `8anKy/PokeFinds`. Din uppgift: hitta dagens
Pokémon TCG-nyheter och butikernas släpp-/förbokningsbesked, skriv dem som SVENSKA utkast och
lägg dem i nyhetsinkorgen. **Du publicerar ingenting** — ägaren godkänner varje utkast i
admin. Hela flödet står i `src/lib/feed-inbox.ts`; det här dokumentet är din arbetsordning.

## Vad du letar efter

Två källor, i den här ordningen:

1. **Mejlen (Gmail-kopplingen).** Sök de senaste 3 dygnen (`newer_than:3d`) efter nyhetsbrev från butiker som
   säljer Pokémon TCG (svenska i första hand, europeiska i andra). Leta efter: släppdatum och
   klockslag, förbokningar som öppnar, restock-besked, "kommer snart", exklusiva produkter,
   jubileums-/30th-Anniversary-släpp. Ett mejl som bara är rabattreklam eller inte nämner
   Pokémon TCG är INTE en nyhet.
   - `url` = butikens egen produkt- eller kampanjsida ur mejlet (rensa `utm_*` och andra
     spårningsparametrar; skriptet gör det också). Aldrig en `unsubscribe`- eller
     "visa i webbläsaren"-länk.
   - `source` = butikens namn så som kunder känner den ("Cardshop Sweden", "Goblinen").
   - `category` = `STORE`. `publishedAt` = mejlets datum. `origin` = `email`.
   - Nämner mejlet ett datum/klockslag, skriv det i `summary` ("Förbokning öppnar 26 september
     kl 10.00") och i `note` om det finns osäkerhet.
2. **Webben.** Sök efter Pokémon TCG-nyheter från de senaste **7 dagarna** (`seen`-listan ser
   till att ingenting kommer två gånger, så fönstret får vara brett): nya set och släppdatum,
   officiella tillkännagivanden (pokemon.com, The Pokémon Company), **gradering** (PSA/CGC/
   Beckett — nya tjänster, priser, Europa-etableringar), marknadsnyheter (prisrörelser på kända
   kort, rekordförsäljningar), Play! Pokémon och svenska/nordiska händelser. Föredra primärkällor
   och etablerade TCG-sajter. Hoppa över: tv-spelen (Pokémon GO, Sleep, Unite, Pokopia,
   Switch-titlar), anime, memes, rykten utan källa, listicles ("10 bästa kort…").
   - **Läs artikeln** med WebFetch innan du skriver — brödtexten ska bygga på källan, inte på
     sökresultatets snippet. Blockeras hämtningen (egress-proxy) är det inte ett fel hos dig:
     prova en andra källa för samma nyhet, och arbeta annars ur sökresultatens rubriker, datum
     och beskrivningar. Ett datum som står i sökresultatet räcker som `publishedAt`. Släpp INTE
     en nyhet bara för att sidan inte gick att öppna — PSA:s Europa-etablering 2026-09 var precis
     en sådan och skulle ha blivit ett utkast.
   - Ambitionsnivå: **3–6 utkast** en vanlig dag är rätt. Hittar du bara 1 har du sökt för smalt —
     prova fler sökord (svenska + engelska, "Pokémon TCG" + gradering/PSA/Cardmarket/release/
     preorder/ETB/Play! Pokémon) innan du ger upp.
   - `category`: `RELEASE` för set/produkter som släpps, `MARKET` för priser/gradering/
     marknad, `STORE` för butiksbesked. Aldrig `APP` (den är Foilios egen).
   - `publishedAt` = artikelns datum. `origin` = `web`.
   - `imageUrl`: artikelns egen delningsbild om du kan läsa ut `og:image` ur sidan
     (`curl -sL <url> | grep -o '<meta[^>]*og:image[^>]*>'`). Hittar du ingen, lämna `null` —
     jobbet försöker självt och ägaren kan byta bild i admin.

3. **Evenemang — svenska mässor och kortträffar.** Sök efter kommande Pokémon-/samlarkorts-
   mässor, kortfestivaler och conventions **i Sverige** (Card Expo, Samlarkortfestivalen,
   Pokémonmässan, spelmässor med kortdel, "kortmässa" + stad). **Börja alltid med Ticksters
   Pokémon-tagg: `https://www.tickster.com/se/sv/events/tagged/pokemon`** (WebFetch — där låg
   två kommande evenemang 2026-09-11 som sökningarna missade) och arrangörssidorna
   `https://www.tickster.com/se/sv/p/kongrexum-ab/samlarkort`, `https://www.pokemonmassan.se/`,
   `https://cardexposweden.carrd.co/`. ⛔ `https://samlarkortfestivalen.se/` listar ALLA
   Kongrexums kommande mässor (Norrköping, Birka-kryssningen …) men är JavaScript-renderad —
   WebFetch ger tom sida. Läs i stället undersidorna via sökresultat eller Ticksters
   arrangörssida; hittar du en mässa i sökresultaten men inte på Tickster, skriv utkastet med
   `infoUrl` = `https://samlarkortfestivalen.se/<stad>` och notera vilka fält som saknas. Därefter: arrangörers egna sidor, Billetto, Nortic,
   kommunernas/arenornas evenemangskalendrar. Evenemangets URL i utkastet ska vara Ticksters
   **publika** sida (`www.tickster.com/se/sv/events/<id>`), inte `secure.tickster.com` (den
   kräver session och ger ingen text).
   ⛔ Läs FÖRST `.github/feed/events.json` och hoppa över allt som redan står där (samma namn +
   datum). Ett evenemang som redan passerat, eller ligger mer än ~6 månader fram, hoppar du över.
   ⛔ Bara det som står hos ARRANGÖREN: datum, tider, plats, adress, arrangör, biljettlänk.
   Hitta inte på öppettider eller priser. Utkastet är ett objekt med `kind: "event"`:
   `title`, `category` (`EXPO` mässa · `PRERELEASE` · `TOURNAMENT` · `OTHER`), `startsAt` och
   `endsAt` som ISO **med tidszon** (+02:00 sommartid t.o.m. 2026-10-25, sedan +01:00), `city`,
   `venue`, `address`, `organizer`, `ticketUrl` och/eller `infoUrl` (minst en — den är källan),
   `mapUrl` (valfri, t.ex. Google Maps-sök på adressen), `summary` (1–2 meningar) och `body`.
   **`body` för ett evenemang är en riktig guide, 250–400 ord i 5–7 stycken** — läs arrangörens
   sida, biljettsidan och gärna förra årets upplaga innan du skriver:
   1. inledning: vad det är, var och när, vem som arrangerar, hur många gånger det hållits;
   2. `## Öppettider` — per dag, inklusive VIP-/Priority-insläpp om det finns;
   3. `## Biljetter` — priser per nivå om arrangören anger dem, var de köps, barn/familj,
      om det brukar sälja slut;
   4. `## På plats` — utställare/handlare (namn om listan finns), Trade Zone, gradering på
      plats, turneringar, scenprogram, paköppningar, mat;
   5. `## Hitta dit` — adress, kollektivtrafik/parkering om arrangören skriver det;
   6. `## Bra att veta` — åldersgräns, kontanter/Swish, väskor, vad som gällde förra året.
   Står en uppgift inte hos arrangören, skriv INTE ett stycke om den — hoppa över rubriken
   i stället för att fylla ut. Hellre fyra stycken med fakta än sju med "kontrollera hos
   arrangören". Svenska mässor som redan finns i `events.json` eller i `seen` ger inget nytt
   utkast.

Skriv **högst 8 nyhetsutkast och 4 evenemangsutkast per dag**, hellre 4 bra än 8 halvdana.
Dubbletter mellan källor (samma nyhet hos två sajter) blir ETT utkast med den bästa källan.

## Hur du skriver

- **Svenska.** Rubrik ≤ 90 tecken, saklig, inga utropstecken, inga clickbait-ord. Ingress
  1–2 meningar (≤ 240 tecken) **med egna ord** — återge aldrig artikelns text, och citera inte.
  Ingressen är teasern i listan: vad som händer och när.
- **Brödtext (`body`) — en SAMMANFATTAD ARTIKEL, 300–500 ord i 5–7 stycken.** Posten får en
  egen sida på foilio.se och läsaren ska få hela bilden utan att klicka vidare. **Läs källan
  först** (WebFetch på artikel-URL:en; gärna även en andra källa) och skriv sedan med egna ord:
  1. ett inledande stycke som säger vad som händer och när;
  2. `## `-mellanrubrik + detaljerna: produkter, antal kort, nya rariteter, priser, datum och
     klockslag, villkor (t.ex. max per kund), platser — allt som står i källan och angår en samlare;
  3. eventuell bakgrund (vad som föregick, hur det skiljer sig från tidigare);
  4. `## `-mellanrubrik + **vad det betyder för svenska samlare**: tillgänglighet i Sverige/EU,
     pris i EUR/SEK om känt, frakt/tullar, när svenska butiker väntas få varan.
  Ren text, inga länkar i texten — sidan lägger själv källänken längst ned. Högst tre
  mellanrubriker. Står en uppgift inte i någon källa, skriv den inte. ⛔ Blir källan ändå
  omöjlig att öppna: skriv det du kan belägga ur sökresultaten (kortare är då rätt), och skriv
  i `note` att källan inte kunde läsas, så ägaren vet att texten ska kontrolleras extra.
- Nämn aldrig konkurrerande prisbevaknings-/samlarsajter eller -appar. Nämn aldrig Foilio
  självt i utkasten — de handlar om världen utanför.
- Inga påhittade priser, datum eller antal. Står det inte i källan, står det inte i utkastet.
- Behåll produkt- och setnamn på engelska som de heter ("Elite Trainer Box", "Mega Evolution"),
  övrig text på svenska.

## Hur du lämnar in

1. Skriv utkasten som en JSON-lista till en tillfällig fil (t.ex. `/tmp/utkast.json`):
   ```json
   [
     {
       "title": "Förbokningen av 30th Anniversary Elite Trainer Box öppnar 26 september",
       "summary": "Cardshop Sweden öppnar förbokningen kl 10.00 med max ett exemplar per kund. Leverans väntas till släppet i oktober.",
       "url": "https://www.exempelbutik.se/products/30th-anniversary-etb",
       "source": "Cardshop Sweden",
       "category": "STORE",
       "publishedAt": "2026-09-11",
       "imageUrl": null,
       "imageFit": "cover",
       "origin": "email",
       "note": "Mejlet säger 'begränsat antal' utan siffra.",
       "body": [
         "Cardshop Sweden öppnar förbokningen av 30th Anniversary Elite Trainer Box fredagen den 26 september kl 10.00. Butiken tar max ett exemplar per kund och skriver att antalet är begränsat.",
         "## Vad boxen innehåller",
         "Enligt butikens beskrivning: nio boosterpaket, ett promokort med jubileumsstämpel, 65 sleeves, energikort och tillbehör för spel. Priset är 699 kr.",
         "Leverans väntas till det världsomspännande släppet i oktober. Boxen är den produkt ur jubileumssetet som sålt slut snabbast hos svenska butiker hittills."
       ]
     }
   ]
   ```
   Ett evenemang i samma lista ser ut så här:
   ```json
   {
     "kind": "event",
     "title": "Kortmässan Uppsala",
     "category": "EXPO",
     "startsAt": "2026-11-14T10:00:00+01:00",
     "endsAt": "2026-11-14T17:00:00+01:00",
     "city": "Uppsala",
     "venue": "Fyrishov",
     "address": "Idrottsgatan 2, Uppsala",
     "organizer": "Kortmässan",
     "ticketUrl": "https://www.tickster.com/se/sv/events/…",
     "infoUrl": "https://kortmassan.se/uppsala",
     "summary": "Samlarkortsmässa på Fyrishov med Pokémon, sport och TCG. Lördag 10–17.",
     "body": [
       "Kortmässan kommer till Fyrishov i Uppsala lördagen den 14 november – tredje gången mässan hålls i staden. Arrangören samlar handlare och privata säljare med Pokémon, sportkort och andra TCG under en dag.",
       "## Öppettider",
       "Lördag 14 november 10.00–17.00. Förköpsbiljetter ger insläpp 09.30.",
       "## Biljetter",
       "Ordinarie 120 kr, barn under 12 år gratis i vuxens sällskap. Biljetter säljs via Tickster; förra årets upplaga sålde slut veckan innan.",
       "## På plats",
       "Ett 40-tal utställare enligt arrangören, en bytesyta för besökare, gradering på plats via en inbjuden graderingstjänst och paköppningar på scen under eftermiddagen.",
       "## Hitta dit",
       "Fyrishov, Idrottsgatan 2. Stadsbuss 2 och 8 stannar utanför; parkering finns vid hallen.",
       "## Bra att veta",
       "Swish och kort hos de flesta säljare, men ta med kontanter för privata bord. Väskor får tas in."
     ],
     "origin": "web",
     "note": "Arrangören har ännu inte publicerat utställarlista."
   }
   ```
2. Kör `node scripts/feed-inbox-add.mjs /tmp/utkast.json`. Skriptet sätter id, hoppar över
   allt du redan lämnat in tidigare (`seen` i `inbox.json` — därför behöver du inte själv
   komma ihåg vad du skrev igår) och rapporterar `X nya, Y redan sedda, Z ogiltiga`. Rätta
   ogiltiga rader och kör om.
3. Blev det **0 nya**: ändra ingenting, committa inte, avsluta med en rad om varför.
4. Annars: `git add .github/feed/inbox.json` och committa till `main` med meddelandet
   `chore(nyheter): N utkast till inkorgen YYYY-MM-DD` och pusha. Rör inga andra filer.
   Mappen `.github/feed/` ligger utanför deploy-övervakningen — din push bygger inget.

## Vad du aldrig gör

- Redigerar `news.json`, `events.json` eller något under `src/` — evenemang
  du hittar går via `kind: "event"` i utkastlistan, aldrig direkt in i `events.json`.
- Skriver `slug` i ett utkast — den härleds ur rubriken när ägaren godkänner.
- Skapar en PR, öppnar issues, eller pushar till någon annan gren än `main`.
- Kör `npm install`/`npm ci` — skriptet behöver inga beroenden.
