/**
 * Sélection du contexte envoyé à un modèle, à partir d'artefacts scrapés
 * classés par rôle.
 *
 * Un **artefact** est un fragment capturé d'une page : le HTML lui-même, une
 * image passée à l'OCR, un bloc de description. Un **rôle** dit à quoi sert ce
 * fragment. Une **projection** est ce qu'on cherche à extraire.
 *
 * Le vocabulaire de rôles appartient au **domaine**, pas au kernel : scraper des
 * compléments alimentaires demande un rôle « étiquette nutritionnelle », scraper
 * des composants électroniques demande « fiche technique ». Le kernel fournit
 * donc la *mécanique* (classification, sélection, repli, comptage) et reçoit le
 * *vocabulaire* via `RoleVocabulary`.
 *
 * ```ts
 * const vocabulary = defineRoleVocabulary({
 *   roles: [...BASE_ARTIFACT_ROLES, "datasheet"],
 *   preferences: { specs: ["html", "datasheet", "product-description"] },
 * });
 *
 * const context = selectProjectionContext({
 *   projection: "specs",
 *   artifacts,
 *   classification,
 *   vocabulary,
 * });
 * ```
 */

/**
 * Rôles valables pour n'importe quel storefront e-commerce. Un domaine étend
 * cette base avec ses propres rôles plutôt que de la remplacer.
 *
 *  - `html` — la page elle-même : rôle **structurel**, toujours sélectionnable.
 *  - `product-description` — bloc rédactionnel décrivant le produit.
 *  - `certificate` — attestation, label, résultat de test.
 *  - `related-product` — cross-sell, « vous aimerez aussi ».
 *  - `promo` — bandeau marketing, code de réduction.
 *  - `ui` — chrome du gabarit : logo, favicon, icônes.
 *  - `unknown` — non classé.
 */
export const BASE_ARTIFACT_ROLES = [
  "html",
  "product-description",
  "certificate",
  "related-product",
  "promo",
  "ui",
  "unknown",
] as const;

export type BaseArtifactRole = typeof BASE_ARTIFACT_ROLES[number];

/** Rôles de la base qui n'apportent jamais de contenu produit exploitable. */
export const BASE_NOISE_ROLES = [
  "ui",
  "promo",
  "related-product",
] as const satisfies readonly BaseArtifactRole[];

/**
 * Vocabulaire de rôles d'un domaine.
 *
 * `structural` et `unknownRole` doivent appartenir à `roles` — c'est vérifié à
 * la construction par `defineRoleVocabulary`.
 */
export interface RoleVocabulary<TRole extends string> {
  /** Tous les rôles du domaine. Sert à construire les compteurs. */
  readonly roles: readonly TRole[];
  /** Rôle de la page entière : échappe au filtre de bruit. */
  readonly structural: TRole;
  /** Rôle des artefacts non classés. */
  readonly unknownRole: TRole;
  /** Rôles qui disqualifient un artefact, sauf s'il est aussi `structural`. */
  readonly noise: readonly TRole[];
  /** Rôles préférés par projection. Une projection absente ⇒ contexte complet. */
  readonly preferences: Readonly<Record<string, readonly TRole[]>>;
}

export class RoleVocabularyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleVocabularyError";
  }
}

/**
 * Construit un vocabulaire en validant sa cohérence interne. `structural`,
 * `unknownRole`, `noise` et les rôles cités dans `preferences` doivent tous
 * figurer dans `roles` — sinon les compteurs auraient des trous silencieux.
 */
export function defineRoleVocabulary<TRole extends string>(
  spec: {
    readonly roles: readonly TRole[];
    readonly preferences: Readonly<Record<string, readonly TRole[]>>;
    readonly structural?: TRole;
    readonly unknownRole?: TRole;
    readonly noise?: readonly TRole[];
  },
): RoleVocabulary<TRole> {
  const structural = spec.structural ?? ("html" as TRole);
  const unknownRole = spec.unknownRole ?? ("unknown" as TRole);
  const noise = spec.noise ??
    spec.roles.filter((role) =>
      (BASE_NOISE_ROLES as readonly string[]).includes(role)
    );

  const known = new Set<string>(spec.roles);
  const missing = (label: string, roles: readonly string[]) => {
    const absent = roles.filter((role) => !known.has(role));
    if (absent.length > 0) {
      throw new RoleVocabularyError(
        `${label} references roles absent from \`roles\`: ${absent.join(", ")}`,
      );
    }
  };

  missing("structural", [structural]);
  missing("unknownRole", [unknownRole]);
  missing("noise", noise);
  for (const [projection, roles] of Object.entries(spec.preferences)) {
    missing(`preferences["${projection}"]`, roles);
  }

  return {
    roles: spec.roles,
    structural,
    unknownRole,
    noise,
    preferences: spec.preferences,
  };
}

export type ArtifactContextSelectionMode = "full" | "role-filtered";

export type ArtifactContextFallbackReason =
  | "NO_PROVIDER"
  | "CLASSIFICATION_EMPTY"
  | "NO_SELECTED_ARTIFACTS"
  | "PROVIDER_FALLBACK";

export interface ArtifactContextArtifact {
  id: string;
  artifactKind: string;
  sourceUrl?: string;
  rawMarkdown: string;
  ocrLayout?: unknown;
  capturedAt: Date;
}

export interface ClassifiedArtifact<
  TRole extends string,
  TArtifact extends ArtifactContextArtifact = ArtifactContextArtifact,
> {
  artifact: TArtifact;
  roles: TRole[];
  reason: string | null;
}

export interface ArtifactClassification<
  TRole extends string,
  TArtifact extends ArtifactContextArtifact = ArtifactContextArtifact,
> {
  providerName: string;
  selectionMode: ArtifactContextSelectionMode;
  artifacts: ClassifiedArtifact<TRole, TArtifact>[];
  fallbackReason: string | null;
}

export interface ArtifactContextProviderInput<
  TArtifact extends ArtifactContextArtifact = ArtifactContextArtifact,
> {
  artifacts: TArtifact[];
  quarter: string;
}

export interface ArtifactContextProvider<
  TRole extends string,
  TArtifact extends ArtifactContextArtifact = ArtifactContextArtifact,
> {
  readonly sourceName: string;
  classify(
    input: ArtifactContextProviderInput<TArtifact>,
  ):
    | ArtifactClassification<TRole, TArtifact>
    | Promise<ArtifactClassification<TRole, TArtifact>>;
}

export interface ProjectionContextStats<TRole extends string> {
  selected: number;
  dropped: number;
  roles: Record<TRole, number>;
  charsBefore: number;
  charsAfter: number;
}

export interface ProjectionContext<
  TRole extends string,
  TArtifact extends ArtifactContextArtifact = ArtifactContextArtifact,
> {
  projection: string;
  providerName: string;
  artifacts: TArtifact[];
  classifiedArtifacts: ClassifiedArtifact<TRole, TArtifact>[];
  stats: ProjectionContextStats<TRole>;
  fallbackReason: ArtifactContextFallbackReason | null;
  providerFallbackReason: string | null;
}

/** Compteurs à zéro pour tous les rôles du vocabulaire. */
export function createEmptyRoleCounts<TRole extends string>(
  vocabulary: RoleVocabulary<TRole>,
): Record<TRole, number> {
  return Object.fromEntries(
    vocabulary.roles.map((role) => [role, 0]),
  ) as Record<TRole, number>;
}

/**
 * Provider de repli : classe la page en `structural`, tout le reste en
 * `unknownRole`, et ne filtre rien. C'est le comportement quand aucun provider
 * spécifique n'est déclaré pour une source.
 */
export function createDefaultArtifactContextProvider<TRole extends string>(
  vocabulary: RoleVocabulary<TRole>,
): ArtifactContextProvider<TRole> {
  return {
    sourceName: "default",
    classify(input) {
      return {
        providerName: "default",
        selectionMode: "full",
        fallbackReason: null,
        artifacts: input.artifacts.map((artifact) => ({
          artifact,
          roles: defaultRolesForArtifact(artifact, vocabulary),
          reason: "default_full_context",
        })),
      };
    },
  };
}

export function preferredRolesForProjection<TRole extends string>(
  vocabulary: RoleVocabulary<TRole>,
  projection: string,
): readonly TRole[] | null {
  return vocabulary.preferences[projection] ?? null;
}

/**
 * Réduit les artefacts d'une page au sous-ensemble utile à une projection.
 *
 * Retombe sur le contexte complet — en renseignant `fallbackReason` — dans
 * quatre cas : aucun provider, classification vide de signal, projection sans
 * préférence déclarée, ou filtre ne laissant rien. Un contexte complet reste
 * exploitable ; un contexte vide ne l'est pas.
 */
export function selectProjectionContext<
  TRole extends string,
  TArtifact extends ArtifactContextArtifact,
>(input: {
  projection: string;
  artifacts: TArtifact[];
  classification: ArtifactClassification<TRole, TArtifact> | null;
  vocabulary: RoleVocabulary<TRole>;
}): ProjectionContext<TRole, TArtifact> {
  const { vocabulary, classification } = input;
  const charsBefore = sumArtifactChars(input.artifacts);
  const providerName = classification?.providerName ?? "default";
  const providerFallbackReason = classification?.fallbackReason ?? null;

  const fallback = (
    fallbackReason: ArtifactContextFallbackReason | null,
    roles: Record<TRole, number>,
    classifiedArtifacts: ClassifiedArtifact<TRole, TArtifact>[],
  ): ProjectionContext<TRole, TArtifact> => ({
    projection: input.projection,
    providerName,
    artifacts: input.artifacts,
    classifiedArtifacts,
    stats: {
      selected: input.artifacts.length,
      dropped: 0,
      roles,
      charsBefore,
      charsAfter: charsBefore,
    },
    fallbackReason,
    providerFallbackReason,
  });

  if (classification === null) {
    return fallback(
      "NO_PROVIDER",
      roleCountsForDefault(input.artifacts, vocabulary),
      defaultClassifiedArtifacts(input.artifacts, vocabulary),
    );
  }

  const roleCounts = createEmptyRoleCounts(vocabulary);
  for (const classified of classification.artifacts) {
    for (const role of classified.roles) roleCounts[role]++;
  }

  const asFullContext = (
    reason: ArtifactContextFallbackReason | null,
  ) =>
    fallback(
      reason,
      roleCounts,
      classifiedArtifactsForFullContext(
        input.artifacts,
        classification,
        vocabulary,
      ),
    );

  if (!hasEffectiveClassification(classification, vocabulary)) {
    return asFullContext("CLASSIFICATION_EMPTY");
  }

  const preferredRoles = preferredRolesForProjection(
    vocabulary,
    input.projection,
  );

  if (classification.selectionMode === "full" || preferredRoles === null) {
    return asFullContext(
      providerFallbackReason === null ? null : "PROVIDER_FALLBACK",
    );
  }

  const selectedClassified = classification.artifacts.filter((classified) =>
    isSelectableForProjection(classified.roles, preferredRoles, vocabulary)
  );
  const selected = selectedClassified.map((classified) => classified.artifact);

  if (selected.length === 0) return asFullContext("NO_SELECTED_ARTIFACTS");

  return {
    projection: input.projection,
    providerName,
    artifacts: selected,
    classifiedArtifacts: selectedClassified,
    stats: {
      selected: selected.length,
      dropped: input.artifacts.length - selected.length,
      roles: roleCounts,
      charsBefore,
      charsAfter: sumArtifactChars(selected),
    },
    fallbackReason: providerFallbackReason === null
      ? null
      : "PROVIDER_FALLBACK",
    providerFallbackReason,
  };
}

/**
 * Artefacts du contexte portant l'un des rôles demandés. Si aucun ne
 * correspond mais que le contexte est déjà un repli, retourne tout — sinon
 * l'appelant perdrait le peu d'information disponible.
 */
export function projectionContextArtifactsWithRoles<
  TRole extends string,
  TArtifact extends ArtifactContextArtifact,
>(
  context: ProjectionContext<TRole, TArtifact>,
  roles: readonly TRole[],
): TArtifact[] {
  const selected = context.classifiedArtifacts
    .filter((classified) =>
      classified.roles.some((role) => roles.includes(role))
    )
    .map((classified) => classified.artifact);

  if (selected.length > 0) return selected;
  if (context.fallbackReason !== null) return context.artifacts;
  return [];
}

export function sumArtifactChars(
  artifacts: readonly ArtifactContextArtifact[],
): number {
  return artifacts.reduce(
    (sum, artifact) => sum + artifact.rawMarkdown.length,
    0,
  );
}

/** Normalise une URL extraite d'un HTML brut. `null` si non http(s). */
export function normalizeArtifactUrl(raw: string): string | null {
  const url = raw
    .replaceAll("&amp;", "&")
    .replaceAll("\\/", "/")
    .trim();
  if (!/^https?:\/\//iu.test(url)) return null;
  return url;
}

function defaultRolesForArtifact<TRole extends string>(
  artifact: ArtifactContextArtifact,
  vocabulary: RoleVocabulary<TRole>,
): TRole[] {
  return artifact.artifactKind === "html"
    ? [vocabulary.structural]
    : [vocabulary.unknownRole];
}

function defaultClassifiedArtifacts<
  TRole extends string,
  TArtifact extends ArtifactContextArtifact,
>(
  artifacts: TArtifact[],
  vocabulary: RoleVocabulary<TRole>,
): ClassifiedArtifact<TRole, TArtifact>[] {
  return artifacts.map((artifact) => ({
    artifact,
    roles: defaultRolesForArtifact(artifact, vocabulary),
    reason: "default_full_context",
  }));
}

function classifiedArtifactsForFullContext<
  TRole extends string,
  TArtifact extends ArtifactContextArtifact,
>(
  artifacts: TArtifact[],
  classification: ArtifactClassification<TRole, TArtifact>,
  vocabulary: RoleVocabulary<TRole>,
): ClassifiedArtifact<TRole, TArtifact>[] {
  const byId = new Map(
    classification.artifacts.map((classified) => [
      classified.artifact.id,
      classified,
    ]),
  );
  return artifacts.map((artifact) =>
    byId.get(artifact.id) ?? {
      artifact,
      roles: defaultRolesForArtifact(artifact, vocabulary),
      reason: "default_full_context",
    }
  );
}

function isSelectableForProjection<TRole extends string>(
  roles: readonly TRole[],
  preferredRoles: readonly TRole[],
  vocabulary: RoleVocabulary<TRole>,
): boolean {
  if (!roles.some((role) => preferredRoles.includes(role))) return false;
  if (roles.includes(vocabulary.structural)) return true;
  return !roles.some((role) => vocabulary.noise.includes(role));
}

function hasEffectiveClassification<
  TRole extends string,
  TArtifact extends ArtifactContextArtifact,
>(
  classification: ArtifactClassification<TRole, TArtifact>,
  vocabulary: RoleVocabulary<TRole>,
): boolean {
  if (classification.selectionMode === "full") return true;
  return classification.artifacts.some((classified) =>
    classified.roles.some((role) =>
      role !== vocabulary.structural && role !== vocabulary.unknownRole
    )
  );
}

function roleCountsForDefault<TRole extends string>(
  artifacts: readonly ArtifactContextArtifact[],
  vocabulary: RoleVocabulary<TRole>,
): Record<TRole, number> {
  const roles = createEmptyRoleCounts(vocabulary);
  for (const artifact of artifacts) {
    for (const role of defaultRolesForArtifact(artifact, vocabulary)) {
      roles[role]++;
    }
  }
  return roles;
}
