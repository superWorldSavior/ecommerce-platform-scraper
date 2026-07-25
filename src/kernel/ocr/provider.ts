/**
 * The OCR contract: turn an image of a product page into usable text.
 *
 * The kernel knows **no** OCR engine in particular. It defines the interface,
 * the result types and the scoring helpers; each engine lives in its own module
 * and reports whether it is available on the current host.
 *
 * That is deliberate: a capable OCR engine is often tied to an operating system
 * or to a native binary. Making any one of them *the* OCR path would leave the
 * package unusable everywhere else.
 *
 * ```ts
 * const provider = createAppleVisionOcrProvider();
 * if (await provider.available()) {
 *   const result = await provider.transcribe(input);
 * }
 * ```
 */

import type { OcrLayoutDocument } from "./layout.ts";

/**
 * Why a transcription produced nothing usable.
 *
 *  - `UNSUPPORTED_PLATFORM` — the engine does not run on this host.
 *  - `PROVIDER_UNAVAILABLE` — engine missing, not compiled, or misinstalled.
 *  - `EMPTY_IMAGE` — empty input.
 *  - `PROVIDER_RUN_FAILED` — the engine failed while running.
 *  - `INVALID_PROVIDER_OUTPUT` — unreadable output.
 *  - `PROVIDER_ERROR` — the engine answered with an explicit error.
 *  - `NO_TEXT` — the engine succeeded but found no text at all.
 */
export type OcrFallbackReason =
  | "UNSUPPORTED_PLATFORM"
  | "PROVIDER_UNAVAILABLE"
  | "EMPTY_IMAGE"
  | "PROVIDER_RUN_FAILED"
  | "INVALID_PROVIDER_OUTPUT"
  | "PROVIDER_ERROR"
  | "NO_TEXT";

export type OcrImageMimeType = "image/png" | "image/jpeg" | "image/webp";

export type OcrConfidence = "HIGH" | "MEDIUM" | "LOW";

export interface OcrInput {
  /** Source the image comes from, for traceability. */
  sourceName: string;
  /** URL of the image, for traceability. */
  sourceUrl: string;
  /** Product name, when known. Purely contextual. */
  productName?: string;
  /** Base64-encoded image, **without** the `data:` prefix. */
  imageBase64: string;
  imageMimeType: OcrImageMimeType;
}

export interface OcrLine {
  text: string;
  confidence: number;
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  } | null;
}

export interface OcrDiagnostics {
  /** Name of the engine that produced the result. */
  provider: string;
  lineCount: number;
  avgConfidence: number | null;
  warnings: string[];
}

export interface OcrResult {
  rawMarkdown: string;
  ocrLayout: OcrLayoutDocument | null;
  confidence: OcrConfidence;
  notes: string | null;
  fallbackReason: OcrFallbackReason | null;
  diagnostics: OcrDiagnostics;
}

/**
 * A quality check applied to the transcribed lines.
 *
 * Its job is to spot an engine's systematic confusions on a given script — two
 * visually close glyphs that it swaps. Such checks are **specific to a language
 * or a script**, so the caller supplies them: see `locales/` for the ones
 * shipped with the package.
 *
 * A check returns warning labels, never a correction: rewriting the text would
 * destroy the source evidence.
 */
export interface OcrQualityCheck {
  readonly name: string;
  run(lines: readonly string[]): string[];
}

/** An OCR engine. `available()` must be safe to call on any host. */
export interface OcrProvider {
  readonly name: string;
  available(): boolean | Promise<boolean>;
  transcribe(input: OcrInput): Promise<OcrResult>;
}

/** Cutoffs mapping an average confidence to the three qualitative levels. */
export interface OcrConfidenceThresholds {
  readonly high: number;
  readonly medium: number;
}

/**
 * Default thresholds, calibrated on photographed product labels — dense text,
 * uneven contrast. A corpus of scanned documents could take stricter values.
 */
export const DEFAULT_OCR_CONFIDENCE_THRESHOLDS = {
  high: 0.82,
  medium: 0.55,
} as const satisfies OcrConfidenceThresholds;

/** Joins the non-empty lines, one per line, in the order received. */
export function renderOcrLinesToMarkdown(lines: readonly OcrLine[]): string {
  return lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join("\n");
}

/** Average confidence, rounded to 3 decimals. `null` when no lines. */
export function averageConfidence(lines: readonly OcrLine[]): number | null {
  if (lines.length === 0) return null;
  const total = lines.reduce((sum, line) => sum + line.confidence, 0);
  return Number((total / lines.length).toFixed(3));
}

export function confidenceFromAverage(
  avgConfidence: number | null,
  thresholds: OcrConfidenceThresholds = DEFAULT_OCR_CONFIDENCE_THRESHOLDS,
): OcrConfidence {
  if (avgConfidence === null) return "LOW";
  if (avgConfidence >= thresholds.high) return "HIGH";
  if (avgConfidence >= thresholds.medium) return "MEDIUM";
  return "LOW";
}

/** Runs every check and aggregates their warnings. */
export function runOcrQualityChecks(
  lines: readonly string[],
  checks: readonly OcrQualityCheck[],
): string[] {
  return checks.flatMap((check) => check.run(lines));
}

/** Typed empty result, for every failure path. */
export function emptyOcrResult(
  provider: string,
  fallbackReason: OcrFallbackReason,
  warnings: readonly string[] = [],
): OcrResult {
  return {
    rawMarkdown: "",
    ocrLayout: null,
    confidence: "LOW",
    notes: warnings.length === 0 ? null : warnings.join("; "),
    fallbackReason,
    diagnostics: {
      provider,
      lineCount: 0,
      avgConfidence: null,
      warnings: [...warnings],
    },
  };
}
