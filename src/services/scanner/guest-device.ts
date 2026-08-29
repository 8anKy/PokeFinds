import { prisma } from "@/lib/db";
import { rateLimit } from "@/lib/rate-limit";
import { ServiceError } from "@/lib/errors";
import {
  deviceMonthScans,
  guestQuotaOf,
  monthKeyOf,
  type GuestQuota,
} from "@/lib/guest-device";

/**
 * DB-sidan av gästskanningen. Se src/lib/guest-device.ts för modellen.
 *
 * KOSTNAD: en rad per enhet, ett uppslag på primärnyckel per skanning — i en
 * väg som redan gör DB-arbete (kvot + vision). Ingen ny väckning.
 */

/** Enhetens rad, eller null. Rör ingenting. */
export async function findDevice(deviceId: string) {
  return prisma.guestDevice.findUnique({
    where: { id: deviceId },
    select: { id: true, guestScans: true, monthKey: true, monthScans: true, userId: true },
  });
}

/**
 * Skapa raden om den saknas. ⛔ IP-bromsad: ett påhittat id är en ny rad med 10
 * gratis skanningar, så en klient som byter id varje gång ska slå i taket
 * snabbt — 20 nya enheter per IP och dygn räcker gott för riktiga telefoner
 * (en per person) och gör spam-vägen dyrare än ett slängkonto.
 */
export async function ensureDevice(deviceId: string, ip: string) {
  const existing = await findDevice(deviceId);
  if (existing) return existing;
  const { ok } = await rateLimit(`guest-device-new:${ip}`, 20, 24 * 60 * 60 * 1000);
  if (!ok) throw new ServiceError(429, "För många nya enheter från den här adressen.");
  return prisma.guestDevice.create({
    data: { id: deviceId },
    select: { id: true, guestScans: true, monthKey: true, monthScans: true, userId: true },
  });
}

export async function getGuestQuota(deviceId: string, ip: string): Promise<GuestQuota> {
  const row = await ensureDevice(deviceId, ip);
  return guestQuotaOf(row.guestScans);
}

/** Enhetens skanningar innevarande månad (0 om raden saknas eller är gammal). */
export async function getDeviceMonthScans(deviceId: string, now = new Date()): Promise<number> {
  return deviceMonthScans(await findDevice(deviceId), now);
}

/**
 * Bokför en TRÄFF på enheten. `userId` = inloggad skanning (räknas bara mot
 * månaden och länkar enheten till kontot); null = gäst (räknas dessutom mot
 * livstidstaket). Missar bokförs inte — kvoten räknar identifierade kort,
 * precis som kontokvoten (se getScannerQuota).
 */
export async function recordDeviceScan(
  deviceId: string,
  userId: string | null,
  now = new Date()
): Promise<void> {
  const row = await findDevice(deviceId);
  if (!row) return; // ensureDevice körs före kvotkollen — här ska raden finnas
  const key = monthKeyOf(now);
  const sameMonth = row.monthKey === key;
  await prisma.guestDevice.update({
    where: { id: deviceId },
    data: {
      monthKey: key,
      monthScans: sameMonth ? { increment: 1 } : 1,
      ...(userId ? { userId } : { guestScans: { increment: 1 } }),
      lastSeenAt: now,
    },
  });
}

/** Länka enheten till kontot utan att räkna något (t.ex. kvotläsning inloggad). */
export async function linkDeviceToUser(deviceId: string, userId: string, ip: string) {
  const row = await ensureDevice(deviceId, ip);
  if (row.userId === userId) return;
  await prisma.guestDevice.update({ where: { id: deviceId }, data: { userId } });
}
