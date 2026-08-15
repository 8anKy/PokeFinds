---
paths:
  - "src/components/**"
  - "src/app/**/layout.tsx"
  - "src/lib/haptics.ts"
  - "src/lib/product-overlay-open.ts"
  - "tailwind.config.ts"
  - "src/app/globals.css"
---
# UI-skal: haptik, bottenark, lager, layoutmått

- **HAPTIK BOR I `src/lib/haptics.ts`, MED TRE STYRKOR (2026-08-02)**: `hapticTick` (långtryck löste ut, val
  gjordes), `hapticGlide` (fingret gled till ett NYTT värde) och `hapticImpact` (något blev klart — skannern
  låste ett kort). ⛔ Hitta inte på millisekunder på anropsstället: spridda `vibrate(37)` ger en app som känns
  olika på olika ställen utan att någon bestämt det. ⛔ **Haptik per VÄRDE, aldrig per pixel** — `onMouseMove` på
  prisgrafen eldar hundratals gånger i sekunden, så `price-chart.tsx` jämför mot `lastHaptic` och vibrerar bara
  när datapunkten byts. Gesterna som har haptik är de som saknar visuell kvittens: långtryck på "+" (arket hinner
  inte upp förrän efter animationen), långtryck för att kopiera namnet (ticket kommer NÄR gesten löser ut, medan
  fingret ligger kvar — kopian sker fortfarande på pointerup) och grafens skrubb (fingret täcker sin egen
  träffpunkt). ⚠️ **`navigator.vibrate` finns INTE i iOS Safari/WKWebView** — på iPhone händer ingenting, tyst och
  utan fel. **Därför finns `@capacitor/haptics` sedan 2026-08-02**: modulen försöker plugin:et FÖRST (Taptic
  Engine på iOS, bättre känsla även på Android) och faller till `navigator.vibrate`. ⛔ Plugin:et nås via
  BRYGGAN (`Capacitor.Plugins.Haptics`), aldrig via `import` — samma mönster som Keyboard-plugin:et, av samma
  skäl: koden körs också på webben där paketet inte har någon native-sida, och en statisk import hade dragit in
  modulen i webbuntet i onödan. ⚠️ **iOS är tyst tills `npx cap sync` körts och appen byggts om (Codemagic) —
  en `git push` räcker INTE.**
- **⛔ `Haptics.selectionChanged()` ÄR EN TYST NO-OP PÅ iOS UTAN `selectionStart()` (2026-08-02)**: Capacitor
  skapar `UISelectionFeedbackGenerator` först i `selectionStart()`, så ett ensamt `selectionChanged()` returnerar
  utan fel och utan vibration. Det var därför långtrycken kändes på iPhone men graferna inte gjorde det —
  långtrycket använder `impact()`, som inte kräver någon förberedelse. `hapticGlide` använder därför **LIGHT
  impact**, inte selection: start/ändrad/slut-livscykeln vore "rättare" men kräver att varje anropsställe
  signalerar när en gest BÖRJAR och SLUTAR, dvs mer API-yta och fler sätt att glömma ett anrop, för en
  nyansskillnad i känsla. Glide har dessutom en spärr på `GLIDE_MIN_GAP_MS` (45 ms): Taptic Engine hinner inte
  återgå tätare än så och iOS SLÄPPER de överflödiga, så utan spärren blir resultatet FÄRRE kännbara tick.
- **⛔ RECHARTS SYNTETISERAR INTE MUS-EVENTS FRÅN TOUCH (2026-08-02)**: diagrammets `onMouseMove` fyras BARA av
  mus, och biblioteket typar inga touch-props på `AreaChart`. Grafens haptik satt först där och fungerade därför
  bara på desktop — mätt i fält: långtrycken vibrerade på iPhone, graferna gjorde det inte. TOOLTIPEN däremot
  renderas av recharts för båda inmatningssätten, så haptiken bor i `ChartTooltip` och triggas när `label` byts
  (dvs per DATAPUNKT, aldrig per pixel). `onMouseMove` driver fortfarande linjens uttoning, inget mer.
  Portföljgrafen och produktsidans prishistorik delar `PriceChart` — en fix, båda ytorna.
- **BOTTENARKET ÄR APPENS "VÄLJ OCH BEKRÄFTA"-FORM (ägarbeslut 2026-08-02)**: `src/components/ui/bottom-sheet.tsx`
  — mörk överlagring, rundad panel som glider upp, draghandtag, rubrikrad med valfri åtgärd, scrollande kropp,
  fast fot med huvudknappen. Katalogens filter-/sorteringsark var förlagan; snabbtillägget i samlingen (håll in
  "+") byggdes först som en popover ankrad vid knappen och gjordes om till samma ark. ⛔ **EN implementation.**
  Tangentbordslyftet är den kluriga delen och bär en dokumenterad Capacitor-fälla (native kör `Keyboard
  resize:none` → varken WKWebView eller `visualViewport` krymper, bryggan är enda pålitliga signalen) — den får
  inte kopieras. `explore-filter-bar.tsx`s `Sheet` är sedan dess ett tunt skal som bara fyller i filtrens egen copy.
  Vinsten med formbytet var att ankarmätning, portal förbi kortets `overflow-hidden`, flip över/under, klampning
  mot visualViewport, omräkning när felraden ändrar höjden och följ-ankaret-vid-scroll ALLA försvann: ett ark är
  fäst vid skärmen, inte vid ett kort.
- **PRODUKT-OVERLAYNS z-index ÄR INTE EN KONSTANT (2026-08-02)**: overlayn ligger på z-40 (över sidans header,
  UNDER bottenflikarna som målas senare i DOM). Skannern är `fixed inset-0 z-[60]` → "Visa produkt" därifrån
  öppnade overlayn UNDER kameravyn: den monterades och hämtade sitt data, men användaren såg ingenting hända.
  Buggen var aldrig länken, den var målningsordningen. En helskärmsvärd anmäler sig med `registerFullscreenHost()`
  (`src/lib/product-overlay-open.ts`, RÄKNARE inte boolean) och BARA då lyfts overlayn till z-[70]. ⛔ Höj den
  aldrig permanent — då försvinner bottenflikarna bakom den i vanlig bläddring, vilket är hela skälet till z-40.
- **SIDANS VÅGRÄTA LUFT = 10px PÅ MOBIL (2026-07-29)**: varje sidbehållare kör `px-2.5 sm:px-6` — samma tal som
  rutnätets gap (10px), så luften utanför korten är exakt luften mellan dem. Den var 16px (`px-4`) och läste som en
  bred ram runt en smal app. Talet delas av ALLT som möter kanten: sidbehållarna (marketing + app-shellens `<main>`),
  `SiteHeader` och `SiteFooter` — annars ligger inte logotypen i linje med korten, och sökfältet (som bor i sidans
  behållare) blir bredare än rutnätet. ⛔ **Ändrar du talet måste varje kant-till-kant-rad följa med**: de bleeder med
  `-mx-2.5` + `px-2.5`/`pl-2.5` (chip-raden i `explore-filter-bar`, "Nyss släppt"-rälsen på /produkter, liknande
  produkter i `product-detail-view`, samlingsgrafen). Ett kvarglömt `-mx-4` mot en `px-2.5`-behållare skjuter 4px
  utanför viewporten på VARJE sida → hela sidan går att dra i sidled. ÅTERSTÄLLNING: taggen `kortlayout-v2` = exakt
  utseendet före det här passet.
- **SIDANS LODRÄTA HÖJD: SKALET MÅSTE DRA AV ALLT SOM LIGGER UTANFÖR SKALET (2026-08-05)**: `/mer` och
  `/community` gick att svepa fast allt syntes. Tre poster adderar dokumenthöjd UTANFÖR sidskalet, och
  missas EN går sidan att scrolla precis så mycket: (1) `BottomTabs` klarerings-spacer (`h-16`) är ett
  SYSKON till skalet i rot-layouten, (2) `body { padding-top: env(safe-area-inset-top) }` i globals.css
  (~44–59 px på telefon med urklipp), (3) `100vh` är den STORA viewporten på mobilwebb — använd `100dvh`.
  Därav `min-h-[calc(100dvh_-_4rem_-_env(safe-area-inset-top))] lg:min-h-screen` i `app-shell.tsx` och
  `(marketing)/layout.tsx`. ⚠️ **Post 1 och 2 är NOLL på desktop** (spacern är `lg:hidden`, `env()` = 0) —
  uppmätt spill i datorwebbläsaren var 0 px medan telefonen scrollade. **Verifiera på telefon.**
  ⛔ `overscroll-behavior: none` MÅSTE stå på `html`: egenskapen propagerar till viewporten bara från
  ROT-elementet (till skillnad från `overflow`, som propagerar från body). Den låg på `body` med en
  kommentar som påstod att studsen var av — uppmätt värde på html var `auto`. På iOS känns rubber-band
  exakt som scroll och maskerar felsökningen.
  ⛔ **`LockScroll` är BORTTAGEN — återinför den inte.** Den satte `overflow:hidden` för att dölja den
  extra höjden: en gardin för en mätbar layoutbugg. Den gömde Adminpanel/Logga ut bakom e-postbannern,
  och två sidor som båda låser återställer varandras sparade `overflow` (därav "scrollar först efter en
  tur via /community"). Med rätt höjd sköter webbläsaren det: får innehållet plats scrollar det inte.
  ⛔ Tailwind arbiträra värden kräver UNDERSTRECK för mellanslag — `calc(100dvh-4rem)` är ogiltig CSS och
  tappas TYST. Verifiera i den kompilerade CSS:en, inte i källan.
- **APPEN ÄR LÅST TILL PORTRÄTT, OCH BREDD ENSAM BETYDER INTE DESKTOP (2026-07-29)**: native-appen är en WebView över
  den hostade webbappen, så en telefon i liggande läge (844–932px bred, ~430px hög) tog `md:`-grenen och webbens
  toppnavigering dök upp ovanför bottentabbarna — mitt i appen. Låset sitter på båda plattformarna:
  `android:screenOrientation="portrait"` (AndroidManifest, incheckad) och `UISupportedInterfaceOrientations` = bara
  porträtt för iPhone. ⛔ **iOS-låset bor i `codemagic.yaml`, inte i `ios/App/App/Info.plist`** — `ios/` är gitignorerad
  och genereras färskt av `cap add ios` vid varje bygge, så en ändring i plisten skrivs över (samma sak som
  kamera-usage-strings och entitlements redan gör där). iPad-nyckeln lämnas orörd — där ÄR desktop-layouten rätt.
  Båda kräver ett NYTT native-bygge; en `git push` räcker inte. Webben/PWA:n har samma regel på sitt eget sätt: `orientation: "portrait"` i
  `public/manifest.json` + skärmarna `sm-tall`/`md-tall` i `tailwind.config.ts`
  (`(min-width: …) and (min-height: 600px)`), som headerns navigering och "Översikt"-knappen använder i stället för
  `md:`/`sm:`. ⛔ Grinda desktop-chrome på HÖJD också när ytan bara kan vara en telefon på tvären — annars fixar låset
  bara appen och lämnar webben trasig (och skyddar inte om OS:et överstyr låset).
- **Designtokens**: SVART yta + turkos signaturaccent (`holo.cyan` = `#2dd4bf`). Allt färgsätts via tokens i `tailwind.config.ts` — undvik hårdkodade hex/`*-blue-*`-klasser i komponenter så att tema förblir centralt.
  **YTAN ÄR SVART SEDAN 2026-07-29** (var charcoal `#0a0a0c`/`#141417`): `surface` OCH `surface-raised` = `#000000`. Kortet ligger
  alltså på samma yta som sidan och separeras BARA av hårlinjen (`surface-border` `#2a2a30`) + inset-highlighten i `.card-surface`
  (`rgba(255,255,255,.03)` — `.02` räckte på charcoal men syns inte alls på svart). ⛔ **`surface-overlay` (`#1d1d21`) är INTE en
  bakgrund och ska INTE sänkas till svart**: den är en interaktiv FYLLNING — hover-rader (`hover:bg-surface-overlay/50`), aktiva
  flikar, progress-spår, skeletons, bild-platshållare. På svart försvinner alla de spåren. Följdregeln: en yta som ligger PÅ
  overlay (menypanelen i `dropdown.tsx`, träfflistan i `collection-client.tsx`) måste hovra till något LJUSARE än overlay
  (`surface-border/50`) — `surface-raised` är numera mörkare och gav en bakvänd hover. Samma sak för fyllda pillar utan kant:
  `bg-surface-raised` är osynlig på ett svart kort.
