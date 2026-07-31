/**
 * KALIBRERING: hur lika är referensavtrycken för ÄKTA samma-konst-omtryck
 * jämfört med namnsyskon med OLIKA konst? Sätter tröskeln SAME_ART_MIN för
 * omtryckssyskon-tie-breaken på mätning, inte på känsla. Läser bara.
 */
import { PrismaClient } from "@prisma/client";
import {
  BLEND_COLOR,
  BLEND_DCT,
  BLEND_GRAD,
  FINGERPRINT_BYTES,
  STRUCT_BYTES,
  STRUCT_DCT_DIMS,
} from "../src/lib/art-fingerprint";

const prisma = new PrismaClient();

function cosPart(a: Buffer, b: Buffer, from: number, to: number): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = from; i < to; i++) {
    const x = (a[i] << 24) >> 24;
    const y = (b[i] << 24) >> 24;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  return denom > 0 ? dot / denom : 0;
}

async function pairSim(idA: string, idB: string): Promise<number | null> {
  const rows = await prisma.card.findMany({
    where: { id: { in: [idA, idB] } },
    select: { id: true, artFingerprint: true, structFingerprint: true },
  });
  const a = rows.find((r) => r.id === idA);
  const b = rows.find((r) => r.id === idB);
  if (!a?.artFingerprint || !b?.artFingerprint) return null;
  if (a.artFingerprint.length !== FINGERPRINT_BYTES || b.artFingerprint.length !== FINGERPRINT_BYTES)
    return null;
  let s = BLEND_COLOR * cosPart(a.artFingerprint, b.artFingerprint, 0, FINGERPRINT_BYTES);
  if (
    a.structFingerprint?.length === STRUCT_BYTES &&
    b.structFingerprint?.length === STRUCT_BYTES
  ) {
    s += BLEND_DCT * cosPart(a.structFingerprint, b.structFingerprint, 0, STRUCT_DCT_DIMS);
    s += BLEND_GRAD * cosPart(a.structFingerprint, b.structFingerprint, STRUCT_DCT_DIMS, STRUCT_BYTES);
  }
  return s;
}

async function labelled(name: string, number: string, setContains: string): Promise<string | null> {
  const c = await prisma.card.findFirst({
    where: {
      name: { equals: name, mode: "insensitive" },
      number,
      set: { name: { contains: setContains, mode: "insensitive" } },
    },
    select: { id: true },
  });
  return c?.id ?? null;
}

async function main() {
  // De verkliga missarna (samma konst) + kontroller (samma namn, OLIKA konst).
  const cases: Array<[string, [string, string, string], [string, string, string]]> = [
    ["Raboot SC27 ↔ AH37 (SAMMA konst)", ["Raboot", "27", "Stellar"], ["Raboot", "37", "Ascended"]],
    ["Scorbunny SC26 ↔ AH36 (SAMMA konst)", ["Scorbunny", "26", "Stellar"], ["Scorbunny", "36", "Ascended"]],
    ["Regirock ex DR101 ↔ AH107 (SAMMA konst)", ["Regirock ex", "101", "Destined"], ["Regirock ex", "107", "Ascended"]],
    ["Gyarados Deoxys8 ↔ 151-044 (OLIKA konst)", ["Gyarados", "8", "Deoxys"], ["Gyarados", "44", "151"]],
    ["Charizard Base4 ↔ TG03 (OLIKA konst)", ["Charizard", "4", "Base"], ["Charizard", "TG03", "Lost Origin"]],
    ["Electrike Deoxys60 ↔ Eelektrik AH60 (OLIKA kort)", ["Electrike", "60", "Deoxys"], ["Eelektrik", "60", "Ascended"]],
    ["Eelektrik AH60 ↔ Lost Origin 60 (omtryck?)", ["Eelektrik", "60", "Ascended"], ["Eelektrik", "60", "Lost Origin"]],
  ];
  for (const [label, [na, xa, sa], [nb, xb, sb]] of cases) {
    const a = await labelled(na, xa, sa);
    const b = await labelled(nb, xb, sb);
    if (!a || !b) {
      console.log(`${label}: kort saknas (${a ? "" : `${na} ${xa}`}${b ? "" : ` ${nb} ${xb}`})`);
      continue;
    }
    const s = await pairSim(a, b);
    console.log(`${label}: ${s === null ? "avtryck saknas" : s.toFixed(3)}`);
  }
}

main().finally(() => prisma.$disconnect());
