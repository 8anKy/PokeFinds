/**
 * Återställ ett kontos lösenord (mot PROD som standard). Du väljer lösenordet —
 * det skickas via env, lagras aldrig i koden/historiken.
 *
 *   EMAIL=admin@pokefinds.se NEW_PASSWORD='ditt-nya-lösen' npx tsx scripts/reset-password.ts
 *
 * Kör mot lokal DB istället: lägg till  TARGET=local
 */
import * as fs from "fs"; import * as path from "path";
const envPath = path.join(process.cwd(), ".env");
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, "utf-8").split("\n")) {
    const m = line.match(/^\s*([A-Z_][A-Z0-9_]*)\s*=\s*(.+?)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
}
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const EMAIL = process.env.EMAIL;
const NEW_PASSWORD = process.env.NEW_PASSWORD;
if (!EMAIL || !NEW_PASSWORD) throw new Error("Sätt EMAIL och NEW_PASSWORD i env.");
if (NEW_PASSWORD.length < 8) throw new Error("NEW_PASSWORD måste vara minst 8 tecken.");

const url =
  process.env.TARGET === "local" ? process.env.DATABASE_URL : process.env.NEON_DATABASE_URL;
if (!url) throw new Error("Saknar databas-URL (NEON_DATABASE_URL, eller DATABASE_URL för TARGET=local).");

const prisma = new PrismaClient({ datasources: { db: { url } } });

async function main() {
  const db = (await prisma.$queryRawUnsafe<{ d: string }[]>("select current_database() as d"))[0].d;
  const user = await prisma.user.findUnique({ where: { email: EMAIL }, select: { id: true, role: true } });
  if (!user) throw new Error(`Ingen användare med e-post ${EMAIL} i ${db}.`);

  const passwordHash = await bcrypt.hash(NEW_PASSWORD!, 10);
  await prisma.user.update({ where: { email: EMAIL! }, data: { passwordHash } });
  console.log(`✅ Lösenord uppdaterat för ${EMAIL} (roll ${user.role}) i databas "${db}".`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
