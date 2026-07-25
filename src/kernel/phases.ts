/**
 * Scraping pipeline phases, in execution order.
 *
 * A source declares which phases it supports through `SourceModule.phases`; an
 * absent field means "every phase". Defined in its own module so that the
 * `SourceModule` contract can reference the type without an import cycle.
 *
 *  - `download` — fetches the raw HTML into local storage.
 *  - `stage` — parses the HTML into structured records.
 *  - `reconcile` — deduplicates and merges the staged records.
 *  - `transcribe-html` / `transcribe-images` — enrichment passes, over text and
 *    over images respectively (OCR, vision model).
 *  - `apply-projections` — projects the extracted facts onto the business
 *    model.
 *  - `score` — derived computation specific to the consumer's domain.
 *  - `project` — final write to the destination.
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
