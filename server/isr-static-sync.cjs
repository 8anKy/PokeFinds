/**
 * Ackumulerar `/_next/static` på volymen så att ISR-sidor renderade av ett
 * TIDIGARE bygge fortfarande hittar sina chunk-hashar. Anropas av
 * `isr-cache-boot.cjs` före `next start`; se kommentaren i `cache-handler.cjs`.
 *
 *  1. volym → `.next/static`: återställ gamla chunks (skriv aldrig över).
 *  2. `.next/static` → volym: arkivera byggets chunks (skriv aldrig över, så
 *     mtime = första gången filen sågs).
 *  3. Rensa volymfiler som är äldre än MAX_AGE_DAYS OCH saknas i bygget.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");

const MAX_AGE_DAYS = 45;

function walk(dir, out = []) {
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

function copyNew(src, dst) {
  let copied = 0;
  for (const file of walk(src)) {
    const target = path.join(dst, path.relative(src, file));
    if (fs.existsSync(target)) continue;
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.copyFileSync(file, target);
    copied++;
  }
  return copied;
}

function syncStaticAssets({ cacheDir, buildStaticDir, now = Date.now(), maxAgeDays = MAX_AGE_DAYS }) {
  const volStatic = path.join(cacheDir, "static");
  fs.mkdirSync(volStatic, { recursive: true });
  // ORDNING: arkivera → rensa → återställ. Rensningen måste gå FÖRE återställningen,
  // annars ligger den uråldriga filen redan i bygget när "finns i bygget?" ställs.
  const archived = copyNew(buildStaticDir, volStatic);
  let pruned = 0;
  const maxAgeMs = maxAgeDays * 24 * 3600 * 1000;
  for (const file of walk(volStatic)) {
    if (fs.existsSync(path.join(buildStaticDir, path.relative(volStatic, file)))) continue;
    let st;
    try {
      st = fs.statSync(file);
    } catch {
      continue;
    }
    if (now - st.mtimeMs > maxAgeMs) {
      try {
        fs.unlinkSync(file);
        pruned++;
      } catch {
        /* ignorera */
      }
    }
  }
  const restored = copyNew(volStatic, buildStaticDir);
  return { restored, archived, pruned };
}

module.exports = { syncStaticAssets, MAX_AGE_DAYS };
