/**
 * NYHETSINKORGENS LAGER — `drafts.json` och ägarens uppladdade omslag, på samma
 * volymkatalog som flödet (`feedDir()`). Aldrig en databastabell: inkorgen öppnas
 * bara av admin, men den fylls av ett jobb tre gånger om dygnet, och ett jobb som
 * väcker Neon köper 300 s per gång (CLAUDE.md, kostnadsdoktrinen).
 *
 * ⛔ SERVER ONLY (`fs`). ⛔ Skrivningarna är atomära (temp + rename) som flödets.
 *
 * OMSLAGEN: ägaren kan ladda upp en egen bild till ett utkast. Den läggs som fil i
 * `covers/` och serveras av `/api/feed-cover/<namn>` med lång cache. ⛔ Inte
 * Railway-bucketen: dess läs-URL:er är signerade och dör efter 7 dygn, medan en
 * nyhet ligger kvar i flödet i veckor. En fil på volymen har ingen klocka.
 */
import { promises as fs } from "fs";
import path from "path";
import { EMPTY_INBOX, inboxDocumentSchema, type InboxDocument } from "@/lib/feed-inbox";
import { feedDir } from "@/lib/feed-store";

function inboxPath(): string {
  return path.join(feedDir(), "drafts.json");
}

function coversDir(): string {
  return path.join(feedDir(), "covers");
}

export async function readInbox(): Promise<InboxDocument> {
  try {
    const raw = await fs.readFile(inboxPath(), "utf8");
    const parsed = inboxDocumentSchema.safeParse(JSON.parse(raw));
    if (!parsed.success) {
      console.error("[feed-inbox] drafts.json är ogiltig — visar tom inkorg:", parsed.error.issues.slice(0, 3));
      return EMPTY_INBOX;
    }
    return parsed.data;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") console.error("[feed-inbox] kunde inte läsa inkorgen:", error);
    return EMPTY_INBOX;
  }
}

export async function writeInbox(doc: InboxDocument): Promise<void> {
  const dir = feedDir();
  await fs.mkdir(dir, { recursive: true });
  const file = inboxPath();
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(doc), "utf8");
  await fs.rename(tmp, file);
}

/** Läs–ändra–skriv i ett svep. Adminrutterna anropas en åt gången; ingen låsning behövs. */
export async function updateInbox(fn: (doc: InboxDocument) => InboxDocument | Promise<InboxDocument>): Promise<InboxDocument> {
  const next = await fn(await readInbox());
  await writeInbox(next);
  return next;
}

/** Filnamn: `<utkast-id>-<slump>.<ext>`. Slumpen gör att en ny uppladdning inte fastnar i webbläsarens cache. */
export const COVER_NAME_RE = /^[a-z0-9]{1,32}-[a-f0-9]{8}\.(jpg|png|webp)$/;

export function coverExtension(contentType: string): "jpg" | "png" | "webp" | null {
  if (contentType === "image/jpeg") return "jpg";
  if (contentType === "image/png") return "png";
  if (contentType === "image/webp") return "webp";
  return null;
}

export function coverContentType(name: string): string {
  if (name.endsWith(".png")) return "image/png";
  if (name.endsWith(".webp")) return "image/webp";
  return "image/jpeg";
}

export async function writeCover(name: string, bytes: Uint8Array): Promise<void> {
  if (!COVER_NAME_RE.test(name)) throw new Error("ogiltigt omslagsnamn");
  const dir = coversDir();
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, name);
  const tmp = `${file}.${process.pid}.tmp`;
  await fs.writeFile(tmp, bytes);
  await fs.rename(tmp, file);
}

/** `null` = finns inte. Namnet vaktas av regexen så vägen aldrig kan lämna katalogen. */
export async function readCover(name: string): Promise<Buffer | null> {
  if (!COVER_NAME_RE.test(name)) return null;
  try {
    return await fs.readFile(path.join(coversDir(), name));
  } catch (error) {
    if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") console.error("[feed-inbox] kunde inte läsa omslag:", error);
    return null;
  }
}

/** Den publika vägen ett omslag serveras på. */
export function coverUrl(name: string): string {
  return `/api/feed-cover/${name}`;
}
