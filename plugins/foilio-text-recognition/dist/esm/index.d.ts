export interface RecognizeOptions {
  /** JPEG/PNG som base64 UTAN data-URL-prefix. */
  base64: string;
  /** Valfria BCP-47-koder ("en-US", "ja-JP"); okända filtreras bort på enheten. */
  languages?: string[];
}

export interface RecognizeResult {
  /** Alla rader sammanfogade med "\n", i läsordning. */
  text: string;
  lines: string[];
}

export interface FoilioTextRecognitionPlugin {
  /** Endast iOS (Apple Vision). Android: @capacitor-mlkit/text-recognition. Webb: UNIMPLEMENTED. */
  recognize(options: RecognizeOptions): Promise<RecognizeResult>;
}

export declare const FoilioTextRecognition: FoilioTextRecognitionPlugin;
