/**
 * Contrat OCR : transcrire une image de page produit en texte exploitable.
 *
 * Le kernel ne connaît **aucun** moteur OCR en particulier. Il définit
 * l'interface, les types de résultat et les helpers de notation ; chaque moteur
 * vit dans son module et se déclare disponible ou non selon l'hôte.
 *
 * C'est délibéré : un moteur OCR performant est souvent lié à un système
 * d'exploitation ou à un binaire natif. Faire de l'un d'eux *le* chemin OCR
 * rendrait le package inutilisable ailleurs.
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
 * Pourquoi une transcription n'a rien produit d'exploitable.
 *
 *  - `UNSUPPORTED_PLATFORM` — le moteur ne tourne pas sur cet hôte.
 *  - `PROVIDER_UNAVAILABLE` — moteur absent, non compilé, ou mal installé.
 *  - `EMPTY_IMAGE` — entrée vide.
 *  - `PROVIDER_RUN_FAILED` — le moteur a échoué à l'exécution.
 *  - `INVALID_PROVIDER_OUTPUT` — sortie illisible.
 *  - `PROVIDER_ERROR` — le moteur a répondu par une erreur explicite.
 *  - `NO_TEXT` — le moteur a réussi mais n'a trouvé aucun texte.
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
  /** Source dont provient l'image, pour la traçabilité. */
  sourceName: string;
  /** URL de l'image, pour la traçabilité. */
  sourceUrl: string;
  /** Nom du produit, si connu. Purement contextuel. */
  productName?: string;
  /** Image encodée base64, **sans** préfixe `data:`. */
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
  /** Nom du moteur ayant produit le résultat. */
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
 * Contrôle de qualité appliqué aux lignes transcrites.
 *
 * Sert à repérer les confusions systématiques d'un moteur sur une écriture
 * donnée — deux glyphes visuellement proches qu'il intervertit. Ces contrôles
 * sont **spécifiques à une langue ou à une écriture**, donc fournis par
 * l'appelant : voir `locales/` pour ceux livrés avec le package.
 *
 * Un contrôle retourne des étiquettes d'avertissement, jamais une correction :
 * réécrire le texte détruirait la preuve source.
 */
export interface OcrQualityCheck {
  readonly name: string;
  run(lines: readonly string[]): string[];
}

/** Moteur OCR. `available()` doit être sûr à appeler sur n'importe quel hôte. */
export interface OcrProvider {
  readonly name: string;
  available(): boolean | Promise<boolean>;
  transcribe(input: OcrInput): Promise<OcrResult>;
}

/** Seuils de passage d'une confiance moyenne aux trois niveaux qualitatifs. */
export interface OcrConfidenceThresholds {
  readonly high: number;
  readonly medium: number;
}

/**
 * Seuils par défaut, calibrés sur des étiquettes produit photographiées —
 * texte dense, contraste inégal. Un corpus de documents scannés supporterait
 * des seuils plus exigeants.
 */
export const DEFAULT_OCR_CONFIDENCE_THRESHOLDS = {
  high: 0.82,
  medium: 0.55,
} as const satisfies OcrConfidenceThresholds;

/** Concatène les lignes non vides, une par ligne, dans l'ordre reçu. */
export function renderOcrLinesToMarkdown(lines: readonly OcrLine[]): string {
  return lines
    .map((line) => line.text.trim())
    .filter(Boolean)
    .join("\n");
}

/** Confiance moyenne, arrondie à trois décimales. `null` si aucune ligne. */
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

/** Applique tous les contrôles et agrège leurs avertissements. */
export function runOcrQualityChecks(
  lines: readonly string[],
  checks: readonly OcrQualityCheck[],
): string[] {
  return checks.flatMap((check) => check.run(lines));
}

/** Résultat vide typé, pour tous les chemins d'échec. */
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
