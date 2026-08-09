/**
 * Läs och JSON-parsa en request-body med ett HÅRT storlekstak.
 *
 * `req.json()` buffrar HELA kroppen innan någon vakt hinner köra — routernas
 * schema- och storleksvakter körde alltså efter att en godtyckligt stor body
 * redan allokerats i minnet (och minne är ~92 % av Railway-notan). Taket här
 * verkställs medan strömmen läses: deklarerad Content-Length prövas först, och
 * en klient som ljuger (chunked eller fel längd) stoppas ändå vid första byte
 * över taket, innan resten av strömmen buffras.
 */
import { ServiceError } from "@/lib/errors";

export async function readJsonCapped(req: Request, maxBytes: number): Promise<unknown> {
  const declared = Number(req.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > maxBytes) {
    throw tooLarge(maxBytes);
  }
  if (!req.body) {
    throw new ServiceError(400, "Tom förfrågan.");
  }

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > maxBytes) {
      await reader.cancel().catch(() => {});
      throw tooLarge(maxBytes);
    }
    chunks.push(value);
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ServiceError(400, "Ogiltig JSON.");
  }
}

function tooLarge(maxBytes: number): ServiceError {
  const mb = Math.round(maxBytes / (1024 * 1024));
  return new ServiceError(413, `Förfrågan är för stor (max ${mb} MB).`);
}
