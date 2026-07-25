/**
 * Raccourci pour le cas le plus fréquent de classification d'artefacts.
 */

import type {
  ArtifactClassification,
  ArtifactContextArtifact,
  ArtifactContextProvider,
  ArtifactContextSelectionMode,
} from "./artifact-context.ts";

/**
 * Construit un `ArtifactContextProvider` quand le rôle d'un artefact se déduit
 * de l'artefact **seul** — sans regarder ses voisins, et sans entrée/sortie.
 *
 * C'est le cas courant : une image dont l'URL contient `nutrition-facts` se
 * classe sans rien savoir du reste de la page. Les sources qui ont besoin d'un
 * contexte croisé (« la dernière slide du carrousel ») ou d'une lecture disque
 * écrivent leur provider à la main : ce helper ne pourrait pas les servir sans
 * devenir un cadre à part entière.
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
 * `selectionMode` :
 *  - `"role-filtered"` (défaut) — la sélection filtre par rôle selon les
 *    préférences du vocabulaire.
 *  - `"full"` — tous les artefacts sont transmis ; la classification n'est
 *    conservée que pour l'audit. Utile pour calibrer un classifieur neuf sans
 *    risquer de perdre du contexte.
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
