import { describe, expect, it } from "vitest";
import release from "@/data/app-release.json";
import { localizedNote, updatePrompt, type AppRelease } from "@/lib/app-release";

const R: AppRelease = {
  version: "1.4",
  released: "2026-10-08",
  minVersion: "1.2",
  androidOnPlay: true,
  notes: [{ icon: "link", title: "Länkar öppnar appen", text: "…", en: { title: "Links open the app", text: "…" } }],
};

describe("updatePrompt", () => {
  it("iPhone: visas med nyheterna när App Store har filens version", () => {
    const p = updatePrompt({ platform: "ios", installed: "1.3", release: R, iosStoreVersion: "1.4" });
    expect(p).toMatchObject({ mode: "optional", version: "1.4", installed: "1.3", released: "2026-10-08" });
    expect(p?.notes).toHaveLength(1);
  });

  it("iPhone: Apples releasedatum vinner över filens (1.4 stod på 8 okt, släpptes 6 okt)", () => {
    const p = updatePrompt({
      platform: "ios",
      installed: "1.3",
      release: R,
      iosStoreVersion: "1.4",
      iosStoreReleased: "2026-10-06",
    });
    expect(p?.released).toBe("2026-10-06");
    // Även när butiken ligger före filen: Apple vet datumet, nyheterna utelämnas ändå.
    const ahead = updatePrompt({ platform: "ios", installed: "1.3", release: R, iosStoreVersion: "1.5", iosStoreReleased: "2026-11-01" });
    expect(ahead).toMatchObject({ notes: [], released: "2026-11-01" });
  });

  it("Android: filens datum (inget publikt uppslag)", () => {
    const p = updatePrompt({ platform: "android", installed: "1.3", release: R, iosStoreReleased: "2026-10-06" });
    expect(p?.released).toBe("2026-10-08");
  });

  it("iPhone: under Apples granskning (butiken har 1.3) lovas inte 1.4", () => {
    expect(updatePrompt({ platform: "ios", installed: "1.3", release: R, iosStoreVersion: "1.3" })).toBeNull();
  });

  it("iPhone: butiken nyare än filen ⇒ skärmen visas men utan påhittade nyheter", () => {
    const p = updatePrompt({ platform: "ios", installed: "1.3", release: R, iosStoreVersion: "1.5" });
    expect(p).toMatchObject({ version: "1.5", notes: [], released: null });
  });

  it("iPhone: okänd butiksversion ⇒ ingen skärm", () => {
    expect(updatePrompt({ platform: "ios", installed: "1.3", release: R, iosStoreVersion: null })).toBeNull();
  });

  it("Android: bara när androidOnPlay är satt", () => {
    expect(updatePrompt({ platform: "android", installed: "1.2", release: R })).toMatchObject({ version: "1.4" });
    expect(updatePrompt({ platform: "android", installed: "1.2", release: { ...R, androidOnPlay: false } })).toBeNull();
  });

  it("tvingad bara under minVersion", () => {
    expect(updatePrompt({ platform: "ios", installed: "1.1", release: R, iosStoreVersion: "1.4" })?.mode).toBe("required");
    expect(updatePrompt({ platform: "ios", installed: "1.2", release: R, iosStoreVersion: "1.4" })?.mode).toBe("optional");
  });

  it("redan uppdaterad, nyare eller okänd installerad version ⇒ ingen skärm", () => {
    expect(updatePrompt({ platform: "ios", installed: "1.4", release: R, iosStoreVersion: "1.4" })).toBeNull();
    expect(updatePrompt({ platform: "ios", installed: "1.5", release: R, iosStoreVersion: "1.4" })).toBeNull();
    expect(updatePrompt({ platform: "ios", installed: null, release: R, iosStoreVersion: "1.4" })).toBeNull();
    expect(updatePrompt({ platform: "ios", installed: "beta", release: R, iosStoreVersion: "1.4" })).toBeNull();
  });
});

describe("localizedNote", () => {
  it("engelska när den finns, annars svenskan", () => {
    expect(localizedNote(R.notes[0], "en").title).toBe("Links open the app");
    expect(localizedNote(R.notes[0], "sv").title).toBe("Länkar öppnar appen");
    expect(localizedNote({ title: "Bara svenska", text: "x" }, "en").title).toBe("Bara svenska");
  });
});

describe("app-release.json (filen ägaren skriver)", () => {
  it("är giltig: versioner tolkbara, datum ISO, minst en nyhet med titel och text", () => {
    expect(release.version).toMatch(/^\d+(\.\d+)*$/);
    expect(release.minVersion).toMatch(/^\d+(\.\d+)*$/);
    expect(release.released).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(typeof release.androidOnPlay).toBe("boolean");
    expect(release.notes.length).toBeGreaterThan(0);
    for (const n of release.notes) {
      expect(n.title.trim()).not.toBe("");
      expect(n.text.trim()).not.toBe("");
    }
  });
});
