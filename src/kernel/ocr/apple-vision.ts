/**
 * Apple Vision OCR engine — **macOS only**.
 *
 * Implements `OcrProvider` by driving a small Objective-C helper
 * (`native/apple-vision-ocr.m`), compiled on demand with `clang` and cached
 * between runs. The helper returns the recognized lines with their confidence
 * and their normalized bounding box.
 *
 * Why Apple Vision: on photographed product labels it preserves dense CJK
 * scripts better than the open-source engines we tried — rare traditional
 * characters in particular. On any other host, `available()` returns `false`
 * and the caller has to switch to another engine; composing the fallback chain
 * is up to them.
 *
 * Requirements: macOS with the Xcode command line tools (`clang` and the
 * Foundation / AppKit / Vision frameworks).
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

/** Version of the helper's output contract; bump it whenever that changes. */
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
   * Quality checks applied to the transcribed lines. See `locales/` for the
   * checks shipped with the package.
   */
  readonly qualityChecks?: readonly OcrQualityCheck[];
  readonly thresholds?: OcrConfidenceThresholds;
  /**
   * Where the compiled binary lives. Defaults to a temporary path derived from
   * the engine name. Overriding it allows compiling once at install time,
   * rather than on the first call.
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
        // Best-effort cleanup: a leftover temp file must not mask the
        // transcription result.
        await Deno.remove(imagePath).catch(() => {});
      }
    },
  };
}

/**
 * Parses the helper's JSON output. Exported so it can be tested without macOS —
 * it is the only piece of logic in this module that does not depend on the
 * host.
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

/** Path to the Objective-C source bundled with the package. */
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
