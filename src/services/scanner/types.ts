/**
 * Typer för kortskannern. Skannern är adapterbaserad: vilken OCR-/vision-
 * leverantör som helst kan kopplas in genom att implementera `OcrAdapter`
 * och registreras i `getOcrAdapter()` (se src/services/scanner/index.ts
 * samt docs/SCANNER.md).
 */

/** Resultat från en OCR-/vision-analys av en kortbild. */
export interface OcrResult {
  /** Rå text som extraherats ur bilden. */
  rawText: string;
  /** Bästa gissning på kortets namn, om någon. */
  guessedName?: string;
  /** Bästa gissning på setnummer (t.ex. "25/102"), om något. */
  guessedNumber?: string;
  /** Leverantörens konfidens 0..1. */
  confidence: number;
}

/** Adapter mot en OCR-/vision-leverantör. */
export interface OcrAdapter {
  /** Leverantörens namn, t.ex. "mock", "google-vision". */
  name: string;
  /** Extraherar kortinformation ur en bild (data-URL, base64). */
  extractCardInfo(imageDataUrl: string): Promise<OcrResult>;
}

/** En matchningskandidat som returneras till klienten. */
export interface ScanCandidate {
  cardId: string;
  name: string;
  setName: string;
  number: string;
  rarity: string;
  imageUrl: string | null;
  /** Produktens slug för djuplänk till produktsidan, om kortet har en produkt. */
  slug: string | null;
  /** Matchningspoäng 0..1. */
  score: number;
  /** Aktuellt marknadsvärde i öre (Cardmarket-trend via kortets produkt), om känt. */
  estimatedValue: number | null;
}
