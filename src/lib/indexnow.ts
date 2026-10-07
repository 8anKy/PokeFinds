/**
 * IndexNow — säger till Bing (och Yandex/Seznam/Naver, som delar protokollet) att en
 * URL är ny eller ändrad, i stället för att vänta på nästa sitemap-läsning.
 *
 * ⛔ VARFÖR (2026-10-07): ChatGPT:s webbsök vilar främst på BINGS index, inte Googles.
 * En sökning på en icke-Google-motor gav NOLL foilio.se-sidor; sajten var aldrig
 * anmäld hos Bing. Bing Webmaster Tools är nu kopplat (ägaren, sitemap inskickad) —
 * det här är den andra halvan: nya sidor når indexet samma natt.
 *
 * ⛔ NYCKELN ÄR PUBLIK MED FLIT. Protokollet bevisar ägarskap genom att nyckeln ligger
 * i en fil på domänen (`public/<nyckel>.txt`); den är ingen hemlighet och hör inte i
 * env. Byts den måste filen bytas i samma commit — vaktat av indexnow.test.ts.
 *
 * ⛔ BARA NYTT/ÄNDRAT. Protokollet är till för förändringar; att skicka hela katalogen
 * varje natt är spam i Bings ögon och kan strypa domänens kvot. Sitemapen täcker resten.
 * ⛔ Ingen DB här: urvalet görs av anroparen (scripts/indexnow-submit.ts).
 */
export const INDEXNOW_KEY = "e6ed656e4a799aebd9ea874aa9a646e1";
export const INDEXNOW_ENDPOINT = "https://api.indexnow.org/indexnow";
/** Protokollets tak per POST. */
export const INDEXNOW_MAX_URLS = 10_000;

export interface IndexNowPayload {
  host: string;
  key: string;
  keyLocation: string;
  urlList: string[];
}

/**
 * Bygger POST-kropparna. Bara URL:er på `baseUrl`s värd tas med (protokollet avvisar
 * hela anropet om en enda URL ligger på en annan värd), dubbletter tas bort.
 */
export function buildIndexNowPayloads(baseUrl: string, urls: string[]): IndexNowPayload[] {
  const base = new URL(baseUrl);
  const unique = Array.from(
    new Set(
      urls.filter((u) => {
        try {
          return new URL(u).host === base.host;
        } catch {
          return false;
        }
      })
    )
  );
  const payloads: IndexNowPayload[] = [];
  for (let i = 0; i < unique.length; i += INDEXNOW_MAX_URLS) {
    payloads.push({
      host: base.host,
      key: INDEXNOW_KEY,
      keyLocation: `${base.origin}/${INDEXNOW_KEY}.txt`,
      urlList: unique.slice(i, i + INDEXNOW_MAX_URLS),
    });
  }
  return payloads;
}

/** Skickar kropparna. 200/202 = mottaget; allt annat returneras som fel, kastas aldrig. */
export async function submitIndexNow(
  payloads: IndexNowPayload[]
): Promise<{ sent: number; errors: string[] }> {
  let sent = 0;
  const errors: string[] = [];
  for (const payload of payloads) {
    try {
      const res = await fetch(INDEXNOW_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 200 || res.status === 202) sent += payload.urlList.length;
      else errors.push(`HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      errors.push(String(e));
    }
  }
  return { sent, errors };
}
