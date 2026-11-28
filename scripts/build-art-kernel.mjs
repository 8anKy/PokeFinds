/**
 * Bygger bildsökningens WebAssembly-kärna ur src/services/scanner/art-kernel.wat och skriver den
 * som base64 i art-kernel.generated.ts (incheckad — bygget och servern behöver ingen verktygskedja).
 *
 *   node scripts/build-art-kernel.mjs
 *
 * tests/unit/art-index-kernel.test.ts bygger om kärnan och jämför — en ändrad .wat utan ombyggnad
 * fäller sviten.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import wabtInit from "wabt";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "services", "scanner");
const wabt = await wabtInit();
const mod = wabt.parseWat("art-kernel.wat", readFileSync(join(dir, "art-kernel.wat"), "utf8"), { simd: true });
mod.validate();
const base64 = Buffer.from(mod.toBinary({}).buffer).toString("base64");
writeFileSync(
  join(dir, "art-kernel.generated.ts"),
  `// GENERERAD av scripts/build-art-kernel.mjs ur art-kernel.wat — redigera aldrig för hand.\n` +
    `export const ART_KERNEL_WASM_BASE64 =\n  "${base64}";\n`
);
console.log(`art-kernel.generated.ts: ${base64.length} tecken base64`);
