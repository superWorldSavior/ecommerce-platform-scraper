/**
 * Selects the context sent to a model out of scraped artifacts, grouped by
 * role.
 *
 * An **artifact** is a captured fragment of a page: the HTML itself, an image
 * fed to OCR, a description block. A **role** says what that fragment is for.
 * A **projection** is what we are trying to extract.
 *
 * The role vocabulary belongs to the **domain**, not to the kernel: scraping
 * dietary supplements needs a "nutrition label" role, scraping electronic
 * components needs "datasheet". So the kernel supplies the *mechanics*
 * (classification, selection, fallback, counting) and receives the *vocabulary*
 * through `RoleVocabulary`.
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
 * Roles that hold for any e-commerce storefront. A domain extends this base
 * with roles of its own rather than replacing it.
 *
 *  - `html` — the page itself: a **structural** role, always selectable.
 *  - `product-description` — editorial block describing the product.
 *  - `certificate` — attestation, label, test result.
 *  - `related-product` — cross-sell, "you may also like".
 *  - `promo` — marketing banner, discount code.
 *  - `ui` — template chrome: logo, favicon, icons.
 *  - `unknown` — unclassified.
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

/** Base roles that never carry usable product content. */
export const BASE_NOISE_ROLES = [
  "ui",
  "promo",
  "related-product",
] as const satisfies readonly BaseArtifactRole[];

/**
 * A domain's role vocabulary.
 *
 * `structural` and `unknownRole` must belong to `roles` — checked at
 * construction time by `defineRoleVocabulary`.
 */
export interface RoleVocabulary<TRole extends string> {
  /** Every role in the domain. Used to build the counters. */
  readonly roles: readonly TRole[];
  /** Role of the page as a whole: exempt from the noise filter. */
  readonly structural: TRole;
  /** Role given to unclassified artifacts. */
  readonly unknownRole: TRole;
  /** Roles that disqualify an artifact, unless it is also `structural`. */
  readonly noise: readonly TRole[];
  /** Preferred roles per projection. A missing projection ⇒ full context. */
  readonly preferences: Readonly<Record<string, readonly TRole[]>>;
}

export class RoleVocabularyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RoleVocabularyError";
  }
}

/**
 * Builds a vocabulary, checking its internal consistency. `structural`,
 * `unknownRole`, `noise` and every role named in `preferences` must appear in
 * `roles` — otherwise the counters would silently have holes.
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

/** Zeroed counters for every role in the vocabulary. */
export function createEmptyRoleCounts<TRole extends string>(
  vocabulary: RoleVocabulary<TRole>,
): Record<TRole, number> {
  return Object.fromEntries(
    vocabulary.roles.map((role) => [role, 0]),
  ) as Record<TRole, number>;
}

/**
 * Fallback provider: labels the page `structural`, everything else
 * `unknownRole`, and filters nothing. This is the behavior when no specific
 * provider is declared for a source.
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
 * Narrows a page's artifacts down to the subset useful to one projection.
 *
 * Falls back to the full context — recording `fallbackReason` — in four cases:
 * no provider, a classification carrying no signal, a projection with no
 * declared preference, or a filter that leaves nothing behind. A full context
 * is still usable; an empty one is not.
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
 * Artifacts of the context that carry one of the requested roles. If none
 * match but the context is already a fallback, returns everything — otherwise
 * the caller would lose the little information there is.
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

/** Normalizes a URL extracted from raw HTML. `null` if not http(s). */
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
