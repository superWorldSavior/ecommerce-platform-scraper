/**
 * OCR quality checks for Traditional Chinese (zh-Hant).
 *
 * OCR engines confuse some traditional characters with a simplified homograph
 * or a neighboring variant. On a product label the confusion usually lands on
 * an ingredient name — so on exactly the information you were trying to
 * extract, and without denting the engine's confidence: the shape it
 * recognized is a valid character, just not the right one.
 *
 * These checks **flag**, they do not correct. Rewriting the transcription
 * would destroy the source evidence, which is the only thing a later audit can
 * rest on. The caller decides what to do with the warning — send the page back
 * for review, mark it incomplete, or try another engine.
 *
 * ```ts
 * const provider = createAppleVisionOcrProvider({
 *   qualityChecks: [traditionalChineseOcrQualityCheck],
 * });
 * ```
 */

import type { OcrQualityCheck } from "../../kernel/ocr/provider.ts";

/**
 * Confusions observed in production, expected form → misread forms.
 *
 * Deliberately conservative: every entry comes from a case seen on a real
 * label. A speculative pattern would generate noise on pages that are fine,
 * and a warning people learn to ignore is worth nothing.
 */
export const TRADITIONAL_CHINESE_OCR_CONFUSIONS: ReadonlyArray<{
  readonly expected: string;
  readonly misread: readonly string[];
}> = [
  { expected: "黃耆", misread: ["黄者", "黃蓍"] },
];

/**
 * Flags known traditional character confusions.
 *
 * The warnings it returns have the form `suspect_<expected>_as_<misread>`,
 * stable and parsable — a consumer can aggregate them by confusion type to see
 * which character is the troublesome one on its own corpus.
 */
export const traditionalChineseOcrQualityCheck: OcrQualityCheck = {
  name: "zh-TW/traditional-chinese-confusions",

  run(lines: readonly string[]): string[] {
    const text = lines.join("\n");

    return TRADITIONAL_CHINESE_OCR_CONFUSIONS.flatMap((confusion) =>
      confusion.misread
        .filter((misread) => text.includes(misread))
        .map((misread) => `suspect_${confusion.expected}_as_${misread}`)
    );
  },
};
