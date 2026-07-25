/**
 * Moteur OCR Apple Vision — **macOS uniquement**.
 *
 * Implémente `OcrProvider` en pilotant un petit helper Objective-C
 * (`native/apple-vision-ocr.m`), compilé à la demande via `clang` et mis en
 * cache entre les exécutions. Le helper renvoie les lignes reconnues avec leur
 * confiance et leur boîte englobante normalisée.
 *
 * Pourquoi Apple Vision : sur des étiquettes produit photographiées, il
 * préserve mieux les écritures CJK denses que les moteurs libres testés — en
 * particulier les caractères traditionnels rares. Sur un autre hôte,
 * `available()` renvoie `false` et l'appelant doit basculer sur un autre
 * moteur ; c'est à lui de composer sa chaîne de repli.
 *
 * Prérequis : macOS avec les outils en ligne de commande Xcode (`clang` et les
 * frameworks Foundation / AppKit / Vision).
 */

import { decodeBase64 } from "@std/encoding/base64";
import { fromFileUrl } from "@std/path/from-file-url";
import {
  averageConfidence,
  confidenceFromAverage,
  DEFAULT_OCR_CONFIDENCE_THRESHOLDS,
  emptyOcrResult,
  type OcrConfidenceThresholds,
  type OcrInput,
  type OcrLine,
  type OcrProvider,
  type OcrQualityCheck,
  type OcrResult,
  renderOcrLinesToMarkdown,
  runOcrQualityChecks,
} from "./provider.ts";

export const APPLE_VISION_PROVIDER_NAME = "apple-vision";

/** Version du contrat de sortie du helper, à incrémenter s'il change. */
export const APPLE_VISION_OUTPUT_VERSION = "image-ocr-apple-vision-v1";

interface AppleVisionSuccessPayload {
  ok: true;
  provider: string;
  lines: OcrLine[];
}

interface AppleVisionErrorPayload {
  ok: false;
  error: { code: string; message: string };
}

type AppleVisionPayload = AppleVisionSuccessPayload | AppleVisionErrorPayload;

export interface AppleVisionOcrOptions {
  /**
   * Contrôles qualité appliqués aux lignes transcrites. Voir
   * `locales/` pour les contrôles livrés avec le package.
   */
  readonly qualityChecks?: readonly OcrQualityCheck[];
  readonly thresholds?: OcrConfidenceThresholds;
  /**
   * Emplacement du binaire compilé. Défaut : un chemin temporaire dérivé du nom
   * du moteur. Le surcharger permet de compiler une fois à l'installation
   * plutôt qu'au premier appel.
   */
  readonly binaryPath?: string;
}

const DEFAULT_BINARY_PATH = "/tmp/ecommerce-platform-scraper-apple-vision-ocr";

export function createAppleVisionOcrProvider(
  options: AppleVisionOcrOptions = {},
): OcrProvider {
  const qualityChecks = options.qualityChecks ?? [];
  const thresholds = options.thresholds ?? DEFAULT_OCR_CONFIDENCE_THRESHOLDS;
  const binaryPath = options.binaryPath ?? DEFAULT_BINARY_PATH;

  return {
    name: APPLE_VISION_PROVIDER_NAME,

    available() {
      return Deno.build.os === "darwin";
    },

    async transcribe(input: OcrInput): Promise<OcrResult> {
      if (Deno.build.os !== "darwin") {
        return fail("UNSUPPORTED_PLATFORM", ["Apple Vision requires macOS"]);
      }
      if (!input.imageBase64.trim()) {
        return fail("EMPTY_IMAGE", ["imageBase64 is empty"]);
      }

      const helper = await ensureHelperBinary(binaryPath);
      if (!helper.ok) return fail("PROVIDER_UNAVAILABLE", [helper.error]);

      const imagePath = await Deno.makeTempFile({
        prefix: "ocr-",
        suffix: extensionForMimeType(input.imageMimeType),
      });

      try {
        await Deno.writeFile(imagePath, decodeBase64(input.imageBase64));
        const output = await new Deno.Command(helper.path, {
          args: [imagePath],
        }).output();

        if (!output.success) {
          const stderr = new TextDecoder().decode(output.stderr).trim();
          return fail("PROVIDER_RUN_FAILED", [
            stderr || `helper exited with code ${output.code}`,
          ]);
        }

        const stdout = new TextDecoder().decode(output.stdout);
        try {
          return parseAppleVisionOcrOutput(stdout, {
            qualityChecks,
            thresholds,
          });
        } catch (error) {
          return fail("INVALID_PROVIDER_OUTPUT", [
            error instanceof Error ? error.message : String(error),
          ]);
        }
      } finally {
        // Nettoyage best-effort : un temporaire résiduel ne doit pas masquer
        // le résultat de la transcription.
        await Deno.remove(imagePath).catch(() => {});
      }
    },
  };
}

/**
 * Parse la sortie JSON du helper. Exporté pour être testable sans macOS —
 * c'est le seul morceau de logique de ce module qui ne dépend pas de l'hôte.
 */
export function parseAppleVisionOcrOutput(
  stdout: string,
  options: {
    readonly qualityChecks?: readonly OcrQualityCheck[];
    readonly thresholds?: OcrConfidenceThresholds;
  } = {},
): OcrResult {
  const parsed = JSON.parse(stdout) as AppleVisionPayload;

  if (!parsed.ok) {
    return fail("PROVIDER_ERROR", [
      `${parsed.error.code}: ${parsed.error.message}`,
    ]);
  }

  const lines = parsed.lines.filter((line) => line.text.trim() !== "");
  if (lines.length === 0) return fail("NO_TEXT", ["no text lines returned"]);

  const avgConfidence = averageConfidence(lines);
  const warnings = runOcrQualityChecks(
    lines.map((line) => line.text),
    options.qualityChecks ?? [],
  );

  return {
    rawMarkdown: renderOcrLinesToMarkdown(lines),
    ocrLayout: {
      provider: APPLE_VISION_PROVIDER_NAME,
      coordinateSystem: "normalized-lower-left",
      lines: lines.map((line) => ({
        text: line.text,
        confidence: line.confidence,
        boundingBox: line.boundingBox,
      })),
    },
    confidence: confidenceFromAverage(avgConfidence, options.thresholds),
    notes: warnings.length === 0 ? null : warnings.join("; "),
    fallbackReason: null,
    diagnostics: {
      provider: APPLE_VISION_PROVIDER_NAME,
      lineCount: lines.length,
      avgConfidence,
      warnings,
    },
  };
}

/** Chemin du source Objective-C embarqué dans le package. */
export function appleVisionHelperSourcePath(): string {
  return fromFileUrl(new URL("./native/apple-vision-ocr.m", import.meta.url));
}

function fail(
  reason: Parameters<typeof emptyOcrResult>[1],
  warnings: readonly string[],
): OcrResult {
  return emptyOcrResult(APPLE_VISION_PROVIDER_NAME, reason, warnings);
}

function extensionForMimeType(
  mimeType: OcrInput["imageMimeType"],
): ".png" | ".jpg" | ".webp" {
  if (mimeType === "image/png") return ".png";
  if (mimeType === "image/webp") return ".webp";
  return ".jpg";
}

async function ensureHelperBinary(
  binaryPath: string,
): Promise<{ ok: true; path: string } | { ok: false; error: string }> {
  const sourcePath = appleVisionHelperSourcePath();

  if (!await needsCompile(sourcePath, binaryPath)) {
    return { ok: true, path: binaryPath };
  }

  const output = await new Deno.Command("clang", {
    args: [
      "-fobjc-arc",
      "-framework",
      "Foundation",
      "-framework",
      "AppKit",
      "-framework",
      "Vision",
      sourcePath,
      "-o",
      binaryPath,
    ],
  }).output();

  if (!output.success) {
    const stderr = new TextDecoder().decode(output.stderr).trim();
    return {
      ok: false,
      error: stderr || `clang exited with code ${output.code}`,
    };
  }

  return { ok: true, path: binaryPath };
}

async function needsCompile(
  sourcePath: string,
  binaryPath: string,
): Promise<boolean> {
  try {
    const [source, binary] = await Promise.all([
      Deno.stat(sourcePath),
      Deno.stat(binaryPath),
    ]);
    return source.mtime !== null && binary.mtime !== null &&
      source.mtime.getTime() > binary.mtime.getTime();
  } catch {
    return true;
  }
}
