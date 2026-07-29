/**
 * SPIKE — delad sökväg till diskcachen.
 *
 * Egen modul med FLIT: låg den här i fetch-images.ts skulle `eval.ts` starta om
 * hela nedladdningen bara genom att importera funktionen (den filens `main()`
 * körs på toppnivå). En importbieffekt som drar igång 20 000 HTTP-anrop är den
 * sortens fel man upptäcker efter att den redan kört.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";

export function cachePath(cacheDir: string, id: string): string {
  const h = createHash("sha1").update(id).digest("hex");
  // Två nivåer så ingen katalog får 20 000 filer.
  return join(cacheDir, h.slice(0, 2), `${h}.img`);
}
