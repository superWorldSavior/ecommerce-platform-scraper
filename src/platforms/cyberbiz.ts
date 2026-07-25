/**
 * CYBERBIZ platform adapter.
 *
 * CYBERBIZ storefronts share a recognisable shape: products at
 * `/products/<slug>`, a sitemap at the site root, and page bodies built from
 * rich-text editor blocks. That last part is what makes image selection hard —
 * the editor emits marketing imagery, responsive duplicates and endorsement
 * photos into the same block as the content you actually want.
 *
 * The helpers below classify an image by the markup *around* it rather than by
 * its URL, because on this engine the URL carries no signal: every image sits on
 * the same CDN path regardless of purpose.
 */

import {
  capImageCandidateSelection,
  type ImageCandidateDecision,
  type ImageCandidateSelection,
  imageCandidateUrlLookupVariants,
  normalizeImageCandidateHtml,
} from "../kernel/image-candidates.ts";
import type {
  CatalogDiscoverySource,
  SourceModule,
} from "../kernel/source-module.ts";
import { CYBERBIZ_COMMERCE_PLATFORM } from "../kernel/commerce-platform.ts";

/**
 * CYBERBIZ asset CDN.
 *
 * The optional subdomain suffix matters: some stores are served from a
 * regionalised host (`cdn-<region>.cybassets.com`) rather than the bare `cdn.`
 * one. A hint that only matched `cdn.` would silently attribute none of those
 * images to the source.
 */
export const CYBERBIZ_CDN_IMAGE_URL_HINT =
  /cdn(?:-[a-z0-9-]+)?\.cybassets\.com\/(?:media|s\/files)\//i;

/** Upper bound on images kept for a single page, before OCR. */
export const CYBERBIZ_DEFAULT_MAX_SELECTED_IMAGES = 16;

export interface CyberbizPlatformModule {
  readonly commercePlatform: typeof CYBERBIZ_COMMERCE_PLATFORM;
  readonly imageUrlHint: RegExp;
  readonly catalogDiscoveryKind: CatalogDiscoverySource["kind"];
}

export const CYBERBIZ_PLATFORM_MODULE = {
  commercePlatform: CYBERBIZ_COMMERCE_PLATFORM,
  imageUrlHint: CYBERBIZ_CDN_IMAGE_URL_HINT,
  catalogDiscoveryKind: "sitemap",
} as const satisfies CyberbizPlatformModule;

export interface CyberbizCatalogDiscoverySpec {
  readonly url?: string;
  readonly productUrlRegex?: RegExp;
  readonly excludedSlugPatterns?: readonly RegExp[];
}

/**
 * Declaration accepted by `defineCyberbizSource`.
 *
 * Note what is **not** defaulted: `imageCandidateSelector` stays required. The
 * engine gives no shared answer for it — stores differ in how much marketing
 * imagery they push into their editor blocks, so each source composes its own
 * selector from the helpers in this module. Supplying a default here would
 * paper over a real difference between storefronts, which is worse than asking
 * the caller to decide.
 */
export interface CyberbizSourceSpec extends
  Omit<
    SourceModule,
    | "catalogDiscovery"
    | "commercePlatform"
    | "imageUrlHint"
    | "productUrlRegex"
  > {
  readonly productUrlRegex: RegExp;
  readonly catalogDiscovery?: CyberbizCatalogDiscoverySpec | null;
  /** Override when a store is served from a non-standard asset host. */
  readonly imageUrlHint?: RegExp;
}

export type DefinedCyberbizSource<TSpec extends CyberbizSourceSpec> =
  & SourceModule
  & Omit<TSpec, "catalogDiscovery" | "imageUrlHint">;

/**
 * Composes CYBERBIZ engine defaults with a source's own declaration.
 * Overrides always win over defaults.
 *
 * ```ts
 * export const source = defineCyberbizSource({
 *   name: "example",
 *   rawHost: "www.example.test",
 *   productUrlRegex: /^https:\/\/www\.example\.test\/products\/([^/?#]+)/u,
 *   imageCandidateSelector: null,
 *   projectionProviders: { artifactContext: null, structuredFacts: null },
 *   pipelineFns: { download: { siteUrl: "https://www.example.test" } },
 * });
 * ```
 */
export function defineCyberbizSource<const TSpec extends CyberbizSourceSpec>(
  spec: TSpec,
): DefinedCyberbizSource<TSpec> {
  const {
    catalogDiscovery: _catalogDiscovery,
    imageUrlHint,
    ...source
  } = spec;

  const definedSource = {
    ...source,
    commercePlatform: CYBERBIZ_PLATFORM_MODULE.commercePlatform,
    imageUrlHint: imageUrlHint ?? CYBERBIZ_PLATFORM_MODULE.imageUrlHint,
    catalogDiscovery: cyberbizCatalogDiscoveryFor(spec),
  } satisfies SourceModule;

  return definedSource as DefinedCyberbizSource<TSpec>;
}

function cyberbizCatalogDiscoveryFor(
  spec: CyberbizSourceSpec,
): CatalogDiscoverySource | null {
  if (spec.catalogDiscovery === null) return null;

  const discovery = spec.catalogDiscovery ?? {};
  const catalogDiscovery: CatalogDiscoverySource = {
    kind: CYBERBIZ_PLATFORM_MODULE.catalogDiscoveryKind,
    url: discovery.url ?? defaultCyberbizSitemapUrl(spec),
    productUrlRegex: discovery.productUrlRegex ?? spec.productUrlRegex,
  };

  if (discovery.excludedSlugPatterns === undefined) return catalogDiscovery;

  return {
    ...catalogDiscovery,
    excludedSlugPatterns: discovery.excludedSlugPatterns,
  };
}

function defaultCyberbizSitemapUrl(spec: CyberbizSourceSpec): string {
  const siteUrl = spec.pipelineFns?.download?.siteUrl ??
    `https://${spec.rawHost}`;
  return `${siteUrl.replace(/\/+$/u, "")}/sitemap.xml`;
}

/**
 * Slices of markup surrounding every occurrence of an image URL.
 *
 * All URL spellings are tried (protocol-relative, escaped, encoded) because the
 * same asset appears in several forms across a single page. `radius` trades
 * precision for recall: too small and the classifying class attribute falls
 * outside the window, too large and an unrelated neighbouring block bleeds in.
 */
export function cyberbizImageContextWindows(
  normalizedHtml: string,
  url: string,
  radius = 900,
): string[] {
  const contexts: string[] = [];

  for (const variant of imageCandidateUrlLookupVariants(url)) {
    let start = 0;
    while (true) {
      const index = normalizedHtml.indexOf(variant, start);
      if (index < 0) break;
      contexts.push(
        normalizedHtml.slice(
          Math.max(0, index - radius),
          Math.min(normalizedHtml.length, index + variant.length + radius),
        ),
      );
      start = index + variant.length;
    }
  }

  return contexts;
}

/**
 * Classifies an image from its surrounding markup. Returns `null` when nothing
 * disqualifies it — absence of a verdict means "keep", so a new markup pattern
 * fails towards keeping the image rather than silently dropping content.
 */
export function decideCyberbizContentImageContext(
  context: string,
): ImageCandidateDecision | null {
  if (isCyberbizMobileDuplicateContext(context)) {
    return {
      keep: false,
      reason: "duplicate",
      note: "responsive mobile duplicate",
    };
  }
  if (isCyberbizDecorativeContext(context)) {
    return {
      keep: false,
      reason: "decorative_asset",
      note: "decorative content image",
    };
  }
  if (isCyberbizStoryContext(context)) {
    return {
      keep: false,
      reason: "brand_story_asset",
      note: "testimonial or storytelling image",
    };
  }
  return null;
}

/**
 * Same classification, driven from raw page HTML. Uses a tighter radius than
 * the default: with the whole document available, a wide window is more likely
 * to catch a neighbouring block's classes than the image's own.
 */
export function decideCyberbizContentImageByHtmlContext(
  html: string,
  url: string,
): ImageCandidateDecision | null {
  const normalizedHtml = normalizeImageCandidateHtml(html);

  for (const context of cyberbizImageContextWindows(normalizedHtml, url, 260)) {
    const decision = decideCyberbizContentImageContext(context);
    if (decision !== null) return decision;
  }

  return null;
}

/** Caps a selection, attributing the drops to the cap rather than to a rule. */
export function capCyberbizImageCandidateSelection(
  selection: ImageCandidateSelection,
  maxSelected = CYBERBIZ_DEFAULT_MAX_SELECTED_IMAGES,
): ImageCandidateSelection {
  return capImageCandidateSelection(selection, {
    maxSelected,
    reason: "brand_story_asset",
    note: `selected image cap ${maxSelected}`,
  });
}

/**
 * Responsive layouts on this engine ship the same image twice — once for
 * desktop, once for mobile — under a shared background class plus a viewport
 * marker. Both classes must be present: the background class alone also appears
 * on legitimate single-variant images.
 */
function isCyberbizMobileDuplicateContext(context: string): boolean {
  return /class=["'](?=[^"']*\buse_main_st_bg\b)(?=[^"']*\b(?:mo|mobile|tp)\b)[^"']*["']/iu
    .test(context);
}

/** Editor chrome: icons, section backgrounds, video posters, modal artwork. */
function isCyberbizDecorativeContext(context: string): boolean {
  return /class=["'][^"']*(?:\belement_img_icon\b|\bnew_pd_bg\b)/iu.test(
    context,
  ) ||
    /(?:<video\b[^>]*\bposter=|product_pop_in_top|product_pop)/iu.test(context);
}

/**
 * Endorsement and testimonial imagery. Matched by class, and by the CJK terms
 * these sections are labelled with — 代言 (endorsement), 見證 (testimony),
 * 心得 (experience report).
 */
function isCyberbizStoryContext(context: string): boolean {
  return /class=["'][^"']*(?:\bperson_img\b|\bendorser\b)/iu.test(context) ||
    /(?:代言|見證|心得|testimonial)/iu.test(context);
}
