/**
 * Shortcut for the most common artifact classification case.
 */

import type {
  ArtifactClassification,
  ArtifactContextArtifact,
  ArtifactContextProvider,
  ArtifactContextSelectionMode,
} from "./artifact-context.ts";

/**
 * Builds an `ArtifactContextProvider` for the case where an artifact's role
 * follows from the artifact **alone** — without looking at its neighbors, and
 * without any I/O.
 *
 * That is the common case: an image whose URL contains `nutrition-facts` can be
 * classified without knowing anything about the rest of the page. Sources that
 * need cross-artifact context ("the last slide of the carousel") or a disk read
 * write their provider by hand: this helper could not serve them without
 * turning into a framework of its own.
 *
 * ```ts
 * projectionProviders: {
 *   artifactContext: createPerArtifactContextProvider({
 *     sourceName: "example",
 *     classify: (artifact) =>
 *       /label/iu.test(artifact.sourceUrl ?? "") ? ["nutrition"] : ["unknown"],
 *   }),
 *   structuredFacts: null,
 * }
 * ```
 *
 * `selectionMode`:
 *  - `"role-filtered"` (the default) — selection filters by role, following
 *    the vocabulary's preferences.
 *  - `"full"` — every artifact is passed through; the classification is kept
 *    for auditing only. Useful to calibrate a new classifier without risking
 *    any loss of context.
 */
export function createPerArtifactContextProvider<
  TRole extends string,
  TArtifact extends ArtifactContextArtifact = ArtifactContextArtifact,
>(options: {
  readonly sourceName: string;
  readonly selectionMode?: ArtifactContextSelectionMode;
  readonly classify: (artifact: TArtifact) => TRole[];
}): ArtifactContextProvider<TRole, TArtifact> {
  const { sourceName, selectionMode = "role-filtered", classify } = options;

  return {
    sourceName,
    classify(input): ArtifactClassification<TRole, TArtifact> {
      return {
        providerName: sourceName,
        selectionMode,
        fallbackReason: null,
        artifacts: input.artifacts.map((artifact) => ({
          artifact,
          roles: classify(artifact),
          reason: null,
        })),
      };
    },
  };
}
