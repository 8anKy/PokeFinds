/**
 * Ladda ner en fil från ett API-endpoint. WKWebView (Capacitor) renderar
 * attachment-svar inline istället för att spara → hämta som blob och antingen
 * dela (native share-sheet → "Spara i Filer") eller trigga vanlig nedladdning (web).
 */
export async function downloadFromApi(url: string, filename: string): Promise<void> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Export misslyckades (${res.status})`);
  const blob = await res.blob();

  const isNative = (globalThis as { Capacitor?: { isNativePlatform?: () => boolean } })
    .Capacitor?.isNativePlatform?.();
  if (isNative && typeof navigator.canShare === "function") {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare({ files: [file] })) {
      try {
        await navigator.share({ files: [file] });
        return;
      } catch {
        // användaren avbröt eller share stöds inte → fall igenom till nedladdning
      }
    }
  }

  const objUrl = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = objUrl;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(objUrl);
}
