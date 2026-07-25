/**
 * Phases du pipeline de scraping, dans l'ordre d'exécution.
 *
 * Une source déclare les phases qu'elle supporte via `SourceModule.phases` ;
 * l'absence du champ vaut « toutes les phases ». Défini dans son propre module
 * pour que le contrat `SourceModule` puisse référencer le type sans cycle
 * d'import.
 *
 *  - `download` — récupère le HTML brut vers le stockage local.
 *  - `stage` — parse le HTML en enregistrements structurés.
 *  - `reconcile` — déduplique et fusionne les enregistrements du staging.
 *  - `transcribe-html` / `transcribe-images` — passes d'enrichissement,
 *    respectivement sur le texte et sur les images (OCR, modèle vision).
 *  - `apply-projections` — projette les faits extraits vers le modèle métier.
 *  - `score` — calcul dérivé propre au domaine du consommateur.
 *  - `project` — écriture finale vers la destination.
 */
export const PIPELINE_PHASES = [
  "download",
  "stage",
  "reconcile",
  "transcribe-html",
  "transcribe-images",
  "apply-projections",
  "score",
  "project",
] as const;

export type PipelinePhase = typeof PIPELINE_PHASES[number];
