/**
 * Contrôles qualité OCR pour le chinois traditionnel (zh-Hant).
 *
 * Les moteurs OCR confondent certains caractères traditionnels avec un
 * homographe simplifié ou une variante voisine. Sur une étiquette produit, la
 * confusion tombe souvent sur un nom d'ingrédient — donc exactement sur
 * l'information qu'on cherchait à extraire, et sans faire chuter la confiance
 * du moteur : la forme reconnue est un caractère valide, simplement pas le bon.
 *
 * Ces contrôles **signalent**, ils ne corrigent pas. Réécrire la transcription
 * détruirait la preuve source, seule base d'un audit ultérieur. L'appelant
 * décide quoi faire de l'avertissement — repasser la page en revue, la marquer
 * incomplète, ou tenter un autre moteur.
 *
 * ```ts
 * const provider = createAppleVisionOcrProvider({
 *   qualityChecks: [traditionalChineseOcrQualityCheck],
 * });
 * ```
 */

import type { OcrQualityCheck } from "../../kernel/ocr/provider.ts";

/**
 * Confusions observées en production, forme attendue → formes erronées.
 *
 * Volontairement conservatrice : chaque entrée vient d'un cas constaté sur une
 * étiquette réelle. Un motif spéculatif produirait du bruit sur des pages
 * correctes, et un avertissement qu'on apprend à ignorer ne sert à rien.
 */
export const TRADITIONAL_CHINESE_OCR_CONFUSIONS: ReadonlyArray<{
  readonly expected: string;
  readonly misread: readonly string[];
}> = [
  { expected: "黃耆", misread: ["黄者", "黃蓍"] },
];

/**
 * Signale les confusions de caractères traditionnels connues.
 *
 * Les étiquettes retournées ont la forme `suspect_<attendu>_as_<lu>`, stables
 * et parsables — un consommateur peut les agréger par type de confusion pour
 * savoir quel caractère pose problème sur son corpus.
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
