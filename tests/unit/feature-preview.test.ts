import { describe, expect, it } from "vitest";
import { parsePreviewEmails, previewAllowed } from "@/lib/feature-preview";

describe("previewAllowed — förhandsvisning bara för ägaren tills spaken slås på", () => {
  it("är DOLD utan flagga, utan roll och utan listad e-post (fail-safe)", () => {
    expect(previewAllowed({ feature: "SCAN_COUNTER", role: "USER", email: "a@b.se" })).toBe(false);
    expect(previewAllowed({ feature: "PUSH_TO_STORE" })).toBe(false);
  });
  it("öppnas av FEATURE_<X>_PUBLIC=1 exakt — inte 'true', inte ' 1x'", () => {
    expect(previewAllowed({ feature: "SCAN_COUNTER", publicFlag: "1" })).toBe(true);
    expect(previewAllowed({ feature: "SCAN_COUNTER", publicFlag: " 1 " })).toBe(true);
    expect(previewAllowed({ feature: "SCAN_COUNTER", publicFlag: "true" })).toBe(false);
    expect(previewAllowed({ feature: "SCAN_COUNTER", publicFlag: "" })).toBe(false);
  });
  it("öppnas för ADMIN/SUPERADMIN, aldrig MODERATOR/USER", () => {
    expect(previewAllowed({ feature: "PUSH_TO_STORE", role: "SUPERADMIN" })).toBe(true);
    expect(previewAllowed({ feature: "PUSH_TO_STORE", role: "ADMIN" })).toBe(true);
    expect(previewAllowed({ feature: "PUSH_TO_STORE", role: "MODERATOR" })).toBe(false);
  });
  it("öppnas för e-post i FEATURE_PREVIEW_EMAILS, skiftlägesokänsligt, med luft", () => {
    const previewEmails = " Test@Foilio.se, other@x.se ,";
    expect(previewAllowed({ feature: "SCAN_COUNTER", role: "USER", email: "test@foilio.se", previewEmails })).toBe(true);
    expect(previewAllowed({ feature: "SCAN_COUNTER", role: "USER", email: "nope@foilio.se", previewEmails })).toBe(false);
    expect(previewAllowed({ feature: "SCAN_COUNTER", role: "USER", email: "", previewEmails: "," })).toBe(false);
  });
  it("parsePreviewEmails ignorerar tomma poster", () => {
    expect([...parsePreviewEmails(" a@b.se,, ,C@d.se ")]).toEqual(["a@b.se", "c@d.se"]);
  });
});
