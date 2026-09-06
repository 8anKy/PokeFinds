/**
 * Objektlagring för användarbilder (forumtrådar) — Railway Bucket (S3-kompatibel,
 * privat). Kostnad: $0,015/GB-månad, egress och API-anrop gratis (Railways docs
 * 2026-09-03). Tusen telefonfoton nedskalade till ~300 kB ≈ 0,3 GB ≈ ett halvt
 * öre i månaden.
 *
 * ⛔ BUCKETEN ÄR PRIVAT — Railway stöder inga publika buckets. Bilder visas
 * därför via SIGNERADE läs-URL:er (`imageUrl()`), giltiga 7 dygn (S3-taket).
 * Signeringen är ren kryptografi i processen (ingen nätverksrundtur), så den
 * kostar inget och behöver ingen cache. En ISR-sida (1 h) bär alltså alltid en
 * URL som är giltig långt efter att sidan renderats om.
 *
 * UPPLADDNING GÅR VIA VÅR API-RUTT (`/api/community/upload`), inte via
 * presignerad PUT från webbläsaren: CORS-konfiguration står inte bland
 * bucketens stödda funktioner, och en direkt PUT från WebView:en hade fallit
 * tyst. Klienten skalar ner till ≤1600 px + JPEG innan uppladdning (EXIF med
 * GPS-position försvinner på köpet) — se components/community/image-picker.tsx.
 *
 * Aktiveras av env (se docs/DEPLOYMENT.md): `S3_BUCKET`, `S3_ENDPOINT`,
 * `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`, `S3_REGION` (Railways preset-namn
 * `BUCKET`/`ENDPOINT`/`ACCESS_KEY_ID`/`SECRET_ACCESS_KEY`/`REGION` läses också).
 * Saknas de svarar `storageEnabled()` falskt och bilduppladdning döljs i UI:t —
 * forumet fungerar utan bilder, det är inte ett fel.
 */
import { createHash, randomUUID } from "node:crypto";

export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // efter klientens nedskalning ~300 kB
/** Miniatyren är ~10 kB — taket är bara en vakt mot en klient som skickar fel fil. */
export const MAX_THUMB_BYTES = 256 * 1024;
export const THUMB_MAX_EDGE = 320;
export const MAX_IMAGES_PER_POST = 6;
export const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
/** S3 tillåter max 7 dygn för presignerade URL:er. */
export const READ_URL_TTL_SECONDS = 7 * 24 * 60 * 60;

interface StorageConfig {
  bucket: string;
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
}

function env(...names: string[]): string {
  for (const n of names) {
    const v = process.env[n]?.trim();
    if (v) return v;
  }
  return "";
}

export function storageConfig(): StorageConfig | null {
  const bucket = env("S3_BUCKET", "BUCKET");
  const endpoint = env("S3_ENDPOINT", "ENDPOINT");
  const accessKeyId = env("S3_ACCESS_KEY_ID", "ACCESS_KEY_ID", "AWS_ACCESS_KEY_ID");
  const secretAccessKey = env("S3_SECRET_ACCESS_KEY", "SECRET_ACCESS_KEY", "AWS_SECRET_ACCESS_KEY");
  const region = env("S3_REGION", "REGION", "AWS_REGION") || "auto";
  if (!bucket || !endpoint || !accessKeyId || !secretAccessKey) return null;
  return { bucket, endpoint, accessKeyId, secretAccessKey, region };
}

export function storageEnabled(): boolean {
  return storageConfig() !== null;
}

/** Filändelse ur MIME-typ. Bara de tre vi tar emot. */
export function extensionFor(contentType: string): string | null {
  switch (contentType) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      return null;
  }
}

/**
 * Objektnyckel: `forum/<användar-id>/<slump>.<ext>`. Användar-id:t i vägen gör
 * att GDPR-radering kan lista och ta bort allt en person laddat upp med ett
 * prefix-anrop, utan att gå via databasen.
 */
export function buildImageKey(userId: string, contentType: string): string | null {
  const ext = extensionFor(contentType);
  if (!ext) return null;
  const safeUser = userId.replace(/[^A-Za-z0-9_-]/g, "");
  if (!safeUser) return null;
  return `forum/${safeUser}/${randomUUID()}.${ext}`;
}

export function isForumImageKey(key: string): boolean {
  return /^forum\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}\.(jpg|png|webp)$/.test(key);
}

/**
 * Miniatyrens nyckel HÄRLEDS ur originalets (`…uuid.jpg` → `…uuid_t.jpg`) så
 * att servern kan verifiera den i stället för att lita på klienten: en klient
 * som hittar på en nyckel kan annars peka en tråds miniatyr på någon annans
 * bild. Att den ändå LAGRAS i `PostImage.thumbKey` är för att null ska betyda
 * "ingen miniatyr finns" — gamla bilder ska falla tillbaka på originalet, inte
 * gå på en 404.
 */
export function buildThumbKey(key: string): string | null {
  if (!isForumImageKey(key)) return null;
  return key.replace(/\.(jpg|png|webp)$/, "_t.$1");
}

export function isForumThumbKey(key: string): boolean {
  return /^forum\/[A-Za-z0-9_-]+\/[0-9a-f-]{36}_t\.(jpg|png|webp)$/.test(key);
}

/** Enkel magic-byte-koll så en omdöpt fil inte går igenom på MIME-typen ensam. */
export function sniffImageType(bytes: Uint8Array): string | null {
  if (bytes.length < 12) return null;
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a
  )
    return "image/png";
  if (
    bytes[0] === 0x52 && // R
    bytes[1] === 0x49 && // I
    bytes[2] === 0x46 && // F
    bytes[3] === 0x46 && // F
    bytes[8] === 0x57 && // W
    bytes[9] === 0x45 && // E
    bytes[10] === 0x42 && // B
    bytes[11] === 0x50 // P
  )
    return "image/webp";
  return null;
}

// ---------- S3-klient (lazy — SDK:n dras bara in där den används) ----------

type S3Module = typeof import("@aws-sdk/client-s3");
type PresignModule = typeof import("@aws-sdk/s3-request-presigner");

let s3Mod: S3Module | null = null;
let presignMod: PresignModule | null = null;
let client: InstanceType<S3Module["S3Client"]> | null = null;
let clientKey = "";

async function getClient(cfg: StorageConfig) {
  s3Mod ??= await import("@aws-sdk/client-s3");
  const key = `${cfg.endpoint}|${cfg.bucket}|${cfg.accessKeyId}`;
  if (!client || clientKey !== key) {
    client = new s3Mod.S3Client({
      endpoint: cfg.endpoint,
      region: cfg.region,
      credentials: { accessKeyId: cfg.accessKeyId, secretAccessKey: cfg.secretAccessKey },
      // Railways nyare buckets kör virtual-hosted-URL:er (bucket som subdomän);
      // äldre kräver path-style. `S3_FORCE_PATH_STYLE=1` växlar utan kodändring.
      forcePathStyle: (process.env.S3_FORCE_PATH_STYLE ?? "") === "1",
    });
    clientKey = key;
  }
  return { client, s3: s3Mod };
}

export async function putImage(key: string, body: Uint8Array, contentType: string): Promise<void> {
  const cfg = storageConfig();
  if (!cfg) throw new Error("Objektlagring är inte konfigurerad.");
  const { client, s3 } = await getClient(cfg);
  await client.send(
    new s3.PutObjectCommand({
      Bucket: cfg.bucket,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: "public, max-age=31536000, immutable",
    })
  );
}

export async function deleteImage(key: string): Promise<void> {
  const cfg = storageConfig();
  if (!cfg) return;
  const { client, s3 } = await getClient(cfg);
  await client.send(new s3.DeleteObjectCommand({ Bucket: cfg.bucket, Key: key }));
}

/** Radera allt en användare laddat upp (GDPR-radering). Best effort, loggar aldrig nycklar. */
export async function deleteUserImages(userId: string): Promise<number> {
  const cfg = storageConfig();
  if (!cfg) return 0;
  const { client, s3 } = await getClient(cfg);
  const prefix = `forum/${userId.replace(/[^A-Za-z0-9_-]/g, "")}/`;
  let removed = 0;
  let token: string | undefined;
  do {
    const page = await client.send(
      new s3.ListObjectsV2Command({ Bucket: cfg.bucket, Prefix: prefix, ContinuationToken: token })
    );
    const keys = (page.Contents ?? []).map((o) => o.Key).filter((k): k is string => !!k);
    if (keys.length > 0) {
      await client.send(
        new s3.DeleteObjectsCommand({
          Bucket: cfg.bucket,
          Delete: { Objects: keys.map((Key) => ({ Key })), Quiet: true },
        })
      );
      removed += keys.length;
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return removed;
}

/**
 * Signerad läs-URL. Deterministisk per (nyckel, DYGN): signeringstiden avrundas
 * nedåt till hel UTC-dag så samma bild ger SAMMA URL hela dygnet — webbläsarens
 * bildcache träffar i stället för att hämta om. ⛔ Var en TIMME till 2026-09-07,
 * vilket gjorde varje bild till en ny URL varje timme och därmed en ny
 * nedladdning; med 7 dygns giltighet är dygnsvis fortfarande minst 6 dygn kvar
 * när URL:en skapas sent på dygnet, och våra ISR-sidor är som mest 5 min gamla.
 */
export async function imageUrl(key: string): Promise<string | null> {
  const cfg = storageConfig();
  if (!cfg || (!isForumImageKey(key) && !isForumThumbKey(key))) return null;
  const { client, s3 } = await getClient(cfg);
  presignMod ??= await import("@aws-sdk/s3-request-presigner");
  const dayBucket = new Date(Math.floor(Date.now() / 86_400_000) * 86_400_000);
  return presignMod.getSignedUrl(client, new s3.GetObjectCommand({ Bucket: cfg.bucket, Key: key }), {
    expiresIn: READ_URL_TTL_SECONDS,
    signingDate: dayBucket,
  });
}

/** Många nycklar på en gång (trådlistor). Behåller ordningen; okända nycklar blir null. */
export async function imageUrls(keys: string[]): Promise<(string | null)[]> {
  return Promise.all(keys.map((k) => imageUrl(k)));
}

/** ETag-liknande stämpel för cache-nycklar (ingen hemlighet — bara innehållshash). */
export function contentHash(bytes: Uint8Array): string {
  return createHash("sha1").update(bytes).digest("hex").slice(0, 16);
}
