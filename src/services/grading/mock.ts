/**
 * Deterministisk mock-gradering för utveckling och tester. Producerar stabila
 * delpoäng utifrån bilddatans längd så att samma indata alltid ger samma
 * resultat (inga nätverksanrop, ingen API-nyckel).
 */
import type { GradeResult, GradingAdapter, GradingContext } from "./types";

export class MockGradingAdapter implements GradingAdapter {
  name = "mock";

  async grade(
    frontDataUrl: string,
    backDataUrl: string,
    _context?: GradingContext
  ): Promise<GradeResult> {
    const seed = (frontDataUrl.length + backDataUrl.length * 7) % 100;
    const base = 6 + (seed % 4); // 6–9
    const clamp = (n: number) => Math.min(10, Math.max(1, n));
    const v = (offset: number) => clamp(base + (((seed + offset) % 3) - 1));

    const subScores = {
      centering: v(1),
      corners: v(2),
      edges: v(3),
      surface: v(4),
    };
    const overall =
      Math.round(
        ((subScores.centering +
          subScores.corners +
          subScores.edges +
          subScores.surface) /
          4) *
          2
      ) / 2;

    return {
      overall,
      subScores,
      confidence: 0.5,
      rationale:
        "Demoläge: simulerad gradering. Koppla in en riktig vision-modell " +
        "(GRADING_PROVIDER=claude) för en faktisk bedömning.",
      modelUsed: "mock",
    };
  }
}
