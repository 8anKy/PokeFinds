# Villkorsanalys · vad våra användarvillkor täcker och vad de missar

> ## ⛔ DETTA ÄR INTE JURIDISK RÅDGIVNING
>
> Det här dokumentet är skrivet av en AI-assistent, inte av en jurist. Ingen advokat har
> läst det. Det är en strukturerad genomgång av produktens riskyta jämfört med vad våra
> publicerade villkor faktiskt säger, avsedd som **underlag inför ett samtal med en
> kvalificerad svensk jurist**. Lagrumshänvisningarna är angivna för att göra det lätt att
> kontrollera, inte för att vara auktoritativa: flera av dem är förenklade och minst en
> (EU:s ODR-plattform) är sannolikt inaktuell. Publicera ingenting härifrån utan att en
> jurist med konsument- och e-handelsrätt har gått igenom det.
>
> Utkast till de saknade klausulerna finns i [`TERMS-DRAFT-CLAUSES.md`](TERMS-DRAFT-CLAUSES.md).
> Samma förbehåll gäller där.

Uppdaterad: 2026-08-02 · gäller villkorstexten daterad 2026-06-01 och integritetspolicyn daterad 2026-06-29.

---

## 1. Sammanfattning

Villkoren är för en tjänst som inte längre finns. De beskriver en prisbevakningssajt med
konto och community. Sedan dess har vi lagt till en AI-kortskanner, en AI-graderare, ett
betalabonnemang, en säljintegration mot en extern marknadsplats och ett
inbjudningsprogram. **Ingen av de fem funktionerna nämns med ett ord i villkoren.**

Det som redan finns är dessutom bra: friskrivningen för marknadsdata (§4) och
varumärkesklausulen (§1) är genuint väl skrivna och täcker mer än många jämförbara appar
i kategorin gör. Problemet är inte kvaliteten på det som står. Det är att ytan har vuxit
ifrån texten.

**De sju allvarligaste luckorna, rangordnade:**

| # | Lucka | Allvar | Lagkrav eller klokskap |
| --- | --- | --- | --- |
| A | Inga företagsuppgifter alls: ingen juridisk person, inget organisationsnummer, ingen adress | 🔴 Hög | **Lagkrav** (e-handelslagen 8 §, distansavtalslagen 2 kap.) |
| D | "Obegränsat" mot ett dolt tak, och tre olika siffror i tre olika ytor | 🔴 Hög | **Lagkrav** (marknadsföringslagen) + produktbugg |
| B | Ingen ångerrätt, inget om 14 dagar, inget om vem som är säljare vid appköp | 🔴 Hög | **Lagkrav** (distansavtalslagen 2 kap.) |
| C | Ingen hänvisning till ARN | 🔴 Hög | **Lagkrav** (lag 2015:671, 4 §) |
| E | AI-utdata (skanner + gradering) friskrivs inte i avtalet, bara i gränssnittet | 🔴 Hög | Klokskap, med en lagkravskant |
| H | Tradera-integrationen är oreglerad: vi publicerar annonser i användarens namn | 🔴 Hög | Klokskap, men det är den största enskilda exponeringen |
| F2 | Oklart om vi har rätt att visa kortbilderna och den härledda prisdatan | 🔴 Hög | **Lagkrav**, men det är en egen utredning, inte en villkorsfråga |

Ett mönster värt att säga högt: **flera av friskrivningarna finns redan, men på fel
plats.** Graderingssidan har en tydlig "detta är inte en officiell PSA- eller
BGS-gradering". Den texten är en upplysning i ett gränssnitt, inte ett avtalsvillkor.
Den binder ingen och den överlever inte en redesign. Samma sak med kontaktsidans löfte om
svar inom 48 timmar, som går åt andra hållet: det är ett åtagande som ingen har beslutat
att göra, publicerat utanför avtalet.

---

## 2. Vad vi har idag

Tre dokument, alla tvåspråkiga (sv/en, nycklarna är i synk i båda filerna).

| Dokument | Rutt | Copy | Sektioner |
| --- | --- | --- | --- |
| Användarvillkor | `/villkor` | `messages/{sv,en}.json` → `Terms` | 9 |
| Integritetspolicy | `/integritetspolicy` | → `Privacy` | 8 |
| Cookiepolicy | `/cookies` | → `Cookies` | 6 |

Sidkomponenterna (`src/app/[locale]/(marketing)/*/page.tsx`) innehåller ingen text alls,
bara struktur. **All juridisk copy bor i översättningsfilerna.** Det betyder att varje
ändring måste göras i två filer, och att en sektion som läggs till i den svenska texten
utan motsvarighet i den engelska ger ett saknat-nyckel-fel i drift.

### 2.1 Användarvillkoren, sektion för sektion

| § | Rubrik | Vad den faktiskt säger |
| --- | --- | --- |
| 1 | Om tjänsten | Beskriver tjänsten som prisdata, lagerstatus, marknadstrender, bevakning, samling, community. Slår fast att vi är oberoende och inte godkända av The Pokémon Company. Varumärken tillhör sina ägare. |
| 2 | Konto | Minst 16 år. Användaren ansvarar för riktiga uppgifter och hemliga inloggningsuppgifter. All aktivitet via kontot tillskrivs användaren. |
| 3 | Acceptabel användning | Fem förbud: olaglig användning, kringgå tekniska begränsningar eller skrapa data, kränkande eller upphovsrättsintrångande community-innehåll, sälja eller dela kontot, störa driften. Vi får ta bort innehåll och stänga av konton. |
| 4 | Prisdata utan garanti | Data hämtas automatiskt, kan vara fördröjd eller fel, tillhandahålls i befintligt skick. Butikens pris vid köptillfället gäller. Vi säljer inget och är inte part i köp. Samlingsvärden är uppskattningar och inte finansiell rådgivning. |
| 5 | Ansvarsbegränsning | I befintligt skick, i mån av tillgänglighet. Inget ansvar för indirekta skador, utebliven vinst, driftstörningar eller förlorad data. Tvingande konsumenträtt begränsas inte. |
| 6 | Pro och betalning | Vissa funktioner kräver Pro. Priser på prissidan. Månadsvis utan bindningstid. I appen sköter App Store eller Google Play köp och uppsägning; uppsägning gäller till periodens slut. |
| 7 | Uppsägning | Användaren kan avsluta kontot i Inställningar, personuppgifter raderas enligt policyn. Vi kan stänga av vid brott mot villkoren eller om tjänsten läggs ner, med rimlig förvarning där det går. |
| 8 | Ändringar av villkoren | Vi kan uppdatera. Väsentliga ändringar meddelas via e-post eller i tjänsten minst 30 dagar i förväg. Fortsatt användning = godkännande. |
| 9 | Tillämplig lag och kontakt | Svensk lag, svensk allmän domstol, hej@foilio.se. |

### 2.2 Integritetspolicyn, i korthet

Personuppgiftsansvarig, kategorier av uppgifter (konto, samling, bevakningar,
community-innehåll, kortbilder vid skanning), ändamål med rättslig grund per ändamål,
lagringstid (30 dagar efter radering, 7 år för bokföring), de registrerades rättigheter
med hänvisning till IMY, cookies, underbiträden (Neon i Frankfurt, en onämnd molnvärd,
Resend i USA, Anthropic i USA) och ändringar.

Den är **påfallande mycket bättre underhållen än villkoren**, men den har egna hål. De
listas i avsnitt 6 nedan och hör hemma i ett separat pass, inte i villkoren.

### 2.3 Cookiepolicyn

Fyra namngivna cookies (tre NextAuth-cookies plus samtyckesvalet), inga
tredjepartscookies, ingen försäljning av data, hur man blockerar cookies, rättslig grund.
Rimlig och korrekt så långt den räcker.

---

## 3. Produktens riskyta idag

Innan luckorna: det här är vad tjänsten faktiskt gör, verifierat i koden. Villkoren måste
täcka den här listan, inte listan från juni.

| Funktion | Var | Riskbärande egenskap |
| --- | --- | --- |
| Prisdata och prisgraf | Hela katalogen | Härledd från en extern dataleverantör, svenska butiker och en marknadsplats. Uppdateras dagligen, inte i realtid. |
| Restock- och prislarm | `src/services/alerts.ts` | Levereras via e-post och push. **Medvetet dämpade**: blinkar under 60 minuter larmar inte, och ett par som studsar mer än 6 gånger per dygn får ett besked per dygn i stället för varannan timme. |
| Samlingsvärde | `src/services/collection.ts` | Live-beräknat från lägsta pris × dagskurs. En uppskattning byggd på en uppskattning. |
| AI-kortskanner | `src/services/scanner/` | Identifierar kort på utseende plus ett modelläst samlarnummer. **Kan välja fel kort och fel tryckning.** Kvot per månad. Bilder skickas till en AI-leverantör i USA. |
| AI-gradering | `src/services/grading/` | Uppskattar skick från två foton. Uttryckligen inte PSA eller BGS. Kvot per månad, olika modell per plan. |
| Pro-abonnemang, 49 kr/mån | RevenueCat → App Store / Google Play | Automatiskt förnyande konsumentabonnemang. Webbetalning marknadsförs som "kommer snart". |
| Tradera-säljintegration | `src/app/api/tradera/sell/` | **Vi skapar annonser i användarens namn** med användarens foton, pris och beskrivning, mot användarens lagrade åtkomsttoken. |
| Utgående butikslänkar | `Retailer.affiliateEnabled` | Modellen stödjer affiliate-parametrar per butik. |
| Inbjudningsprogram | `src/services/invites.ts` | 3 verifierade vänner ger 1 månad Pro. Kampanjvillkoren är en mening i gränssnittet. |
| Community | `src/services/community.ts` | Byggt men inte publikt exponerat (`/community` visar "kommer snart"). |
| Ranking, "Bäst matchning" | `src/services/ranking.ts` | Vi rangordnar produkter från flera säljare efter en egen formel. |

---

## 4. Luckorna

Allvarsgraden är satt utifrån **sannolikhet gånger konsekvens för oss**, inte utifrån hur
svår klausulen är att skriva. "Lagkrav" betyder att någon regel kräver att informationen
finns; "klokskap" betyder att den skyddar oss men att ingen myndighet saknar den.

### 🔴 A · Vi säger aldrig vilka vi är

**Lagkrav. Allvar: hög. Blockerar allt annat.**

Villkoren, policyn och kontaktsidan innehåller ordet "Foilio" och en mejladress. Det finns
ingen juridisk person, inget organisationsnummer, ingen geografisk adress och inget
momsregistreringsnummer någonstans i repot.

E-handelslagen (2002:562) 8 § kräver att en tjänsteleverantör lämnar namn, adress,
e-postadress och organisationsnummer, samt momsregistreringsnummer om man är registrerad.
Distansavtalslagen (2005:59) 2 kap. kräver näringsidkarens identitet och adress **innan**
avtal ingås. Dataskyddsförordningen kräver att den personuppgiftsansvarige är identifierad
med mer än ett varumärke.

Det här är också en praktisk blockerare: ingen av de andra klausulerna kan färdigställas
förrän det är bestämt om Foilio är en enskild firma eller ett aktiebolag, eftersom
formuleringarna om ansvar, avtalspart och moms skiljer sig åt.

### 🔴 B · Ångerrätten finns inte i texten

**Lagkrav. Allvar: hög.**

Ordet "ångerrätt" förekommer exakt en gång i hela produkten, i en varningstext om
kontoradering, och då i betydelsen "det går inte att ångra". Det finns ingen information
om de fjorton dagarna, ingen ångerblankett och ingen förklaring av vad som händer när en
tjänst börjar levereras omedelbart.

Två saker måste redas ut och de har olika svar:

1. **Vid köp i appen** är Apple respektive Google säljare gentemot användaren.
   Ångerrätten och återbetalningen hanteras då i deras kanaler, inte i våra. Villkoren
   måste säga det, och peka användaren rätt i stället för att låta hen mejla oss.
2. **Vid webbetalning**, som prissidan redan utlovar som "inom kort", blir Foilio
   säljare. Då krävs fullständig förhandsinformation, en ångerblankett, och ett aktivt
   samtycke till att leveransen påbörjas under ångerfristen. För en **tjänst** förlorar
   konsumenten inte automatiskt ångerrätten genom att börja använda den; hen kan i stället
   bli skyldig att betala en proportionell del. Gränsdragningen mellan "digitalt innehåll"
   och "digital tjänst" avgör vilket regelverk som gäller och är precis en sådan fråga där
   en jurist behövs.

⚠️ Villkoren bör täcka **båda** fallen redan nu. Alternativet är att texten blir felaktig
samma dag webbetalningen går live.

### 🔴 C · Ingen hänvisning till ARN

**Lagkrav. Allvar: hög. Billigast att åtgärda av alla luckor.**

Lagen (2015:671) om alternativ tvistlösning i konsumentförhållanden 4 § kräver att en
näringsidkare som säljer till konsumenter informerar om Allmänna reklamationsnämnden, med
namn och webbadress, på sin webbplats och i sina villkor. §9 säger bara "svensk allmän
domstol", vilket är otillräckligt och dessutom lite avskräckande i tonen.

⚠️ Många mallvillkor hänvisar också till EU:s ODR-plattform. **Kontrollera den punkten
särskilt**: plattformen har enligt vad jag känner till avvecklats, och en hänvisning till
en nedlagd tjänst är sämre än ingen hänvisning alls. Låt juristen avgöra vad som ska stå
i stället.

### 🔴 D · "Obegränsat" mot ett dolt tak, och tre olika siffror

**Lagkrav (marknadsföringslagen) plus en ren produktbugg. Allvar: hög.**

Det här är den mest konkreta bristen i hela genomgången, för den går att mäta:

| Yta | Vad den säger om Pro-skanningar |
| --- | --- |
| Prissidan (`Pricing.premiumFeatures`) | "100 skanningar per månad" |
| Skannerns kvotvisning (`Scanner.scansUnlimited`) | `∞` |
| Koden (`PREMIUM_FAIR_USE`, `src/services/scanner/index.ts`) | 1000 per månad, överstyrbart via env |

Tre ytor, tre svar, noll av dem i villkoren. Kodkommentaren är ärlig med avsikten: taket
är ett missbruksskydd, inte en produktgräns, och ska fångas i loggen snarare än läsas som
att en kund skannar för mycket. Den avsikten är fullt försvarbar. Men ett tak som
användaren inte kan se är fortfarande ett tak, och att marknadsföra oändlighetstecknet mot
det är precis den typen av påstående Konsumentverket brukar titta på.

Det går att lösa utan att förstöra marknadsföringen. Formuleringen "obegränsat inom
skälig användning", med taket och konsekvensen angivna i villkoren, är både sann och
säljande. Se utkastet i klausulfilen.

Notera att kvoten dessutom mäter **identifierade kort**, inte skanningsförsök: en skanning
som inte hittade något kort räknas inte. Det är en fördel för användaren och bör stå i
villkoren, inte bara i en kodkommentar.

⚠️ Samma inkonsekvens finns i mindre skala för gradering: `Grading.limitPremium` säger
"Dagens graderingar är slut. Tillbaka i morgon", men gränsen är en **månadsgräns**
(`GRADING_PREMIUM_MONTHLY_LIMIT` = 15). Texten lovar att kvoten återställs i morgon. Det
gör den inte.

### 🔴 E · AI-utdata friskrivs bara i gränssnittet

**Klokskap med en lagkravskant. Allvar: hög.**

Varken skannern eller graderaren nämns i villkoren. Friskrivningen som finns
(`Grading.disclaimerText`) är en gränssnittstext, alltså inte ett avtalsvillkor, och den
täcker bara graderingen.

Det som saknas, i avtalsform:

- **Graderingen är en uppskattning.** Den är inte en PSA-, BGS-, CGC- eller annan officiell
  gradering, och vi lovar ingenting om att ett gradingbolag skulle komma fram till samma
  siffra. Konsekvensen är verklig: gränssnittet uppmanar användaren att spara kortet i
  samlingen med gradingbolag "Foilio AI", vilket sedan påverkar det värde vi visar.
- **Skannern kan identifiera fel kort.** Det här är dokumenterat i vår egen
  `SCANNER-STATUS.md`, inte en teoretisk risk. Särskilt utsatt är valet av **tryckning**:
  Base-korten finns som Unlimited, Shadowless och 1st Edition med identisk konst och
  prisskillnader på uppemot sextiofem gånger, och de skiljs bara av ett samlarnummer som
  ofta inte går att läsa i en skärmfotografering.
- **Modellen kan bytas** och resultaten kan därför förändras över tid.
- **Inget ansvar för beslut** som fattas på utdata: köp, försäljning, prissättning eller
  beslutet att skicka in ett kort för riktig gradering.
- **Vad vi gör med bilderna.** Att de skickas till en extern AI-leverantör står i
  integritetspolicyn men inte i villkoren, och användarens skyldighet att bara ladda upp
  bilder hen får ladda upp står ingenstans alls.
- **Att vi inte tränar på bilderna.** Detta är värt en egen mening. En jämförbar app i
  kategorin anger uttryckligen att skannade bilder används för att träna deras
  igenkänningsmodeller. Vår modell är byggd på katalogbilder och ett avtryck som räknas
  i klienten, inte på användarnas foton, och leverantören sparar inte bilderna. Det är
  både ett skydd mot framtida anklagelser och ett säljargument som just nu ligger oanvänt
  i en policyfotnot.

### 🔴 F · Tredjepartsdata: två olika problem som ofta blandas ihop

**F1, mot användaren. Klokskap. Allvar: medel.**

§4 är bra men generisk: "externa källor". Den nämner inte att en källa kan försvinna, att
en funktion då kan försvinna med den, eller att uppdateringsfrekvensen är daglig och inte
realtid. För en betalande Pro-användare som köpte tjänsten för marknadsdatan är det en
väsentlig egenskap.

**F2, mot rättighetshavarna. Lagkrav. Allvar: hög. Egen utredning.**

Villkoren kan inte reparera en licens vi inte har. Följande behöver bekräftas, och det är
en separat uppgift som inte hör hemma i det här dokumentet:

- Kortbilderna vi visar hämtas från en extern bildkälla och föreställer upphovsrättsligt
  skyddad konst som tillhör tredje part.
- Prisdatan är härledd från en marknadsplatsplattform via en API-återförsäljare. Villkoren
  för vidarepublicering av den datan behöver läsas.
- Marknadsplatsens API som vi hämtar annonser från har egna användningsvillkor.
- Butiksdatan hämtas från publika produktsidor. Vi respekterar robots.txt och identifierar
  oss (`FoilioBot/1.0`), vilket är rätt gjort, men en butik kan ändå invända.

⚠️ Detta är den enda punkten i dokumentet där bristen inte går att skriva bort. Den ska upp
på juristmötet, men som en licensfråga, inte som en villkorsfråga.

### 🔴 G · Tradera-integrationen är helt oreglerad

**Klokskap, men den största enskilda exponeringen. Allvar: hög.**

`POST /api/tradera/sell` skapar en annons hos en extern marknadsplats i användarens namn,
med användarens foton, användarens pris och en beskrivning som **vi kan generera
automatiskt** om användaren inte skriver en egen. Vi lagrar en åtkomsttoken kopplad till
användarens marknadsplatskonto. Ingenting av detta har någon avtalsmässig inramning.

Det som behöver stå:

- Vi agerar på användarens uttryckliga instruktion. **Användaren är säljare.**
- Användaren ansvarar för att annonsen är korrekt: skick, äkthet, bilder, pris, frakt,
  leverans och eventuell skatt. Det gäller även den beskrivning och kategori vi föreslår.
- Marknadsplatsens egna villkor och avgifter gäller mellan användaren och marknadsplatsen.
  Vi är inte part i försäljningen och tar inte emot betalning.
- Vi garanterar inte att en annons publiceras, blir kvar eller blir korrekt kategoriserad.
- Kopplingen kan när som helst brytas, av användaren eller av marknadsplatsen, och lagrade
  åtkomsttoken upphör.
- Skatterättsligt ansvar ligger hos användaren. Marknadsplatser rapporterar säljare till
  Skatteverket, vilket kan överraska den som säljer av sin samling.

⚠️ Integritetspolicyn nämner inte heller integrationen, trots att vi lagrar ett
marknadsplats-id och en token och överför bilder till en ny mottagare. Se avsnitt 6.

### 🟠 H · Rangordning och affiliate

**Sannolikt lagkrav. Allvar: medel till hög.**

Två frågor, samma klausul.

**Rangordningen.** Vi driver en sökfunktion som visar produkter från flera olika säljare
och sorterar dem efter en egen formel, marknadsförd som "Bäst matchning". EU:s
konsumenträttsliga regler om sökrankning (införda genom Omnibus-direktivet) kräver
normalt att en tjänst som rankar erbjudanden från flera näringsidkare upplyser om
**huvudparametrarna** för rangordningen och om betald placering påverkar den.

Vi har ovanligt goda förutsättningar att uppfylla det: formeln är handsatt, samlad i en
enda modul (`src/services/ranking.ts`) och dokumenterad. Det finns inget inlärt
klickbeteende att förklara bort. Det saknas bara en publik beskrivning.

**Affiliate.** `Retailer` har `affiliateEnabled` och `affiliateParams`. Om någon utgående
länk är eller blir sponsrad måste det kommersiella syftet framgå, och villkoren bör
uttryckligen slå fast att ersättning inte påverkar rangordningen (förutsatt att det är
sant, vilket det ser ut att vara i dagens formel).

⚠️ Ägaren måste svara på om affiliate faktiskt är aktivt för någon butik idag.

### 🟠 I · Larm är bästa förmåga, och vi dämpar dem med flit

**Klokskap. Allvar: medel.**

Pro säljs till stor del på larmen. Villkoren säger ingenting om dem.

Den viktiga nyansen är inte den vanliga ("e-post kan fastna i skräpposten"), utan att
**vi medvetet håller inne larm**. Flapp-dämpningen släpper inte igenom en lagerstatus som
studsar tillbaka inom 60 minuter, och strypar ett par som växlar mer än sex gånger per
dygn till ett besked per dygn. Det är ett bra beslut, mätt mot 21 dygns facit, och det gör
produkten bättre. Men det betyder att påståendet "få larm när en produkt kommer i lager"
inte är sant utan kvalificering, och att en användare som missade ett släpp kan ha en
befogad fråga.

Behövs: ingen garanti om leverans eller tidpunkt, ingen garanti om att en produkt
fortfarande finns kvar när larmet når fram, en förklaring av att larm kan slås ihop eller
fördröjas för att undvika spam, och att push kräver operativsystemets tillstånd.

### 🟠 J · Abonnemanget: förnyelse, prisändringar, funktionsändringar

**Lagkrav. Allvar: medel till hög.**

§6 är fyra meningar. Den säger "månadsvis utan bindningstid" men aldrig att abonnemanget
**förnyas automatiskt** tills det sägs upp. Den säger inte när debitering sker, att
uppsägning i App Store måste ske i god tid före periodens slut, eller vad som händer med
Pro-funktionerna vid nedgradering (bevakningslistan behandlas faktiskt i prissidans FAQ,
men inte i villkoren).

Vidare saknas:

- **Prisändringar.** Ingen text om varsel eller om rätten att säga upp vid höjning.
- **Funktionsändringar.** §8 reglerar ändringar av *villkoren*, inte av *tjänsten*.
  Konsumentköplagens regler om digitalt innehåll och digitala tjänster begränsar
  ensidiga ändringar till nackdel för konsumenten: de kräver stöd i avtalet, ett giltigt
  skäl, förhandsinformation och i vissa fall rätt att säga upp utan kostnad. Vi har idag
  inget sådant avtalsstöd.
- **Gratisnivån.** Ingen text om att den kan ändras eller upphöra.
- **Betatjänster.** Skannern är enligt vår egen statusdokumentation under aktiv
  omkalibrering. Villkoren behandlar den som en färdig funktion.

### 🟠 K · Acceptabel användning har rätt idé men för få tänder

**Klokskap. Allvar: medel.**

§3 är ovanligt bra för sin längd, och scraping-förbudet finns redan. Det som saknas:

- **Automatiserad åtkomst till våra API:er.** Förbudet mot att skrapa nämner "tjänsten"
  men inte våra endpoints, och vi har rate limiting i drift som ingen har fått veta om.
- **Kringgående av kvoter**, till exempel genom flera gratiskonton. Det här hänger direkt
  ihop med inbjudningsprogrammet, som belönar nya konton.
- **Bilder man inte har rätt att ladda upp**, och olämpligt innehåll i uppladdningar. Det
  är särskilt viktigt eftersom bilderna vidarebefordras till en extern leverantör.
- **Reverse engineering** av appen och kringgående av tekniska skydd.
- **Konsekvenstrappa.** §3 slutar med att vi får stänga av konton. Mot en betalande kund
  behövs proportionalitet: varning där det är möjligt, och ett svar på vad som händer med
  betald tid.

### 🟠 L · Immaterialrätt: vi skyddar tredje mans varumärke men inte vårt eget

**Klokskap. Allvar: medel.**

§1 hanterar Pokémon-varumärket exemplariskt. Men ingenstans står det att Foilio äger sin
kod, sin design, sitt varumärke och sin **katalog**. Katalogen är en sammanställning av
drygt 22 000 produkter, byggd med väsentliga investeringar, och kan mycket väl omfattas av
katalogskyddet i 49 § upphovsrättslagen. Att åberopa det gör scraping-förbudet i §3
väsentligt vassare än ett rent avtalsvillkor: det ger en rättslig grund mot någon som
aldrig accepterat villkoren.

Det saknas också en beskrivning av vilken licens användaren får: en begränsad, återkallelig,
icke-exklusiv rätt att använda tjänsten för personligt, icke-kommersiellt bruk.

⚠️ **Och exporten är en öppen dörr.** GDPR-exporten i Inställningar ger användaren en
maskinläsbar fil, vilket är precis som det ska vara. Men filen innehåller vår katalogdata
sammanflätad med användarens egna poster, och ingenting säger idag att katalogdelen inte
får återanvändas. Gränsen bör dras uttryckligen: **din samling är din, katalogen är vår.**
Jämförbara appar i kategorin har den klausulen och riktar den öppet mot den som vill bygga
en konkurrent på deras data. Att kräva det påverkar inte användarens rätt till sina egna
personuppgifter det minsta.

### 🟠 M · Ansvarsbegränsningen kan jämkas bort i sin helhet

**Klokskap. Allvar: medel.**

§5 friskriver brett och sparar tvingande konsumenträtt, vilket är rätt instinkt. Men den
saknar tre saker som gör den mer hållbar, inte mindre:

- **Ett beloppstak**, till exempel vad användaren betalat de senaste tolv månaderna. En
  friskrivning utan tak framstår som mer oskälig än en med.
- **Uttryckliga undantag** för uppsåt, grov vårdslöshet och personskada. Sådant går ändå
  inte att friskriva sig från, och att låtsas om motsatsen försvagar hela klausulen.
- **En separat rad för gratisanvändare**, som inte betalat något och därför inte har något
  tak att räkna på.

Risken med dagens formulering är inte att den är för svag, utan att en domstol som finner
den oskälig enligt 36 § avtalslagen kan jämka **hela** klausulen i stället för att kapa
det som är för långtgående.

### 🟡 N · Ålder och avtalskapacitet är sammanblandade

**Lagkrav. Allvar: medel.**

§2 sätter 16 år. Det svarar mot GDPR:s standardålder, men **Sverige har sänkt gränsen för
informationssamhällets tjänster till 13 år**, och avtalskapacitet är en helt annan fråga:
enligt föräldrabalken kan den som är under 18 inte ingå bindande avtal utan
vårdnadshavares samtycke. Ett betalabonnemang för en 16-åring är alltså angripbart.

De två frågorna bör separeras: en åldersgräns för kontot och en för betalning, med krav på
vårdnadshavares samtycke under 18.

### 🟡 O · Vad händer med användarens data

**Klokskap. Allvar: medel.**

En samling som byggts upp under år är det mest värdefulla en användare har hos oss. Idag
finns:

- ingen text om ansvar vid dataförlust utöver den generella friskrivningen,
- ingen uppmaning att exportera regelbundet, trots att export finns i produkten,
- inget om vad som händer vid nedläggning utöver "rimlig förvarning där det är möjligt",
- inget om inaktiva konton.

### 🟡 P · Community aktiverar en helt annan regelbok

**Blir lagkrav vid lansering. Allvar: låg idag, hög den dagen.**

`src/services/community.ts` finns och fungerar, men `/community` visar "kommer snart".
Villkoren nämner ändå community-innehåll i §1 och §3, vilket är en liten inkonsekvens.

Den dagen funktionen öppnas aktiveras krav som inte går att lägga till i efterhand utan
friktion: en licens från användaren till oss för publicerat innehåll, en
anmälningsmekanism, motivering vid nedtagning, en intern klagomålshantering, en angiven
kontaktpunkt och en beskrivning i villkoren av hur vi modererar. Delar av EU:s regelverk
för digitala tjänster undantar mikroföretag, men informationskraven i villkoren gör det
inte.

⚠️ **Bygg villkorstexten för community innan funktionen släpps, inte efter.**

### 🟡 Q · Inbjudningsprogrammet saknar kampanjvillkor

**Klokskap. Allvar: låg till medel.**

Erbjudandet (tre verifierade vänner ger en månad Pro) har en enda mening som villkor,
publicerad i gränssnittet. Det saknas: förbud mot att bjuda in sig själv eller skapa
konton för ändamålet, vår rätt att dra tillbaka en bonus vid missbruk, rätten att avsluta
erbjudandet, och att bonusen inte kan bytas mot pengar.

### 🟡 R · Standardklausuler som helt saknas

**Klokskap. Allvar: låg, men de är gratis att lägga till.**

Force majeure. Överlåtelse av avtalet (relevant vid en försäljning av verksamheten).
Ogiltig klausul påverkar inte övriga. Fullständigt avtal. **Vilken språkversion som
gäller vid konflikt**, vilket är en verklig fråga eftersom vi publicerar båda och
maskinöversättningsfel förekommer.

### 🟡 S · Lagvalet är för trubbigt

**Klokskap. Allvar: låg.**

§9 säger "svensk lag". Vi har en engelsk lokal och användare kan finnas i andra
EU-länder. Rom I-förordningen ger en konsument det tvingande skyddet i sitt hemland
oavsett vad avtalet säger. Klausulen blir mer korrekt, och mindre lätt att angripa, om den
säger det uttryckligen i stället för att påstå något som inte håller.

### 🟡 T · Löftet om svarstid

**Klokskap. Allvar: låg.**

Kontaktsidan lovar svar inom 48 timmar på vardagar. Det är ett åtagande som ingen har
beslutat att göra, publicerat utanför avtalet, och som en missnöjd kund kan åberopa.
Antingen backas det i villkoren som ett mål snarare än en garanti, eller så tas det bort
från kontaktsidan. Att ha det stående oreglerat är det sämsta av alternativen.

---

## 5. Interna inkonsekvenser som bör lösas innan juristen kopplas in

Det här är billiga att fixa och gör juristtimmen mycket mer värd. Ingen av dem är en
juridisk fråga; de är beslut vi själva måste ta.

1. **Skanningskvoten säger tre olika saker** i tre olika ytor (avsnitt D). Bestäm vad som
   gäller, rätta gränssnittet, skriv sedan villkoret.
2. **Graderingskvoten kallas dygnsgräns i felmeddelandet** men är en månadsgräns.
3. **Cookie-texterna motsäger varandra.** Integritetspolicyns §6 säger att alla cookies är
   nödvändiga och att samtycke därför inte krävs. Cookiepolicyns §5 säger att
   preferenscookies sätts efter samtycke. Båda kan inte stämma.
4. **Villkoren §6 känner bara till appköp**, medan prissidan marknadsför webbetalning
   "inom kort". Texten är felaktig från dag ett efter lanseringen.
5. **Community nämns i villkoren men finns inte publikt.**
6. **Åldersgränsen 16 år** står ensam och blandar ihop dataskydd med avtalskapacitet.
7. ⚠️ **En kodkommentar i `src/services/scanner/index.ts` namnger två konkurrentappar vid
   namn.** CLAUDE.md förbjuder uttryckligen att inspirations- eller konkurrentsidor nämns
   i kod, copy eller dokumentation, och repot är publikt. Jag har inte rört källfilen (det
   här passet är dokumentation), men den raden bör bort.

---

## 6. Integritetspolicyn: flaggat för ett separat pass

**Dessa hör inte hemma i villkoren och ska inte slås ihop dit.** Villkoren och policyn är
två dokument med två olika funktioner, och att blanda dem gör båda sämre. Listan finns här
bara för att luckorna upptäcktes under samma genomgång.

| Lucka | Allvar |
| --- | --- |
| **Tradera-integrationen saknas helt.** Vi lagrar ett marknadsplats-id och en åtkomsttoken, och överför bilder och annonsdata till en ny mottagare. Varken uppgiftskategorin, ändamålet, den rättsliga grunden eller mottagaren finns i policyn. | 🔴 Hög |
| **Betaltjänstleverantören saknas.** Abonnemangsstatus hanteras via en prenumerationsplattform kopplad till App Store och Google Play. Ingen av dem nämns som mottagare. | 🔴 Hög |
| **Analysdata nämns inte.** Vi har en egen händelsetabell för produktvisningar och sökningar. Att den är avidentifierad är ett gott skäl att beskriva den, inte att utelämna den. | 🟠 Medel |
| **Skannerdiagnostik.** Modellsvar, kandidatlistor och ett 264 byte konstavtryck sparas per skanning för admin. Ingen bild sparas, vilket är rätt, men behandlingen finns inte i policyn. | 🟠 Medel |
| **Push-tokens och enhetsidentifierare** nämns inte. | 🟠 Medel |
| **Felövervakning och cache/rate limiting** (två ytterligare underbiträden i drift) saknas i biträdeslistan. | 🟠 Medel |
| **Molnvärden är onämnd** ("vår molnvärd"). Biträden bör kunna namnges. | 🟡 Låg |
| **Personuppgiftsansvarig är ett varumärke, inte en juridisk person.** Samma grundproblem som lucka A. | 🔴 Hög |
| **Cookie-motsägelsen** mot cookiepolicyn (avsnitt 5, punkt 3). | 🟠 Medel |
| **Åldersgräns för behandling** anges inte i policyn. | 🟡 Låg |
| **Säkerhetskopior beskrivs som "rensas löpande".** Jämförbara appar anger konkreta fönster (dolt inom 30 dagar, raderat inom 90, säkerhetskopior inom ytterligare 90). Ett tal är lättare att hålla än ett adverb. | 🟡 Låg |
| **Ingen uttrycklig rad om att vi inte tränar AI-modeller på användarnas kortbilder.** Det är sant och det är ett säljargument. Säg det. | 🟡 Låg |

---

## 7. Jämförelse med jämförbara appar i kategorin

Två publicerade villkorsuppsättningar för jämförbara kortskanner- och samlingsappar lästes
igenom, plus deras integritetspolicyer och den ena partens API-villkor. Syftet var att se
**struktur och riskuppdelning**, aldrig att återanvända text. Ingen formulering härifrån är
hämtad från något annat dokument, och inga aktörer namnges här enligt projektets egen
regel. Den ena är amerikansk, den andra kanadensisk.

### 7.1 Vad de täcker som vi inte gör

- **Rimlig användning ligger i avtalet, inte bara i koden.** Den ena beskriver skanning
  som obegränsad vid normal privat användning, uttryckligen förbehållen rimlig användning,
  med en reserverad rätt att strypa den som belastar tjänsten, plus ett förbud mot att
  driva näringsverksamhet i appen. Det är exakt den konstruktion vår lucka D behöver, och
  den är bevisat säljbar: appen marknadsförs fortfarande som obegränsad.
- **Livstidserbjudanden definieras ned.** Samma part definierar "livstid" som så länge
  appen finns under sitt nuvarande namn. Vi har inget livstidserbjudande, men principen
  gäller vår gratisnivå: säg vad ordet betyder innan någon annan gör det åt dig.
- **Exporterad data får inte mata en konkurrent.** Katalogen är deras, den exporterade
  samlingen är användarens och endast för privat bruk. Det är en klausul vi saknar helt,
  och den är direkt relevant: vi har en GDPR-export som ger användaren en maskinläsbar fil,
  och ingenting hindrar att den filen används för att bygga en rival på vår katalog.
- **Felidentifiering av kort namngivet i ansvarsbegränsningen.** Den andra parten är den
  enda i hela urvalet som uttryckligen skriver att kortidentifieringen kan vara felaktig.
  Vi har starkare skäl än någon av dem att vara utförliga här, eftersom vi faktiskt har
  mätt vår felfrekvens.
- **Kameran har en egen sektion.** Ändamål, användarens ansvar för bildkvalitet, förbud
  mot att fotografera material man inte har rätt till, och vad som händer med bilderna.
  Bra struktur att låna, som struktur.
- **Konkreta raderingstider.** En part anger 30 dagar till dolt, 90 till raderat och
  ytterligare 90 för säkerhetskopior. Vår policy säger "säkerhetskopior rensas löpande",
  vilket är vagare än det behöver vara.
- **Beloppstak, alltid.** Den ena kapar vid vad användaren betalat, den andra vid ett
  fast belopp motsvarande ungefär 700 kr. Vår §5 har inget tak alls.
- **Språkversion.** Den tvåspråkiga parten anger uttryckligen vilken version som styr.
  Vi publicerar två språk och anger ingenting.
- **Bredare varumärkesfriskrivning.** Den ena räknar upp flera utgivare, inte bara ett
  enda varumärke. Vår §1 nämner bara The Pokémon Company. Om katalogen någonsin utvidgas
  bortom Pokémon behöver den formuleringen växa med.
- **Träning på användarens bilder deklareras.** Den ena skriver rakt ut att skannade
  bilder används för att träna deras igenkänningsmodeller. Den andra nämner inte
  skanningsbilder alls i sin integritetspolicy. Vår position är bättre än båda (bilderna
  sparas inte hos leverantören), men vi säger det bara i policyn, inte i villkoren, och vi
  säger aldrig uttryckligen att **vi inte tränar på dem**. Det är både ett skydd och ett
  säljargument som ligger oanvänt.

### 7.2 Vad ingen av dem täcker, men vi behöver

- **Värdering är en uppskattning, inte en värdering.** Ingen av dem separerar
  portföljsiffran från prisfriskrivningen. Vi har den, men som en bisats i §4.
- **Prisdatans källa namnges aldrig.** Ingen attribution, ingen leverantörsangivelse.
  Vi har ett större behov än de, eftersom vår data är härledd från en namngiven
  marknadsplatsplattform via en återförsäljare.
- **Larm som bästa förmåga saknas helt** i kategorin. Det är väntat: de är rena
  spårningsverktyg utan bevakningsprodukt. Vi säljer Pro delvis på larmen, så luckan är
  vår ensam att fylla (lucka I).
- **Att agera för användarens räkning på en marknadsplats regleras inte** av någon av dem,
  trots att den ena appens integritetspolicy antyder att annonsering finns i produkten.
  Det är alltså ingen färdig mall att luta sig mot för lucka G.
- **Officiell gradering nämns inte av någon.** Ingen av apparna graderar skick, så det
  finns ingen praxis att följa. Vår graderingsklausul blir en originaltext.
- **EU-kraven saknas nästan helt**: ångerrätt, tvistlösningsorgan och
  rangordningstransparens förekommer knappt eller inte alls. Det är ingen ursäkt för oss.
  Det är tvärtom exakt det som skiljer en svensk tjänst från en nordamerikansk mall.
- **Ingen av dem har skiljedomsklausul eller avstående från grupptalan**, vilket är
  ovanligt för konsumentappar med amerikansk anknytning. Antag alltså inte att det är
  branschstandard. Mot en svensk konsument vore det ändå verkningslöst.

### 7.3 Två varnande exempel

- **Den ena parten säljer ett abonnemang utan att ha ett enda villkor om betalning.**
  Ingen prisuppgift, ingen förnyelse, ingen uppsägning, ingen återbetalning, ingen
  hänvisning till appbutiken. Marknadsföringssidan säger "avsluta när du vill" och länkar
  ingenstans. Det är precis den situation vår lucka J glider mot om §6 lämnas som den är.
- **Den andra partens villkor beskriver en ren spårningsapp utan marknadsplats, medan
  dess integritetspolicy talar om annonser, transaktioner och listningar som andra
  användare ser.** Två dokument som beskriver två olika produkter. Det är samma sorts fel
  som vår community-inkonsekvens i avsnitt 5, fast större, och det är en påminnelse om att
  villkor och policy måste uppdateras i samma rörelse.

### 7.4 Slutsats

**Vi ligger före kategorin på friskrivningar och efter den på formalia.** Vår
prisdatafriskrivning (§4) och vår varumärkesklausul (§1) är starkare än motsvarigheterna
hos båda de granskade, och vår oberoendeförklaring är tydligare än den ena partens, som
saknar den helt. Det som fattas är ångerrätt, tvistlösningsorgan, företagsuppgifter,
beloppstak och de klausuler som täcker funktioner kategorin inte har: larm, säljintegration
och AI-gradering. Formalia är den lättare av de två skulderna att betala av.

---

## 8. Beslut som bara ägaren kan fatta

Ingen av punkterna nedan kan avgöras i kod eller av en jurist. De måste besvaras innan
villkoren kan skrivas färdigt.

| # | Beslut | Blockerar |
| --- | --- | --- |
| 1 | **Juridisk person**: enskild firma eller aktiebolag? Fullständigt namn, organisationsnummer, geografisk adress, momsregistreringsnummer. | Allt. Detta är den första dominobrickan. |
| 2 | **Skanningstaket**: vad gäller egentligen för Pro, och ska det kallas obegränsat med skälig användning eller anges som en siffra? | Lucka D, prissidan, skannerns gränssnitt |
| 3 | **Återbetalningspolicy**: återbetalar vi någonsin? Vad gäller vid avstängning mitt i en betald period, och vid nedläggning av tjänsten? | Lucka B och K |
| 4 | **Webbetalning**: när, och med vilken betalleverantör? Svaret avgör om vi själva blir säljare och därmed ångerrättsskyldiga. | Lucka B och J |
| 5 | **Support-SLA**: behåller vi löftet om 48 timmar, mjukar upp det till ett mål, eller tar vi bort det? | Lucka T |
| 6 | **Affiliate**: är det aktivt för någon butik idag, och ska sponsrade länkar märkas per länk eller generellt? | Lucka H |
| 7 | **Åldersgräns**: 13, 16 eller 18 för konto, och krävs vårdnadshavares samtycke för betalning under 18? | Lucka N |
| 8 | **Beloppstak i ansvarsbegränsningen**: tolv månaders avgifter, ett fast belopp, eller något annat? Och vad gäller för gratisanvändare? | Lucka M |
| 9 | **Community**: lanseras det, och i så fall när? Villkorstexten bör skrivas före lanseringen. | Lucka P |
| 10 | **Språkversion**: gäller den svenska eller den engelska vid konflikt? | Lucka R |
| 11 | **Datalicenser**: vem utreder rätten att visa kortbilder och härledd prisdata, och när? | Lucka F2 |
| 12 | **Jurisdiktion**: allmän domstol med angiven förstainstans, eller enbart hänvisning till ARN och allmän domstol? | Lucka C och S |

---

## 9. Föreslagen ordning

1. **Beslut 1** (juridisk person). Utan den kan ingenting publiceras.
2. **Rätta de interna inkonsekvenserna** i avsnitt 5. De kostar en timme och gör juristens
   arbete mycket billigare.
3. **Lucka C** (ARN). En mening, ett lagkrav, noll beslut krävs utöver beslut 12.
4. **Luckorna D, E och G** (kvoter, AI-utdata, Tradera). Störst faktisk exponering.
5. **Lucka B och J** (ångerrätt och abonnemangsvillkor), samordnat med beslut 3 och 4.
6. **Resten**, i den ordning juristen föredrar.
7. **Integritetspolicypasset** (avsnitt 6) som en egen omgång.
8. **Lucka F2** (datalicenser) som en helt egen utredning, parallellt.

Utkast till klausultexterna finns i [`TERMS-DRAFT-CLAUSES.md`](TERMS-DRAFT-CLAUSES.md).
</content>
