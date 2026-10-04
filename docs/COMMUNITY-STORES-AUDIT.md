# Fysiska communitybutiker – källrevision 2026-10-03

253 frysta filialer: 62 tidigare, 124 svenska Lekia-filialer, 12 aktuella Webhallen-filialer, 44 Kandyz-filialer och 11 specialistbutiker ur befintlig återförsäljarkatalog. 248 har källkontrollerad position; fem väntar på exakt position och visas med adress i kataloglistan.

## Positionspass 2026-10-05

13 av 26 filialer utan position fick en: butikens egen OSM-nod (Playoteket, Swepoke, Hemmakväll Uppsala/Växjö Marketenterivägen/Kungsbacka/Falun — noden ligger på eller ≤ 30 m från den officiella gatan), OSM-adresspunkt/byggnad med husnumret (Speltrollet 9 G i samma byggnad som 9 H, Röda Goblinen 35, Hemmakväll Karlshamn 27A–C, Mariestad Nya torget 1) eller köpcentret butiken ligger i (Kista Galleria, Frölunda Torg, Asecs). Kvar utan position: Leksaksaffären Hallsberg och Hemmakväll Nässjö, Höllviken, Falkenberg, Trelleborg, Västervik, Norrtälje, Piteå, Varberg, Mölnlycke, Lidköping, Trollhättan, Lerum — OSM har bara gatan där, och en gatumittpunkt sätts aldrig. Produktion fylls med `--fill-positions --apply` (rör bara null-positioner).

## Tillägg 2026-10-04: Costco, Hemmakväll, Gekås Ullared

74 filialer till (327 totalt, 301 med position).

- Costco: officiellt butiks-API `https://www.costco.se/rest/v2/sweden/stores?fields=FULL` (2 lagerhus, `geoPoint`). Arninges gatuadress (Saluvägen 5) står inte i API:t utan i Täby kommuns tillståndsregister.
- Hemmakväll: kedjans officiella butikssök (`/hitta-butik/`, PinMeTo, 72 poster; huvudkontoret i Landskrona utelämnat). Källan publicerar inga koordinater. Position sattes bara när OSM gav (a) exakt gata + husnummer + rätt postnummerprefix, eller (b) en Hemmakväll-taggad butiksnod på samma gata och postnummerprefix. Första passet utan postnummerkontroll hamnade i fel stad (Uddevalla → Vänersborg) — kontrollen är obligatorisk. 50 av 71 har position; 21 visas med adress.
- Gekås Ullared: officiell besökssida + OSM-ytan `way/41687713` (Danska vägen 13).
- Ingen av de tre publicerar Pokémon-sortiment per varuhus/filial ⇒ alla märks med obekräftat sortiment.

## Källor och avgränsning

- Lekia: officiell `/butiker` och varje filials ToyStore/PostalAddress/GeoCoordinates. Babya utan Lekia och Åland är utelämnade. Karlskronafilialen saknar publicerad adress i källan och är utelämnad tills den kan verifieras.
- Webhallen: officiell `https://www.webhallen.com/api/store/se`, aktuell publik katalog (12 filialer); lager/upphämtningspunkter publiceras inte som butiker.
- Kandyz: `https://kandyz.se/hitta-butik/`, filialadress och data-lat/data-lng. Pokémon-produktkälla: kedjans egen Länna-filial. Sortiment i övriga filialer är obekräftat, aldrig lagerbevis.
- Specialistbutiker: varje rad i `src/data/community-stores-curated.json` bär officiell besökskälla och separat Pokémon-källa. Koordinater kommer från butikens karta eller OSM:s exakta gatunummer, aldrig ort-/gatucentrum.
- Kedjors webbsortiment bevisar inte filialsortiment. Lekextra/Lekia/Webhallen/Kandyz märks med obekräftat filialsortiment.
- En bolagsadress, planerad butik, mässdeltagande eller webbutik räcker inte. Spelexperten har verifierad orderutlämning på lager; det är inte bevis för en öppen butik med varor på hyllan och läggs inte in som sådan.

## Befintliga återförsäljare

57 katalogposter lästes i ett samlat read-only-uppslag. Tabellen dokumenterar publiceringsbeslut, inte ett påstående om att andra butiker aldrig kan öppna. Ett antal webbplatser svarade 429; då saknas verifiering och ingen privat-/bolagsadress gissas.

| Återförsäljare | Beslut | Källa |
| --- | --- | --- |
| Alphaspel | Fysisk filial verifierad; finns i communitykatalogen | https://alphaspel.se |
| Aquitaz | Ingen aktuell svensk besöksfilial verifierad | https://aquitaz.se |
| AuroraDex | Ingen aktuell svensk besöksfilial verifierad | https://auroradex.se |
| Beam Cardshop | Ingen svensk besöksfilial verifierad; utländsk verksamhet | https://beamcardshop.com |
| Blindbox | Ingen aktuell svensk besöksfilial verifierad | https://blindbox.se |
| Card Club | Ingen aktuell svensk besöksfilial verifierad | https://cardclub.se |
| Card Haven | Ingen aktuell svensk besöksfilial verifierad | https://cardhaven.se |
| CardGame | Officiella Om oss beskriver fysisk butik som framtida vision | https://cardgame.se |
| CardTrader | Datakälla/marknadsplats; ingen egen svensk butik | https://www.cardtrader.com |
| Cardlevels | Ingen aktuell svensk besöksfilial verifierad | https://cardlevels.se |
| Cardmarket | Datakälla/marknadsplats; ingen egen svensk butik | https://www.cardmarket.com |
| Cardshop Sweden | Ingen aktuell svensk besöksfilial verifierad | https://cardshopsweden.se |
| Coolcard | Fysisk filial verifierad; finns i communitykatalogen | https://coolcard.se |
| Dragon's Lair | Fysisk filial verifierad; finns i communitykatalogen | https://www.dragonslair.se |
| Fantasia North | Fysisk filial verifierad; finns i communitykatalogen | https://fantasianorth.com |
| Firegames | Ingen aktuell svensk besöksfilial verifierad | https://firegames.se |
| Goblinen | Fysisk filial verifierad; finns i communitykatalogen | https://goblinen.com |
| Hobbykort | Ingen aktuell svensk besöksfilial verifierad | https://hobbykort.se |
| Kanto Vault | Ingen aktuell svensk besöksfilial verifierad | https://kantovault.se |
| Kortarkivet | Ingen aktuell svensk besöksfilial verifierad | https://www.kortarkivet.se |
| Leksaksaffären | Fysisk filial verifierad; finns i communitykatalogen | https://leksaksaffaren.com |
| Manatörsk | Fysisk filial verifierad; finns i communitykatalogen | https://manatorsk.com |
| MaxGaming | Ingen aktuell svensk besöksfilial verifierad | https://www.maxgaming.se |
| Miniature Metropolis | Fysisk filial verifierad; finns i communitykatalogen | https://miniaturemetropolis.se |
| Mock-datakälla | Datakälla/marknadsplats; ingen egen svensk butik | internal://mock |
| Mystery Shack | Ingen aktuell svensk besöksfilial verifierad | https://mysteryshack.se |
| NordicTCG | Ingen aktuell svensk besöksfilial verifierad | https://nordictcg.se |
| Packs on Packs | Ingen aktuell svensk besöksfilial verifierad | https://packsonpacks.se |
| Pocketmonsters | Ingen svensk besöksfilial verifierad; utländsk verksamhet | https://pocketmonsters.se |
| Pokemurre | Ingen aktuell svensk besöksfilial verifierad | https://pokemurre.se |
| Pokexclusive | Ingen aktuell svensk besöksfilial verifierad | https://pokexclusive.se |
| Pokémon TCG API | Datakälla/marknadsplats; ingen egen svensk butik | https://api.pokemontcg.io/v2 |
| Pokétalk | Ingen aktuell svensk besöksfilial verifierad | https://www.poketalk.se |
| RGB Kingz | Fysisk filial verifierad; finns i communitykatalogen | https://rgbkingz.com |
| RahTech | Ingen aktuell svensk besöksfilial verifierad | https://rahtech.se |
| Rogerz | Ingen svensk besöksfilial verifierad; utländsk verksamhet | https://rogerz.dk |
| SF-Bok | Fysisk filial verifierad; finns i communitykatalogen | https://www.sfbok.se |
| Samlarhobby | Ingen aktuell svensk besöksfilial verifierad | https://samlarhobby.se |
| Shinycards | Ingen aktuell svensk besöksfilial verifierad | https://www.shinycards.se |
| Spel & Sånt | Fysisk filial verifierad; finns i communitykatalogen | https://www.spelochsant.se |
| Spelbutiken | Ingen aktuell svensk besöksfilial verifierad | https://www.spelbutiken.se |
| Spelexperten | Orderutlämning på lager verifierad; hyllbutik inte verifierad | https://www.spelexperten.com |
| Spelgalaxen | Fysisk filial verifierad; finns i communitykatalogen | https://spelgalaxen.se |
| Spelkortsbutiken | Fysisk filial verifierad; finns i communitykatalogen | https://www.spelkortsbutiken.se |
| Speltrollet | Fysisk filial verifierad; finns i communitykatalogen | https://speltrollet.se |
| Sweet Nerds | Ingen aktuell svensk besöksfilial verifierad | https://sweetnerds.se |
| Swepoke | Fysisk filial verifierad; finns i communitykatalogen | https://www.swepoke.se |
| TCG Picks | Ingen aktuell svensk besöksfilial verifierad | https://tcgpicks.com |
| TCG Store | Ingen aktuell svensk besöksfilial verifierad | https://tcgstore.se |
| TCGdex API | Datakälla/marknadsplats; ingen egen svensk butik | https://api.tcgdex.net/v2 |
| The Swedish Fish | Ingen aktuell svensk besöksfilial verifierad | https://theswedishfish.se |
| Tiny Misters | Ingen aktuell svensk besöksfilial verifierad | https://tinymisters.com |
| Toyspace | Ingen aktuell svensk besöksfilial verifierad | https://toyspace.se |
| Tradera | Datakälla/marknadsplats; ingen egen svensk butik | https://www.tradera.com |
| Webhallen | Fysisk filial verifierad; finns i communitykatalogen | https://www.webhallen.com |
| World of Board Games | Fysisk filial verifierad; finns i communitykatalogen | https://www.worldofboardgames.com |
| Yonko TCG | Ingen svensk besöksfilial verifierad; utländsk verksamhet | https://yonko-tcg.de |

## Nya loggor

Lokala 128×128 PNG-plattor, användning som identifierare vid butikens egen uppgift. Ingen hotlinkning eller bildbearbetning på servern. Befintliga butiksmärken återanvänds. Alla 253 kurerade filialer har ett lokalt märke.

| Fil | Officiell märkesfil |
| --- | --- |
| public/retailer-logos/lekia.png | https://www.lekia.se/storage/59C228E9844813635170DEBB8BF3E67F47AD87122190B83061C1D69B3A44D90E/7220bea449fe4a2aa94002c6c66909d4/svg/media/b20161ace79b4e6f9955ead78f3cd3d4/lekialogo.svg |
| public/retailer-logos/lekextra.png | https://lekextra.se/wp-content/uploads/2024/11/Lekextra-logo-m-bakgrund-1.jpg |
| public/retailer-logos/kandyz.png | https://kandyz.se/wp-content/uploads/KANDYZ_logo-1.svg |
| public/retailer-logos/sfbok.png | https://www.sfbok.se/apple-icon.png |
| public/retailer-logos/playoteket.png | https://playoteket.com/img/cms/Play%20180x180.png |
| public/retailer-logos/leksaksaffaren.png | https://leksaksaffaren.b-cdn.net/img/logo-1652778872.jpg |
| public/retailer-logos/spel-och-sant.png | https://www.spelochsant.se/layout/images/logo.svg |
| public/retailer-logos/world-of-board-games.png | https://www.worldofboardgames.com/images/worldofboardgames_logo.webp |
| public/retailer-logos/spelkortsbutiken.png | https://irp.cdn-website.com/66863304/dms3rep/multi/opt/1000016965-385w.png |
