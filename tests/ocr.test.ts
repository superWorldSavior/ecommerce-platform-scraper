import { assertEquals } from "@std/assert";
import {
  confidenceFromAverage,
  emptyOcrResult,
  renderOcrLinesToMarkdown,
  runOcrQualityChecks,
} from "../src/kernel/ocr/provider.ts";
import {
  APPLE_VISION_PROVIDER_NAME,
  parseAppleVisionOcrOutput,
} from "../src/kernel/ocr/apple-vision.ts";
import { traditionalChineseOcrQualityCheck } from "../src/locales/zh-TW/ocr-quality.ts";

const line = (text: string, confidence: number) => ({
  text,
  confidence,
  boundingBox: null,
});

Deno.test("confidenceFromAverage applique les seuils", () => {
  assertEquals(confidenceFromAverage(null), "LOW");
  assertEquals(confidenceFromAverage(0.9), "HIGH");
  assertEquals(confidenceFromAverage(0.82), "HIGH");
  assertEquals(confidenceFromAverage(0.7), "MEDIUM");
  assertEquals(confidenceFromAverage(0.55), "MEDIUM");
  assertEquals(confidenceFromAverage(0.2), "LOW");
});

Deno.test("confidenceFromAverage accepte des seuils personnalisés", () => {
  const strict = { high: 0.95, medium: 0.9 };
  assertEquals(confidenceFromAverage(0.92, strict), "MEDIUM");
  assertEquals(confidenceFromAverage(0.96, strict), "HIGH");
});

Deno.test("renderOcrLinesToMarkdown ignore les lignes vides", () => {
  assertEquals(
    renderOcrLinesToMarkdown([line("a", 1), line("   ", 1), line("b", 1)]),
    "a\nb",
  );
});

Deno.test("emptyOcrResult porte le nom du moteur et la raison", () => {
  const result = emptyOcrResult("some-engine", "NO_TEXT", ["rien trouvé"]);
  assertEquals(result.diagnostics.provider, "some-engine");
  assertEquals(result.fallbackReason, "NO_TEXT");
  assertEquals(result.confidence, "LOW");
  assertEquals(result.notes, "rien trouvé");
  assertEquals(result.ocrLayout, null);
});

Deno.test("parseAppleVisionOcrOutput transcrit une sortie valide", () => {
  const stdout = JSON.stringify({
    ok: true,
    provider: "apple-vision",
    lines: [line("每份含量", 0.95), line("蛋白質 20 公克", 0.9)],
  });

  const result = parseAppleVisionOcrOutput(stdout);

  assertEquals(result.fallbackReason, null);
  assertEquals(result.confidence, "HIGH");
  assertEquals(result.rawMarkdown, "每份含量\n蛋白質 20 公克");
  assertEquals(result.diagnostics.lineCount, 2);
  assertEquals(result.ocrLayout?.provider, APPLE_VISION_PROVIDER_NAME);
});

Deno.test("parseAppleVisionOcrOutput signale une erreur du moteur", () => {
  const stdout = JSON.stringify({
    ok: false,
    error: { code: "NO_IMAGE", message: "cannot decode" },
  });

  const result = parseAppleVisionOcrOutput(stdout);
  assertEquals(result.fallbackReason, "PROVIDER_ERROR");
  assertEquals(result.notes, "NO_IMAGE: cannot decode");
});

Deno.test("parseAppleVisionOcrOutput signale l'absence de texte", () => {
  const stdout = JSON.stringify({
    ok: true,
    provider: "apple-vision",
    lines: [line("   ", 0.9)],
  });

  assertEquals(parseAppleVisionOcrOutput(stdout).fallbackReason, "NO_TEXT");
});

Deno.test("les contrôles qualité remontent dans notes et diagnostics", () => {
  const stdout = JSON.stringify({
    ok: true,
    provider: "apple-vision",
    lines: [line("黄者 萃取物", 0.95)],
  });

  const result = parseAppleVisionOcrOutput(stdout, {
    qualityChecks: [traditionalChineseOcrQualityCheck],
  });

  assertEquals(result.diagnostics.warnings, ["suspect_黃耆_as_黄者"]);
  assertEquals(result.notes, "suspect_黃耆_as_黄者");
  // Le texte source n'est jamais réécrit : c'est la preuve d'audit.
  assertEquals(result.rawMarkdown, "黄者 萃取物");
});

Deno.test("le contrôle zh-TW reste muet sur un texte correct", () => {
  assertEquals(
    traditionalChineseOcrQualityCheck.run(["黃耆 萃取物", "維生素 C"]),
    [],
  );
});

Deno.test("runOcrQualityChecks agrège plusieurs contrôles", () => {
  const always = { name: "always", run: () => ["flag"] };
  assertEquals(
    runOcrQualityChecks(["黃蓍"], [
      traditionalChineseOcrQualityCheck,
      always,
    ]),
    ["suspect_黃耆_as_黃蓍", "flag"],
  );
});
