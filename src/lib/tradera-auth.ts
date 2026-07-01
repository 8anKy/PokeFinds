/**
 * Tradera kontokoppling — "token login"-flödet (Option 2, Traderas rekommenderade):
 * användaren loggar in på Tradera, Tradera skickar tillbaka userId, och vi hämtar
 * själva token server-till-server via FetchToken (token syns aldrig i URL:en).
 * https://api.tradera.com/documentation/authorization
 */
const APP_ID = process.env.TRADERA_APP_ID ?? "";
const APP_KEY = process.env.TRADERA_APP_KEY ?? "";
const PUBLIC_KEY = process.env.TRADERA_PUBLIC_KEY ?? "";

export function buildTraderaLoginUrl(skey: string): string {
  // ruparams: Tradera ekar tillbaka detta okodat på Accept URL:en. Vi använder det
  // för att få tillbaka skey utan att lita på en cookie som ska överleva hela
  // foilio.se → tradera.com → foilio.se-omvägen (WKWebView tappar Set-Cookie på
  // redirect-svar i native-appen — det var buggen).
  const params = new URLSearchParams({
    appId: APP_ID,
    pkey: PUBLIC_KEY,
    skey,
    ruparams: `skey=${skey}`,
  });
  return `https://api.tradera.com/token-login?${params.toString()}`;
}

function tagText(xml: string, name: string): string | undefined {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([^<]*)</${name}>`));
  return m ? m[1].trim() : undefined;
}

export interface TraderaToken {
  token: string;
  expiresAt: Date;
}

/** Byter en Tradera-userId + skey mot en AuthToken via PublicService.FetchToken. */
export async function fetchTraderaToken(
  traderaUserId: string,
  skey: string
): Promise<TraderaToken> {
  const params = new URLSearchParams({
    appId: APP_ID,
    appKey: APP_KEY,
    userId: traderaUserId,
    secretKey: skey,
  });
  const res = await fetch(
    `https://api.tradera.com/v3/PublicService.asmx/FetchToken?${params.toString()}`
  );
  const xml = await res.text();
  const token = tagText(xml, "AuthToken");
  const expiresAtText = tagText(xml, "HardExpirationTime");
  if (!res.ok || !token || !expiresAtText) {
    throw new Error(`Tradera FetchToken misslyckades: ${xml.slice(0, 300)}`);
  }
  return { token, expiresAt: new Date(expiresAtText) };
}
