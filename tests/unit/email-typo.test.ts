import { describe, expect, it } from "vitest";
import { suggestDomain, suggestEmailCorrection } from "@/lib/email-typo";

describe("suggestDomain", () => {
  it("lämnar kända domäner i fred", () => {
    for (const domain of [
      "gmail.com",
      "hotmail.se",
      "hotmail.com",
      "outlook.com",
      "icloud.com",
      "telia.se",
      "live.se",
    ]) {
      expect(suggestDomain(domain)).toBeNull();
    }
  });

  it("rättar vanliga skrivfel", () => {
    expect(suggestDomain("gmial.com")).toBe("gmail.com"); // omkastning
    expect(suggestDomain("gmai.com")).toBe("gmail.com"); // tappat tecken
    expect(suggestDomain("gnail.com")).toBe("gmail.com"); // grannetangent
    expect(suggestDomain("gmail.con")).toBe("gmail.com"); // toppdomän
    expect(suggestDomain("gmail.cm")).toBe("gmail.com");
    expect(suggestDomain("hotmial.com")).toBe("hotmail.com");
    expect(suggestDomain("hotmail.con")).toBe("hotmail.com");
    expect(suggestDomain("outlok.com")).toBe("outlook.com");
    expect(suggestDomain("iclud.com")).toBe("icloud.com");
  });

  it("rättar rätt leverantör på fel toppdomän", () => {
    expect(suggestDomain("gmail.se")).toBe("gmail.com");
    expect(suggestDomain("icloud.se")).toBe("icloud.com");
  });

  it("fångar adressen som studsade 2026-08-15", () => {
    // `email.com` är en riktig domän men står med flit inte i listan: i svensk
    // trafik är gmail-typon långt vanligare, och förslaget blockerar inget.
    expect(suggestEmailCorrection("hugomilenstrand@email.com")).toBe(
      "hugomilenstrand@gmail.com"
    );
  });

  it("gissar inte på domäner som inte liknar någon känd", () => {
    for (const domain of [
      "foilio.se",
      "kth.se",
      "student.liu.se",
      "mittforetag.com",
      "sverigesradio.se",
    ]) {
      expect(suggestDomain(domain)).toBeNull();
    }
  });

  it("ger inget förslag när två kandidater är lika nära", () => {
    // "hotmail.ces" ligger exakt 2 från både hotmail.se och hotmail.com — ett
    // myntkast, och ett myntkast i gränssnittet läser som ett påstående.
    expect(suggestDomain("hotmail.ces")).toBeNull();
  });

  it("nudgar inte den som har en riktig regional adress", () => {
    for (const domain of ["hotmail.fr", "hotmail.co.uk", "outlook.dk", "live.nl", "yahoo.co.uk"]) {
      expect(suggestDomain(domain)).toBeNull();
    }
  });

  it("rör aldrig lokaldelen", () => {
    expect(suggestEmailCorrection("Hugo.M@gmial.com")).toBe("Hugo.M@gmail.com");
    // Ett fel i lokaldelen går inte att gissa.
    expect(suggestEmailCorrection("hgo@gmail.com")).toBeNull();
  });

  it("klarar ofullständig inmatning utan att kasta", () => {
    for (const value of ["", "hugo", "hugo@", "@gmail.com", "hugo@gmail", "hugo@.com", "hugo@com."]) {
      expect(suggestEmailCorrection(value)).toBeNull();
    }
  });

  it("normaliserar versaler och blanksteg i domänen", () => {
    expect(suggestEmailCorrection("  hugo@GMIAL.COM  ")).toBe("hugo@gmail.com");
  });
});
