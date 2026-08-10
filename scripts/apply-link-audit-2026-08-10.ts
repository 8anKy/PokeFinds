/**
 * VERKSTÄLLER LÄNKREVISIONEN 2026-08-10 (store-health-körning 31430977783).
 *
 * Underlag + domar: granskningssidan "Länkrevision 2026-08-10" (artifact) och
 * minnesfilen restock-audit-2026-08-10. Kör ALLTID torrt först:
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-link-audit-2026-08-10.ts          # torrkörning
 *   node scripts/with-prod-db.mjs npx tsx scripts/apply-link-audit-2026-08-10.ts --apply  # verkställ
 *
 * Fyra faser:
 *  A. DÖDA LÄNKAR (88): offern raderas — men BARA om sidan svarar 404/410 ÄVEN NU
 *     (tredje kontrollen; revisionen 20:32 UTC och omkontrollen 21:4x var de två första).
 *     Något annat svar → offern LÄMNAS och loggas. Ingen denylist: en död URL ligger
 *     inte i butikens feed, så auto-importen kan inte återskapa den.
 *  B. OMLÄNKNING (4): offern pekar på FEL katalogprodukt men sidans identitet är känd
 *     → offern flyttas till rätt produkt (offer-ID → produkt-ID, aldrig via URL).
 *  C. RADERA + LÅT AUTO-IMPORTEN GÖRA RÄTT (4): fel produkt, och den RÄTTA saknas i
 *     katalogen (Toxel-/Yanma-blistrar) eller får inte skapas (karaktärslös blister,
 *     ägarregel 08-08 — vakten blockerar redan återskapandet). Radera offern; feed-först-
 *     grenen återimporterar de tre förstnämnda som egna produkter med dagens vakter.
 *  D. KVAR FÖR ÄGAREN (2): Spelexpertens "Temporal Forces ETB - Flutter Mane/Iron Thorns"
 *     — butikens egen sidtitel nämner varianter som inte finns i TF; identiteten går
 *     inte att fastställa maskinellt. Ingen åtgärd här — listas bara.
 *
 * Efter batchen: recomputeProductPriceCache() EN gång (annars står gamla lägsta-priser
 * kvar i produktkorten tills nästa refresh).
 */
import { PrismaClient } from "@prisma/client";
import { recomputeProductPriceCache } from "../src/services/products";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
const UA = "FoilioBot/1.0 (+https://www.foilio.se)";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A. Döda länkar — 404 vid revisionen 20:32 OCH omkontrollen ~21:45 (2026-08-10 UTC). */
const DEAD: { id: string; store: string; url: string }[] = [
  { id: "cmsjhe9q8044eaecfwdi14mxc", store: "Cardlevels", url: "https://cardlevels.se/products/pokemon-tcg-island-guardians-tin-tapu-bulu" }, // Island Guardians Tins: Tapu Bulu GX Tin
  { id: "cmqe78h6w00t511sdat7fk58y", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-charizard-ex-special-collection" }, // Charizard ex Special Collection
  { id: "cmrij3n0v001e3f11q4l5m9pc", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-ancient-roar-sv4k-display-booster-box-japansk" }, // Ancient Roar Booster Box
  { id: "cmrispzdi000c11564lke68pb", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-violet-ex-sv1v-display-booster-box-japansk" }, // Violet ex Booster Box
  { id: "cmq9vb9e300hxmy4sqzai3135", store: "Alphaspel", url: "https://www.alphaspel.se/1762-pokemon-tcg/238046-pokemon-tcg-scarlet-violet-prismatic-evolutions-elite-trainer-box" }, // Prismatic Evolutions Elite Trainer Box
  { id: "cmr87zsm2004moi5xk5tgem5h", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-151-elite-trainer-box-acrylic-case" }, // 151 Elite Trainer Box
  { id: "cmrrd04qq000hmqo2kpedbt73", store: "Alphaspel", url: "https://www.alphaspel.se/1762-pokemon-tcg/349395-pokemon-tcg-mega-evolution-chaos-rising-premium-checklane-blister" }, // Chaos Rising: Flygon Premium Checklane Blister
  { id: "cmq9iphxf002uf1mpe6ebek2r", store: "Alphaspel", url: "https://www.alphaspel.se/1762-pokemon-tcg/306144-pokemon-tcg-trainers-toolkit-2025" }, // Trainer's Toolkit 2025
  { id: "cmsjhgpww058xaecf4fl91poi", store: "Pokexclusive", url: "https://pokexclusive.se/products/lost-origin-etb" }, // Lost Origin Elite Trainer Box
  { id: "cmrezkgqo000cn2577rlx5rlo", store: "Alphaspel", url: "https://www.alphaspel.se/1762-pokemon-tcg/348023-pokemon-tcg-mega-evolution-ascended-heroes-booster-bundle-6" }, // Ascended Heroes Booster Bundle
  { id: "cmr87xp2e000soi5xsfr7r0ds", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-white-flare-sv11w-1-booster-pack-japansk" }, // White Flare JP Booster
  { id: "cmrk674im002keiznyol63kht", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-evolutions-me02-phantasmal-flames-checklane-cottonee-max-1-per-person-kopia" }, // Phantasmal Flames: Whimsicott 1-Pack Blister
  { id: "cmr87z0h20038oi5xtiaaqm23", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-paradise-dragona-sv7a-display-booster-box-japansk" }, // Paradise Dragona Booster Box
  { id: "cmq9iphx8002of1mp670v0f85", store: "Alphaspel", url: "https://www.alphaspel.se/1762-pokemon-tcg/348779-pokemon-tcg-mega-zygarde-ex-premium-collection" }, // Mega Zygarde ex Premium Collection
  { id: "cmsjhe92f043saecf4252uxyo", store: "Cardlevels", url: "https://cardlevels.se/products/pokemon-tcg-battle-heart-tin-volcanion" }, // Battle Heart Tin: Volcanion EX Tin
  { id: "cmrlwx6mo001u12b8ru04fcfq", store: "Alphaspel", url: "https://www.alphaspel.se/1762-pokemon-tcg/353236-pokemon-tcg-mega-gengar-ex-tin-summer-2026" }, // Mega Moonlit Tins: Mega Gengar ex Tin
  { id: "cmq9iphwn0026f1mp8p5i7w1e", store: "Alphaspel", url: "https://www.alphaspel.se/1762-pokemon-tcg/298568-pokemon-tcg-scarlet-violet-destined-rivals-booster-pack" }, // Destined Rivals Booster
  { id: "cmr87xguj000doi5xj6lpsjf0", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-10-5-black-bolt-white-flare-white-flare-elite-trainer-box-forhandsbokning-kopia" }, // Black Bolt Elite Trainer Box
  { id: "cmr8810if0071oi5x63izybad", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sword-shield-time-gazer-s10d-display-booster-box-japansk" }, // Time Gazer Booster Box
  { id: "cmr87y242001joi5x9dbg6h62", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-white-flare-sv11w-display-booster-box-japansk" }, // White Flare JP Booster Box
  { id: "cmsjhea3o044kaecfj9pirv53", store: "Cardlevels", url: "https://cardlevels.se/products/pokemon-tcg-sword-shield-darkness-ablaze-booster-pack-kopia" }, // 151 Booster
  { id: "cmr87y0r1001goi5xxtelbo9o", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-mega-inferno-x-m2-display-booster-box-japansk" }, // Inferno X Booster Box
  { id: "cmsjheczs046waecfly2y7g4o", store: "Cardlevels", url: "https://cardlevels.se/products/pokemon-tcg-scarlet-violet-temporal-forces-booster-pack" }, // Temporal Forces Booster
  { id: "cmr87z7z4003koi5x09iqzjdf", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-super-electric-breaker-sv8-display-booster-box-japansk" }, // Super Electric Breaker Booster Box
  { id: "cmr87xwnw0017oi5xtv7i4fp6", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-black-bolt-sv11b-1-booster-pack-japansk" }, // Black Bolt JP Booster
  { id: "cmsjhe8x5043maecfzs4bf30l", store: "Cardlevels", url: "https://cardlevels.se/products/pokemon-tcg-battle-heart-tin-magearna" }, // Battle Heart Tin: Magearna EX Tin
  { id: "cmr9uvxwm000u27gptcjbg3on", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-evolutions-me04-chaos-rising-1-blister-pack" }, // Chaos Rising Sleeved Booster
  { id: "cmrpw6pqz02zb11269vxio19s", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-evolution-2-5-ascended-heroes-1st-random-tin" }, // Ascended Heroes Tins: Mega Meganium ex Tin
  { id: "cmr87z5uj003hoi5xhjgx1dx5", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sword-shield-vstar-universe-s12a-display-booster-box-japansk" }, // VSTAR Universe Booster Box
  { id: "cmsjhe8rj043gaecfle3hv1rp", store: "Cardlevels", url: "https://cardlevels.se/products/pokemon-scarlet-violet-8-5-prismatic-evolutions-elite-trainer-box" }, // Prismatic Evolutions Elite Trainer Box
  { id: "cmr87xk2b000joi5xigf2d8kn", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-mega-dream-m2a-display-booster-box-japansk" }, // MEGA Dream ex Booster Box
  { id: "cmr87yufy002woi5xl6syvnsg", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-stellar-miracle-sv7-display-booster-box-japansk" }, // Stellar Miracle Booster Box
  { id: "cmr87zcpv003toi5xqetmhyjv", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-3-pack-blister-morpeko" }, // Sword & Shield: Morpeko 3-Pack Blister
  { id: "cmqe78gzb00rt11sdkvdb1p45", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-evolutions-me02-phantasmal-flames-elite-trainer-box-max-2-per-person-1" }, // Phantasmal Flames Elite Trainer Box
  { id: "cmqe78qpr016511sdmlo4qi1u", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-6-twilight-masquerade-display-booster-box-1" }, // Twilight Masquerade Booster Box
  { id: "cmqe78hap00tr11sdy7wwwym4", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-evolutions-me02-phantasmal-flames-1-booster-pack-max-5-per-person" }, // Phantasmal Flames Booster
  { id: "cmsjhe83j042maecfi4bptsrd", store: "Cardlevels", url: "https://cardlevels.se/products/pokemon-tcg-battle-heart-tin-pikachu" }, // Battle Heart Tin: Pikachu EX Tin
  { id: "cmqe78jc6010911sdi6hmbwd8", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sword-shield-astral-radiance-display-booster-box" }, // Astral Radiance Booster Box
  { id: "cmqfsa9gw00cobvet1r2v6iss", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-4-paradox-rift-1-booster-pack" }, // Paradox Rift Booster
  { id: "cmqies6yh00p1lf5i7ltjshew", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-3-5-journey-together-1-booster-pack-kopia" }, // 151 Booster
  { id: "cmr87xvb00014oi5xy6464tr7", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-shiny-treasure-ex-sv4a-display-booster-box-japansk" }, // Shiny Treasure ex Booster Box
  { id: "cmqe78ho000vv11sdrlrm4lpg", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-5-temporal-forces-display-booster-box" }, // Temporal Forces Booster Box
  { id: "cmqe78oq5015f11sd7dga7if8", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-3-pack-blister-galarian-ponyta" }, // Sword & Shield: Galarian Ponyta 3-Pack Blister
  { id: "cmr8819nw007goi5xzzzj210m", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-cyber-judge-sv5m-display-booster-box-japansk" }, // Cyber Judge Booster Box
  { id: "cmrij3ua6001o3f11c6h2n5ir", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sword-shield-lost-origin-display-booster-box" }, // Lost Origin Booster Box
  { id: "cmqfseozi00fwbvetg2q9oira", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-evolution-3-perfect-order-elite-trainer-box-max-1-per-hushall" }, // Perfect Order Elite Trainer Box
  { id: "cmqe78h0o00s111sdncogi06q", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-evolutions-me02-phantasmal-flames-display-booster-box-max-1-per-hushall-1" }, // Phantasmal Flames Booster Box
  { id: "cmrij3wfm001u3f1157473xu2", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-snow-hazard-sv2p-display-booster-box-japansk" }, // Snow Hazard Booster Box
  { id: "cmqe78him00uv11sd0wcvnen1", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-6-5-shrouded-fable-elite-trainer-box" }, // Shrouded Fable Elite Trainer Box
  { id: "cmqe78pwe015t11sd9vdvaqcs", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-team-rockets-mewtwo-ex-league-battle-deck" }, // Team Rocket's Mewtwo ex League Battle Deck
  { id: "cmqe78h6800sz11sdquu73c8r", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-evolution-2-5-2-5-ascended-heroes-tech-sticker-collection-charmander-release-30-1" }, // Ascended Heroes: Charmander Tech Sticker Collection
  { id: "cmqe78idq00yl11sdzl72y6cb", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-8-surging-sparks-elite-trainer-box" }, // Surging Sparks Elite Trainer Box
  { id: "cmr87zvgu004soi5xm3c4m1n4", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sun-moon-shining-legends-marshadow-pin-collection-box" }, // Shining Legends: Marshadow Collection
  { id: "cmr99gjlg002i8wzmykcq23ks", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-black-bolt-sv11a-display-booster-box-japansk" }, // Black Bolt JP Booster Box
  { id: "cmr87yyc90035oi5xpp8x6tjn", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-2-paldea-evolved-display-booster-box-acrylic-case" }, // Paldea Evolved Booster Box
  { id: "cmr87z1tw003boi5xxx9kgsnv", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-mega-symphonia-m1s-display-booster-box-japansk" }, // Mega Symphonia Booster Box
  { id: "cmrjky6vc000g4xlic5dzuh4x", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-scarlet-ex-sv15-display-booster-box-japansk" }, // Scarlet ex Booster Box
  { id: "cmrk677eq003oeizntufj6s0r", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-evolutions-me02-phantasmal-flames-checklane-cottonee-max-1-per-person" }, // Phantasmal Flames: Cottonee 1-Pack Blister
  { id: "cmr87zon5004doi5x7qt612n0", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-platinum-supreme-victors-1-booster-charizard-artwork" }, // Supreme Victors Booster
  { id: "cmqe78hqt00wh11sdnbywex2c", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sword-shield-12-silver-tempest-1-booster-pack" }, // Silver Tempest Booster
  { id: "cmr8814080077oi5xfal3ntte", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-ruler-of-the-black-flame-sv3-display-booster-box-japansk" }, // Ruler of the Black Flame Booster Box
  { id: "cmr87yr6n002roi5xs8e0qwku", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-ancient-roar-sv4k-display-booster-box-japansk" }, // Ancient Roar Booster Box
  { id: "cmr87zu37004poi5xo6goaqxp", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-3-obsidian-flames-display-booster-box" }, // Obsidian Flames Booster Box
  { id: "cmr88002m0051oi5x7c6n2ggf", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-snow-hazard-sv2p-display-booster-box-japansk" }, // Snow Hazard Booster Box
  { id: "cmr87xly0000moi5x2rulynsi", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-terastal-festival-ex-sv8a-display-booster-box-japansk" }, // Terastal Festival ex Booster Box
  { id: "cmqe78hve00wp11sdjzbposll", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-ascended-heroes-first-partners-deluxe-pin-collection" }, // Ascended Heroes: First Partners Deluxe Pin Collection
  { id: "cmqe78hjl00v311sd1hkmglnf", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-4-paradox-rift-display-booster-box" }, // Paradox Rift Booster Box
  { id: "cmr88160h007aoi5xobgo5pay", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-raging-surf-sv3a-display-booster-box-japansk" }, // Raging Surf Booster Box
  { id: "cmr87z3yl003eoi5xf0v1ye1f", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-future-flash-sv5-display-booster-box-japansk" }, // Future Flash Booster Box
  { id: "cmr87z9z5003noi5xl4cbpeca", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-heat-wave-arena-sv9a-display-booster-box-japansk" }, // Heat Wave Arena Booster Box
  { id: "cmr87zjdn0044oi5xaebx477q", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sun-moon-remix-bout-sm11a-display-booster-box-japansk" }, // Remix Bout Booster Box
  { id: "cmr87xze7001doi5xsq7v2seo", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-10-5-black-bolt-white-flare-mini-tin-alomomola-axew-forkop-release-18-7-kopia-kopia-kopia-kopia-kopia-kopia-kopia" }, // Black Bolt & White Flare: Unova Garbodor Mini Tin
  { id: "cmr8812e90074oi5xxz48d06v", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sword-shield-space-juggler-s10p-display-booster-box-japansk" }, // Space Juggler Booster Box
  { id: "cmr881g66007qoi5x85r7lm7d", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-battle-partners-sv9-display-booster-box-japansk" }, // Battle Partners Booster Box
  { id: "cmr87ypbm002ooi5xuosjw7hh", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-crimson-haze-sv5a-display-booster-box-japansk" }, // Crimson Haze Booster Box
  { id: "cmr87yjl3002doi5xbpvygevm", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-night-wanderer-sv6a-display-booster-box-japansk" }, // Night Wanderer Booster Box
  { id: "cmqe78hgh00uj11sdlxdw0hqy", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-8-surging-sparks-booster-bundle-6-packs" }, // Surging Sparks Booster Bundle
  { id: "cmr87zwtx004voi5x2ylptr29", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sword-shield-star-birth-s9-display-booster-box-japansk" }, // Star Birth Booster Box
  { id: "cmr87zhq10041oi5x5rznc7dp", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sun-moon-double-blaze-sm10-display-booster-box-japansk" }, // Double Blaze Booster Box
  { id: "cmr87zbc9003qoi5x14em23nj", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-rebel-clash-3-pack-blister-duraludon" }, // Rebel Clash: Duraludon 3-Pack Blister
  { id: "cmr87y7la001soi5xmv4un3w6", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-scarlet-violet-pokemon-151-sv2a-display-booster-box-japansk" }, // Pokémon Card 151 Booster Box
  { id: "cmr87yg710027oi5x0d6x9fny", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sword-shield-vmax-climax-display-booster-box-japansk" }, // VMAX Climax Booster Box
  { id: "cmr87ymb2002joi5xasx83i1y", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sword-shield-9-brilliant-stars-display-booster-box-acrylic-case" }, // Brilliant Stars Booster Box
  { id: "cmr87zmri004aoi5xzbmoh4qp", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-sun-moon-sky-legend-sm10b-display-booster-box-japansk" }, // Sky Legend Booster Box
  { id: "cmqe78h3u00sn11sdzqkng3fp", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-charizard-x-ex-ultra-premium-collection-max-1-per-hushall" }, // Mega Charizard X ex Ultra-Premium Collection
  { id: "cmrij3p9z001j3f11hcv2k6po", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-xy-flashfire-1-booster-charizard-x-artwork" }, // Flashfire Booster
  { id: "cmqe78ih600yt11sdkvzt4iaw", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-cynthia-s-garchomp-ex-premium-collection" }, // Cynthia's Garchomp ex Premium Collection
  { id: "cmqe78h5100st11sdnc3lo3hi", store: "Samlarhobby", url: "https://samlarhobby.se/products/pokemon-mega-evolution-2-5-ascended-heroes-tech-sticker-collection-gastly-release-30-1-max-5-per-customer" }, // Ascended Heroes: Gastly Tech Sticker Collection
];

/** B. Omlänkningar — sidans identitet är känd, rätt produkt finns. */
const RELINK: { offerId: string; toProductId: string; note: string }[] = [
  {
    // Shinycards säljer Iron Valiant-varianten, offern satt på Roaring Moon-ETB:n.
    offerId: "cmqe91mva00lb5ycc88tskktx",
    toProductId: "cmqdy88w300jj11jha2wzm0jh", // Paradox Rift Iron Valiant Elite Trainer Box
    note: "Shinycards: PR ETB Iron Valiant (satt på Roaring Moon)",
  },
  {
    // Swepoke säljer Walking Wake-varianten, offern satt på Iron Leaves-ETB:n.
    offerId: "cmqe8s9vq00ay2xygri5ycjms",
    toProductId: "cmqdy88u300gz11jhmsp5nno1", // Temporal Forces Walking Wake Elite Trainer Box
    note: "Swepoke: TF ETB Walking Wake (satt på Iron Leaves)",
  },
  {
    // TCG Store säljer den VANLIGA bundlen, offern satt på Pokémon Center-versionen
    // (pokemonCenterMismatch-klassen — samma fel som de sju PC-ETB:erna 07-14).
    offerId: "cmsjh7e6p00luaecf7uu8tkx0",
    toProductId: "cmqdy88sw00f711jha4fwl2lr", // Shrouded Fable Booster Bundle Version 1
    note: "TCG Store: Shrouded Fable Bundle vanlig version (satt på PC-versionen)",
  },
  {
    // Speltrollets ?variant-länk: butikens egen variant-JSON säger "Moonlit Gift Tin -
    // Mega Gengar EX" — offern satt på Slashing Legends Zacian-tinen.
    offerId: "cmsg5cn53000g1ycdnt3yyxuv",
    toProductId: "cmqdy7mxw001t9rw43xwaf8mr", // Mega Moonlit Tins: Mega Gengar ex Tin
    note: "Speltrollet: Moonlit Mega Gengar-tin (satt på Zacian-tinen)",
  },
  {
    // Ägaren tittade på sidan 2026-08-11: Spelexpertens "TF ETB - Flutter Mane" är
    // Walking Wake-versionen (teal boxkonst, artnr POK85657-FLU) — butikens eget
    // variantnamn är påhittat. Offern satt på Iron Leaves-ETB:n.
    offerId: "cmr881x4u008koi5xb8ct44ry",
    toProductId: "cmqdy88u300gz11jhmsp5nno1", // Temporal Forces Walking Wake Elite Trainer Box
    note: "Spelexperten: 'Flutter Mane' = TF Walking Wake ETB (ägarverifierad 08-11)",
  },
];

/** C. Radera — rätt produkt saknas/får inte skapas; auto-importen gör om det rätt. */
const DELETE_WRONG: { offerId: string; note: string }[] = [
  { offerId: "cmrrd0ni503bhgbjr0tzxwq5a", note: "Spelexperten: Chaos Rising Checklane Toxel på Zacian-blistern" },
  { offerId: "cmrrcpwml019lgbjraqo5hfti", note: "Samlarhobby: Chaos Rising Checklane Toxel på Zacian-blistern" },
  { offerId: "cmr8ulwwe00pyxrgss3q0jp3p", note: "Spelexperten: Journey Together Checklane Yanma på S&V Gengar-blistern" },
  { offerId: "cmsjtwl8b056k7kcvozqiqr4d", note: "AuroraDex: karaktärslös 'Perfect Order 3-Pack Blister' på Makuhita 1-pack (ägarregel: karaktärslös blister binds aldrig)" },

  // ---- E. GTIN-revisionens ägarverdikt (2026-08-11): ägaren gick igenom alla 13
  // ---- konfliktprodukter; dessa fyra länkar dömdes FEL (Alphaspels tre var redan
  // ---- med bland de döda länkarna i fas A). Goblinen-URL:en är dessutom denylistad
  // ---- (slugen matchar produktnamnet exakt → hade bundits om vid nästa import).
  { offerId: "cmr5zoi2k01tx8lzq8qvzqmz9", note: "Manatörsk: Gengar-tin-sidan finns inte för produkten (ägarverdikt)" },
  { offerId: "cmqe78tka016u11sdzx9vuaql", note: "Goblinen: 'Mega Zygarde ex Premium Collection' är fel länk (ägarverdikt; URL denylistad)" },
  { offerId: "cmrij56o700353f11pzshmxdk", note: "MaxGaming: karaktärslös 'Perfect Order Blister 1-pack' på Makuhita (ägarverdikt; vakten blockerar återbindning)" },
  { offerId: "cmsju7zy107o57kcvh99caa2p", note: "Miniature Metropolis: karaktärslös 'ME5 checklane' på Makuhita (ägarverdikt; vakten blockerar återbindning)" },
];

/**
 * D. Ägarbeslut — BÅDA AVGJORDA 2026-08-11 (ägaren tittade på sidorna):
 *  - "Flutter Mane" = Walking Wake-versionen → omlänkad i fas B ovan.
 *  - "Iron Thorns" (cmq9ulhfh006pv4caundw4rok) = Iron Leaves-versionen (grön boxkonst,
 *    POK85657-IRO) — offern satt REDAN RÄTT på Iron Leaves-ETB:n. Ingen åtgärd.
 * Spelexpertens variantnamn är alltså butikens egna påhitt; boxkonsten avgör.
 */
const OWNER_PENDING: string[] = [];

async function stillDead(url: string): Promise<boolean> {
  try {
    const res = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
    return res.status === 404 || res.status === 410;
  } catch {
    return false; // nätfel ≠ bevisat död — rör inte offern
  }
}

async function main() {
  console.log(APPLY ? "== VERKSTÄLLER ==" : "== TORRKÖRNING (inga skrivningar) ==");

  // ---- A. Döda länkar ----
  const byHost = new Map<string, typeof DEAD>();
  for (const d of DEAD) {
    const h = new URL(d.url).host;
    if (!byHost.has(h)) byHost.set(h, []);
    byHost.get(h)!.push(d);
  }
  let deleted = 0, spared = 0;
  await Promise.all(
    [...byHost.values()].map(async (list) => {
      for (const d of list) {
        const dead = await stillDead(d.url);
        await sleep(1100);
        if (!dead) {
          console.log(`  SPARAS (svarar inte 404 längre): ${d.store} ${d.url}`);
          spared++;
          continue;
        }
        if (APPLY) await prisma.offer.delete({ where: { id: d.id } }).catch((e) => console.log(`  redan borta? ${d.id}: ${e.code ?? e}`));
        deleted++;
      }
    })
  );
  console.log(`A. döda länkar: ${deleted} raderade${APPLY ? "" : " (torrt)"}, ${spared} sparade`);

  // ---- B. Omlänkningar ----
  for (const r of RELINK) {
    const offer = await prisma.offer.findUnique({ where: { id: r.offerId }, select: { id: true, productId: true, url: true } });
    const target = await prisma.product.findUnique({ where: { id: r.toProductId }, select: { id: true, title: true } });
    if (!offer || !target) { console.log(`  HOPPAR (saknas): ${r.note}`); continue; }
    if (offer.productId === target.id) { console.log(`  REDAN RÄTT: ${r.note}`); continue; }
    console.log(`  omlänkar → "${target.title}": ${r.note}`);
    if (APPLY) await prisma.offer.update({ where: { id: offer.id }, data: { productId: target.id } });
  }

  // ---- C. Radera felbundna ----
  for (const d of DELETE_WRONG) {
    const offer = await prisma.offer.findUnique({ where: { id: d.offerId }, select: { id: true } });
    if (!offer) { console.log(`  redan borta: ${d.note}`); continue; }
    console.log(`  raderar: ${d.note}`);
    if (APPLY) await prisma.offer.delete({ where: { id: d.offerId } });
  }

  // ---- D. Kvar för ägaren ----
  for (const p of OWNER_PENDING) console.log(`  ÄGARBESLUT KVAR: ${p}`);

  if (APPLY) {
    await recomputeProductPriceCache();
    console.log("Pris-cache omräknad.");
  }
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());
