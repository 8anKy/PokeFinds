/**
 * sv.json och en.json måste vara spegelbilder.
 *
 * VARFÖR EN VAKT: översättningsfilerna redigeras för hand, i samma commit, och en
 * nyckel som bara läggs till i den ena går rakt igenom typkontroll, bygge och
 * granskning. Felet syns först för en användare på `/en/` — som en rå nyckelsträng
 * mitt i gränssnittet, eller ett kastat fel beroende på var den lästes.
 *
 * Testet gick igenom när det skrevs (1358 = 1358, noll skillnader åt båda håll),
 * så det kostar ingenting nu och fångar en-språks-commiten för alltid.
 */
import { describe, expect, it } from "vitest";
import sv from "../../messages/sv.json";
import en from "../../messages/en.json";

type Tree = { [k: string]: string | Tree };

function leafKeys(obj: Tree, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null ? leafKeys(v, `${prefix}${k}.`) : [`${prefix}${k}`]
  );
}

function emptyLeaves(obj: Tree, prefix = ""): string[] {
  return Object.entries(obj).flatMap(([k, v]) =>
    typeof v === "object" && v !== null
      ? emptyLeaves(v, `${prefix}${k}.`)
      : typeof v === "string" && v.trim() === ""
        ? [`${prefix}${k}`]
        : []
  );
}

describe("i18n-paritet", () => {
  const svKeys = new Set(leafKeys(sv as unknown as Tree));
  const enKeys = new Set(leafKeys(en as unknown as Tree));

  it("varje svensk nyckel finns på engelska", () => {
    expect([...svKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });

  it("varje engelsk nyckel finns på svenska", () => {
    expect([...enKeys].filter((k) => !svKeys.has(k))).toEqual([]);
  });

  it("ingen nyckel är tom i BARA det ena språket", () => {
    // ⚠️ Inte "aldrig tom": `Privacy.s5Items.4.lead` och `.5.lead` är tomma i
    // BÅDA filerna med flit (en listpost utan ingress). Det som är ett fel är
    // att den ena rutan renderar text och den andra ingenting.
    const svEmpty = new Set(emptyLeaves(sv as unknown as Tree));
    const enEmpty = new Set(emptyLeaves(en as unknown as Tree));
    expect([...svEmpty].filter((k) => !enEmpty.has(k))).toEqual([]);
    expect([...enEmpty].filter((k) => !svEmpty.has(k))).toEqual([]);
  });

  it("samma platshållare i båda språken", () => {
    // En saknad {count} på engelska ger en mening som ser klar ut men tappat sitt
    // tal — värre än en rå nyckel, för ingen märker det.
    // `[,}]` direkt efter namnet är inte pedanteri: utan det plockar regexen upp
    // första ordet inuti en ICU-plural-gren ("{Hos 1 butik}" → "Hos") och jämför
    // sedan svensk text mot engelsk.
    const placeholders = (s: string) =>
      [...s.matchAll(/\{(\w+)\s*[,}]/g)].map((m) => m[1]).sort();
    const flat = (obj: Tree, prefix = ""): [string, string][] =>
      Object.entries(obj).flatMap(([k, v]) =>
        typeof v === "object" && v !== null
          ? flat(v, `${prefix}${k}.`)
          : ([[`${prefix}${k}`, v as string]] as [string, string][])
      );
    const enMap = new Map(flat(en as unknown as Tree));
    const mismatched: string[] = [];
    for (const [key, value] of flat(sv as unknown as Tree)) {
      const other = enMap.get(key);
      if (other == null) continue;
      const a = placeholders(value).join(",");
      const b = placeholders(other).join(",");
      if (a !== b) mismatched.push(`${key}: sv[${a}] en[${b}]`);
    }
    expect(mismatched).toEqual([]);
  });
});
