import { describe, expect, it } from "vitest";
import { captionBody, classifyStorePost, pokemonTermsFromSetNames } from "@/lib/store-social-filter";

/**
 * Fixturerna är RIKTIGA bildtexter ur svenska butikers Instagram (proben 2026-10-05),
 * förkortade. Lägg till det riktiga inlägget här när en regel ändras — annars vet ingen
 * vad regeln skulle fånga eller släppa.
 */
const SHOULD_POST: [string, string, string?][] = [
  ["delay", "God kväll! Tyvärr kommer vi inte att kunna sälja morgondagens releaser av Pokémon 30th Celebration (Bundles & Mini Tins), i och med att de inte dykt upp ännu."],
  ["set named only in a tag", "Nu är den här! Släpps i butiken på fredag kl 10 #pokemon #deltareign", "Delta Reign"],
  ["delay without release word", "Tyvärr måste vi skjuta på Pokémon 30th Celebration till onsdag den 23:e september. #fantasianorth #pokemon"],
  ["store release time", "Pokemon 30 år släpp 5! Efter 15:30 idag tisdag 22 sept #pokemon #spelexperten #sistachansen"],
  ["preorder opening", "Pokémon 30-årsjubileum – Mini Tins släpps för förhandsbokning!\nNu på lördag kl. 15:00 öppnar vi förhandsbokningen #pokemon #tcg"],
  ["arrived", "Vi fick en överraskning! Pokémon 30th Celebration har anlänt och eftersom ingen gillar att vänta så släpper vi produkterna i butiken imorgon"],
  ["pokemon only in tag block", "Lite info om #30th #celebration #pokemon bundle och mini tin ! Glöm nu inte följa för vara uppgraderad när vi släpper dom #fyp"],
  ["restock by set name, tag says pokemon", "Lite påfyllning av MEGA Dream EX och Inferno X! 🔥✨\n#pokemon #pokemontcg #megadream #infernox", "Inferno X (M2)"],
  ["in stock + purchase limit", "Pokémon TCG: Pitch Black Booster Bundle finns nu i lager – begränsat antal! Max 1 per person."],
  ["contest mentioned late, release first", "30th Celebratjons i Speltrollet butiken! 🥳🎉 På fredag smäller det! Då landar 30th Celebration hos oss och det blir fika, musik och fest hela dagen. Dessutom kör vi en liten tävling bland alla som handlar!"],
  ["noise hashtag must not kill a stock post", "151 BINDER COLLECTION NOW IN STOCK!🔥 WWW.THESWEDISHFISH.SE #pokemon #packopening"],
  ["in the store", "Vi har nu ett par Ascended Heroes Bundles i butik! ✨ #pokemon"],
];

const SHOULD_SKIP: [string, string, string][] = [
  ["raffle", "noise", "Tjenare gänget! Här kommer en sista påminnelse om att utlottningen av 1 st Destined Rivals ETB avslutas imorgon #pokemon"],
  ["giveaway opener", "noise", "🎉 GIVEAWAY – POKÉMON 30TH ANNIVERSARY! 🎉 Tillsammans med cardlevels firar vi Pokémon 30th med en ETB till en av er. Släpps snart!"],
  ["PSA service", "noise", "Missa inte alla PSA graderade kort som kommer upp idag vid 19:00 på hemsidan! #pokemon"],
  ["pull video", "noise", "Glad flicka öppnar en ex #sylveon box och drar detta 👀 Mimmi är 30th #celebration master ! #fyp #pokemon #tcg"],
  ["box opening", "noise", "Vi öppnar en hel Pokémon Abyss Eye Booster Box. Mitt i öppningen kommer en kund tillbaka in i butiken #pokemon"],
  ["learn-to-play night", "noise", "Prova på kväll på Miniature Metropolis! Sugen på att börja spela Pokémon TCG? Kom och testa den 9 september kl. 18–21!"],
  ["league kit", "noise", "Äntligen har vårt välkomstpaket från Pokémon League kommit! Vi har även fyllt på ordentligt med Pokémon-produkter i butiken."],
  ["trade fair", "noise", "Nu är det dags för Samlarkort Festivalen! Den 29-30 i Örebro. #pokémontcg #mtg"],
  ["accessories restock", "noise", "📦 Tillbehörslagret fylls på! 🔥 Vi har fyllt på med ännu mer tillbehör för alla Pokémon-samlare."],
  ["other game, pokemon only in tags", "no-pokemon", "OP 17 Release idag! Finns i butiken! Max 4 st per person #onepiececardgame #onepiece #op17"],
  ["mixed tags with another game", "no-pokemon", "Missa inte denna restock #onepiece #pokémon"],
  ["mixed post in body", "other-tcg", "It’s fascinating to follow the price development of Magic: The Gathering vs Pokémon. Today's release shows it."],
  ["greeting", "no-product", "Hoppas vi ses imorgon gott folk #pokemon #fyp #swepoke #tcg #malmö"],
  ["teaser without news", "no-product", "👀 Vi har tydligen gått och köpt 10 stycken av den här… En liten ledtråd till vad vi har på gång under hösten #Pokémon"],
  ["joke about the website", "no-release", "Sverige står inför ett vägval 🇸🇪 Högkostnadsskydd för Pokémonkort och mer Pokémon åt folket! Läs mer på vår hemsida."],
  ["Pokémon merch, not cards (owner: nobody cares)", "merch", "POKÉMON X POLAROID! 🤩 Release idag den 5 oktober, snart även i vår fysiska butik i Hammarby Sjöstad 🥰✨ pokemon polaroid #pokemon #fyp"],
  ["Pokémon merch preorder", "merch", "CAPTURE IT ALL 📸 Vi kan äntligen avslöja att vi blivit exklusiv fysisk återförsäljare för lanseringen av samarbetet mellan Pokémon och Polaroid! Förköp online: Startar 25 augusti"],
  ["plushies", "merch", "Ni har väl inte missat att vi har fått in nya pokemon 30th anniversary plushies? Kom in och kika!"],
  ["release party without a product", "no-product", "LYSSNA NOGA! Fredag den 25/9 kommer vi att ha fest i butiken, mer info kommer, men förvänta er DRESSCODE, RELEASE-FEST, KANSKE LITE FIKA! #pokemon #pokemoncommunity"],
  ["prerelease of another game", "noise", "Vi kör prerelease för Homeworlds på måndag 5/10 kl. 18:00. #starwarsunlimited #tcg"],
];

describe("classifyStorePost", () => {
  it.each(SHOULD_POST)("posts: %s", (_name, caption, setName) => {
    const terms = setName ? pokemonTermsFromSetNames([setName]) : [];
    expect(classifyStorePost(caption, terms)).toMatchObject({ relevant: true });
  });

  it.each(SHOULD_SKIP)("skips: %s", (_name, reason, caption) => {
    const v = classifyStorePost(caption);
    expect(v.relevant).toBe(false);
    if (!v.relevant) expect(v.reason).toBe(reason);
  });

  it("an upcoming set is recognised by name even without a product word", () => {
    const caption = "Delta Reign släpps på fredag! Vi öppnar kl 10.";
    expect(classifyStorePost(caption).relevant).toBe(false);
    expect(classifyStorePost(caption, pokemonTermsFromSetNames(["Delta Reign"])).relevant).toBe(true);
  });

  it("uses set names from the route table as Pokémon signals", () => {
    const caption = "Nu har vi fått in Ascended Heroes! #nyheter #tcg";
    expect(classifyStorePost(caption).relevant).toBe(false);
    expect(classifyStorePost(caption, pokemonTermsFromSetNames(["Ascended Heroes"])).relevant).toBe(true);
  });
});

describe("captionBody", () => {
  it("drops the trailing tag block but keeps single inline tags as words", () => {
    expect(captionBody("Release idag på #pokemon polaroid! #fyp #pokemon #tcg")).toBe("Release idag på pokemon polaroid!");
  });
});

describe("pokemonTermsFromSetNames", () => {
  it("lowercases, dedupes and drops short names that would false-match", () => {
    expect(pokemonTermsFromSetNames(["Ascended Heroes", "ascended heroes", "151", null, " Inferno X "])).toEqual([
      "ascended heroes",
      "inferno x",
    ]);
  });

  it("strips set codes and drops generic catalogue names", () => {
    expect(
      pokemonTermsFromSetNames(["Abyss Eye (M5)", "Expansion", "MEP Black Star Promos", "Mega Evolution Energy", "Gold, Silver, to a New World..."])
    ).toEqual(["abyss eye", "gold, silver, to a new world"]);
  });
});
