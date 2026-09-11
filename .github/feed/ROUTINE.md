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
   - ⛔ **Sandlådan blockerar direkta hämtningar** (WebFetch/curl) mot de flesta nyhetssajter —
     det är normalt, inte ett fel. Arbeta då ur **sökresultatens** rubriker, datum och
     beskrivningar; bekräfta gärna med en andra sökning. Ett datum som står i sökresultatet
     räcker som `publishedAt`. Släpp INTE en nyhet bara för att sidan inte gick att öppna —
     PSA:s Europa-etablering 2026-09 var precis en sådan och skulle ha blivit ett utkast.
   - Ambitionsnivå: **3–6 utkast** en vanlig dag är rätt. Hittar du bara 1 har du sökt för smalt —
     prova fler sökord (svenska + engelska, "Pokémon TCG" + gradering/PSA/Cardmarket/release/
     preorder/ETB/Play! Pokémon) innan du ger upp.
   - `category`: `RELEASE` för set/produkter som släpps, `MARKET` för priser/gradering/
     marknad, `STORE` för butiksbesked. Aldrig `APP` (den är Foilios egen).
   - `publishedAt` = artikelns datum. `origin` = `web`.
   - `imageUrl`: artikelns egen delningsbild om du kan läsa ut `og:image` ur sidan
     (`curl -sL <url> | grep -o '<meta[^>]*og:image[^>]*>'`). Hittar du ingen, lämna `null` —
     jobbet försöker självt och ägaren kan byta bild i admin.

Skriv **högst 8 utkast per dag**, hellre 4 bra än 8 halvdana. Dubbletter mellan källor
(samma nyhet hos två sajter) blir ETT utkast med den bästa källan.

## Hur du skriver

- **Svenska.** Rubrik ≤ 90 tecken, saklig, inga utropstecken, inga clickbait-ord. Ingress
  1–2 meningar (≤ 240 tecken) **med egna ord** — återge aldrig artikelns text, och citera inte.
  Ingressen är teasern i listan: vad som händer och när.
- **Brödtext (`body`) — 2–4 stycken, alltid.** Posten får en egen sida på foilio.se, så läsaren
  ska slippa klicka vidare för det viktigaste: **vad** som kommer/händer, **när** (datum,
  klockslag, förbokning/släpp), **vad det innehåller** (produkter, antal kort, nya rariteter,
  priser om källan anger dem), och **varför en svensk samlare bryr sig** (tillgänglighet i
  Sverige/EU, pris i EUR/SEK om känt, vad som skiljer mot tidigare). Egna ord, ren text, inga
  länkar i texten — sidan lägger själv källänken längst ned. Ett stycke som börjar med `## `
  blir en mellanrubrik (använd högst två). Står en uppgift inte i någon källa, skriv den inte.
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
2. Kör `node scripts/feed-inbox-add.mjs /tmp/utkast.json`. Skriptet sätter id, hoppar över
   allt du redan lämnat in tidigare (`seen` i `inbox.json` — därför behöver du inte själv
   komma ihåg vad du skrev igår) och rapporterar `X nya, Y redan sedda, Z ogiltiga`. Rätta
   ogiltiga rader och kör om.
3. Blev det **0 nya**: ändra ingenting, committa inte, avsluta med en rad om varför.
4. Annars: `git add .github/feed/inbox.json` och committa till `main` med meddelandet
   `chore(nyheter): N utkast till inkorgen YYYY-MM-DD` och pusha. Rör inga andra filer.
   Mappen `.github/feed/` ligger utanför deploy-övervakningen — din push bygger inget.

## Vad du aldrig gör

- Redigerar `news.json`, `events.json`, `sources.json` eller något under `src/`.
- Skriver `slug` i ett utkast — den härleds ur rubriken när ägaren godkänner.
- Skapar en PR, öppnar issues, eller pushar till någon annan gren än `main`.
- Kör `npm install`/`npm ci` — skriptet behöver inga beroenden.
