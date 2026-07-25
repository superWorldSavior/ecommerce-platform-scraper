/**
 * Declarative contract of a scraped source.
 *
 * Each site exposes one `SourceModule` instance. A registry aggregates them,
 * and the pipeline phases consume the capabilities declared here. The module is
 * **data**, not behavior: it describes what the site can do, and the generic
 * runners decide what to do with that.
 *
 * Before writing an adapter, check whether the site runs on a known engine:
 * `platforms/shopline`, `platforms/cyberbiz` and `platforms/bvshop` assemble
 * the engine's defaults and leave only the site-specific parts to declare.
 *
 * ## Two type parameters
 *
 * - `TRole` — the domain's artifact role vocabulary (see
 *   `artifact-context.ts`). Defaults to the base e-commerce roles.
 * - `TFacts` — the domain's structured-facts provider. The kernel never
 *   inspects it; it carries it through to the layer that knows how to read it.
 *
 * ## Required nullable fields
 *
 * `imageCandidateSelector`, `catalogDiscovery` and both providers are
 * **required but nullable**. `null` means "deliberately absent and audited";
 * `undefined` is forbidden. Adding a mandatory field here therefore breaks
 * compilation on every source that omits it — inversion of control without a
 * framework, and no silent omission when a source is added.
 */

import type {
  ArtifactContextProvider,
  BaseArtifactRole,
} from "./artifact-context.ts";
import type { ImageCandidateSelector } from "./image-candidates.ts";
import type { CommercePlatform } from "./commerce-platform.ts";
import type { PipelinePhase } from "./phases.ts";

/**
 * Projection capabilities declared per source. Both fields are required and
 * nullable: `null` = deliberately absent, a provider = structured extraction.
 * The calling layer decides what to fall back to on `null`, typically a model
 * pass.
 */
export interface ProjectionProviders<
  TRole extends string = BaseArtifactRole,
  TFacts = unknown,
> {
  readonly artifactContext: ArtifactContextProvider<TRole> | null;
  readonly structuredFacts: TFacts | null;
}

export interface SourceModule<
  TRole extends string = BaseArtifactRole,
  TFacts = unknown,
> {
  /** Lowercase ASCII identifier, used as the key across the whole pipeline. */
  readonly name: string;

  /**
   * The site's host, as it appears in the raw storage tree:
   * `<rawRoot>/<rawHost>/<quarter>/products/*.html`.
   */
  readonly rawHost: string;

  /** The site's commerce engine. `custom` when there is no common engine. */
  readonly commercePlatform: CommercePlatform;

  /**
   * URL pattern of the site's image CDN. Used to attribute the images found in
   * an HTML page to the right source — two sites can reference each other's
   * images.
   */
  readonly imageUrlHint: RegExp;

  /**
   * Captures the product slug from the canonical URL. Optional: a source
   * without this field does not support automatic filtering of discovered
   * URLs.
   */
  readonly productUrlRegex?: RegExp;

  /** Supported phases. Optional: defaults to all (`PIPELINE_PHASES`). */
  readonly phases?: readonly PipelinePhase[];

  readonly projectionProviders: ProjectionProviders<TRole, TFacts>;

  /**
   * Read-only telemetry for image discovery: counts the URLs classified by
   * role, to measure how well the filtering works. Has no influence on the
   * pipeline — for the active filter, see `imageCandidateSelector`. Optional.
   */
  readonly imageDiscoveryUsefulnessAnalyzer?: (
    html: string,
    imageUrls: readonly string[],
  ) => ImageDiscoveryUsefulnessStats<TRole>;

  /**
   * Selects the candidate images to send to OCR. Required, nullable: `null` =
   * no selection, every candidate is kept. Required so that each source has to
   * take a position — sites on the same engine are meant to share the same
   * selector.
   */
  readonly imageCandidateSelector: ImageCandidateSelector | null;

  /**
   * Secondary HTML locations to try when the primary one is missing. Useful for
   * sites that keep an archive on top of the current catalog. Optional.
   */
  readonly htmlFallbackPathsFor?: (
    productId: string,
    quarter: string,
  ) => readonly string[];

  /**
   * Source-specific pipeline functions, exposed to the generic runners. A
   * source opts into a runner by exposing the matching bundle; without the
   * bundle it requires, the runner fails explicitly instead of guessing.
   */
  readonly pipelineFns?: SourcePipelineFns;

  /**
   * Discovery of the full catalog, beyond a supplied candidate list. Required,
   * nullable: `null` = the source exposes no enumerable catalog.
   */
  readonly catalogDiscovery: CatalogDiscoverySource | null;
}

export interface MinimalStageSnapshot {
  parsedProducts: number;
  totalPages: number;
  gateSummary: Record<string, number>;
}

export interface MinimalReconciledSnapshot {
  reconcileSummary: {
    canonicalRecords: number;
    mergedAwayRecords: number;
    duplicateGroups: number;
  };
}

/**
 * Download bundle: configures fetching HTML into raw storage. A source that
 * exposes it accepts the generic download runner; the others keep a fetch path
 * of their own (residential proxy, driven browser, geo-restricted network…).
 */
export interface DownloadPipelineFns {
  /** The site's base URL. Required: it roots the canonical URLs. */
  readonly siteUrl: string;
  /**
   * Builds the canonical URL from a slug. Optional: defaults to
   * `${siteUrl}/products/${slug}`. The builder must encode the slug itself.
   */
  readonly productUrlForSlug?: (slug: string) => string;
  /**
   * Extra discovery slugs, loaded best-effort. Use case: several storefronts
   * served from a single domain.
   */
  readonly additionalDiscoverySlugs?: readonly string[];
}

/**
 * Stage bundle: `parsePages` and `buildStageSnapshot` are required
 * **together**. A source cannot expose one without the other — otherwise a
 * present but incomplete bundle would compile, only to fail at runtime.
 */
export interface StagePipelineFns {
  readonly parsePages: (
    pages: ReadonlyArray<{ url: string; html: string }>,
  ) => {
    /**
     * Parsed products. The exact shape varies per source, but all of them
     * expose at least `productId` — the runner uses it to filter a subset.
     */
    products: ReadonlyArray<{ readonly productId: string }>;
    skipped: {
      noJsonLdBlock: number;
      noProductType: number;
      missingProductId: number;
      missingName: number;
    };
  };
  readonly buildStageSnapshot: (
    // deno-lint-ignore no-explicit-any
    input: any,
  ) => MinimalStageSnapshot;
}

/** Reconcile bundle: post-staging deduplication. */
export interface ReconcilePipelineFns {
  readonly reconcileSnapshot: (
    // deno-lint-ignore no-explicit-any
    snapshot: any,
  ) => MinimalReconciledSnapshot;
}

/**
 * Discriminated union encoding the invariant **`stage` requires `download`**.
 *
 * - Variant A — `{ reconcile? }` alone: the source only uses the generic
 *   runners for deduplication. `download` and `stage` are forbidden.
 * - Variant B — `{ download, stage?, reconcile? }`: `download` required, the
 *   rest opt-in.
 *
 * `{ stage }` without `download` is rejected at compile time: staging rebuilds
 * the canonical URLs from `download.siteUrl` and `productUrlForSlug`. Without
 * that URL configuration the design is invalid — better to hear it from the
 * compiler than from a run.
 *
 * Function **outputs** are strictly typed. **Inputs** stay `any` so that each
 * source can declare its own properly typed functions without a variance fight
 * over parameters.
 */
export type SourcePipelineFns =
  | {
    readonly download?: undefined;
    readonly stage?: undefined;
    readonly reconcile?: ReconcilePipelineFns;
  }
  | {
    readonly download: DownloadPipelineFns;
    readonly stage?: StagePipelineFns;
    readonly reconcile?: ReconcilePipelineFns;
  };

/**
 * Strategy for discovering a source's full catalog.
 *
 * `productUrlRegex` is required here, unlike the same-named optional field on
 * `SourceModule`: the dependency "discovering requires knowing how to filter
 * sitemap entries" is encoded at compile time. The two fields have distinct
 * semantics; a source that does both duplicates them explicitly.
 */
export type CatalogDiscoverySource = {
  readonly kind: "sitemap";
  /** URL of a `sitemap.xml` or `sitemapindex.xml` (bounded recursion). */
  readonly url: string;
  /** Captures the product slug from a sitemap entry. */
  readonly productUrlRegex: RegExp;
  /**
   * Patterns applied to the decoded slug to drop out-of-scope products before
   * any fetch. Saves OCR quota and model calls on pages that would be thrown
   * away afterwards. Optional: absent = no filter.
   */
  readonly excludedSlugPatterns?: readonly RegExp[];
};

/**
 * Statistics from an image discovery usefulness analyzer. Declared here to
 * avoid an import cycle with the image discovery module, which consumes the
 * source registry.
 */
export interface ImageDiscoveryUsefulnessStats<TRole extends string> {
  imageUrlsTotal: number;
  imageUrlsClassifiedUseful: number;
  roles: Record<TRole, number>;
}
