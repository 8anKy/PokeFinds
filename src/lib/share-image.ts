/**
 * Dela en bild (delningskortet) — EN väg per plattform, vald i förväg så att
 * knappen kan säga rätt sak ("Dela" eller "Spara bild") och döljas där inget går.
 *
 *  - "native"    appen med `@capacitor/share` (tillagt 2026-10-01): filen skrivs
 *                till app-cachen och OS-arket öppnas. Kräver ett NYTT bygge —
 *                äldre binärer saknar pluginet och faller till nästa väg.
 *  - "web-share" Web Share API med filer (iOS-WebViewen, mobil Safari/Chrome).
 *                ⛔ `navigator.share` måste anropas i användarens tryck — därför
 *                ritas bilden FÖRE trycket (förhandsvisningen), aldrig i det.
 *  - "download"  datorn: en vanlig nedladdning. ⛔ Aldrig `navigator.share` på
 *                desktop — promiset hänger tills arket stängs (se event-share.tsx).
 *  - null        Android-appen utan pluginet: Android-WebViewen har varken Web
 *                Share eller fungerande nedladdning av en blob ⇒ ingen knapp.
 */

export type ShareMode = "native" | "web-share" | "download";
export type ShareOutcome = "shared" | "saved" | "cancelled";

function probeFile(): File | null {
  try {
    return new File([new Uint8Array([0])], "probe.jpg", { type: "image/jpeg" });
  } catch {
    return null;
  }
}

function canWebShareFiles(): boolean {
  if (typeof navigator === "undefined" || typeof navigator.canShare !== "function") return false;
  const f = probeFile();
  if (!f) return false;
  try {
    return navigator.canShare({ files: [f] });
  } catch {
    return false;
  }
}

export async function detectShareMode(): Promise<ShareMode | null> {
  if (typeof window === "undefined") return null;
  try {
    const { Capacitor } = await import("@capacitor/core");
    if (Capacitor.isNativePlatform()) {
      if (Capacitor.isPluginAvailable("Share") && Capacitor.isPluginAvailable("Filesystem")) return "native";
      return canWebShareFiles() ? "web-share" : null;
    }
  } catch {
    /* ingen Capacitor ⇒ webben */
  }
  const touch = window.matchMedia?.("(pointer: coarse)").matches ?? false;
  if (touch && canWebShareFiles()) return "web-share";
  return "download";
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ""));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}

/** Avbrutet av användaren — inget fel, bara inget att göra. */
function isCancel(e: unknown): boolean {
  const name = (e as { name?: unknown } | null)?.name;
  const msg = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return name === "AbortError" || /cancel/i.test(msg);
}

export async function shareImage(
  blob: Blob,
  filename: string,
  mode: ShareMode,
  title: string
): Promise<ShareOutcome> {
  if (mode === "native") {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([
      import("@capacitor/filesystem"),
      import("@capacitor/share"),
    ]);
    const data = await blobToBase64(blob);
    const { uri } = await Filesystem.writeFile({ path: filename, data, directory: Directory.Cache });
    try {
      await Share.share({ files: [uri], dialogTitle: title });
      return "shared";
    } catch (e) {
      if (isCancel(e)) return "cancelled";
      throw e;
    }
  }

  if (mode === "web-share") {
    const file = new File([blob], filename, { type: blob.type || "image/jpeg" });
    try {
      await navigator.share({ files: [file], title });
      return "shared";
    } catch (e) {
      if (isCancel(e)) return "cancelled";
      throw e;
    }
  }

  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    // Ge webbläsaren en stund att börja läsa innan adressen släpps.
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  return "saved";
}

/** "Charizard ex" → "foilio-charizard-ex.jpg" */
export function shareFilename(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return `foilio-${slug || "kort"}.jpg`;
}
