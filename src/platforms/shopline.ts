import type {
  CatalogDiscoverySource,
  SourceModule,
} from "../kernel/source-module.ts";
import type { ImageCandidateSelector } from "../kernel/image-candidates.ts";
import { SHOPLINE_COMMERCE_PLATFORM } from "../kernel/commerce-platform.ts";
import {
  selectShoplineImageCandidates,
  SHOPLINE_DUAL_CDN_IMAGE_URL_HINT,
} from "../kernel/image-candidates.ts";

export interface ShoplinePlatformModule {
  readonly commercePlatform: typeof SHOPLINE_COMMERCE_PLATFORM;
  readonly imageUrlHint: RegExp;
  readonly imageCandidateSelector: ImageCandidateSelector;
  readonly catalogDiscoveryKind: CatalogDiscoverySource["kind"];
}

export const SHOPLINE_PLATFORM_MODULE = {
  commercePlatform: SHOPLINE_COMMERCE_PLATFORM,
  imageUrlHint: SHOPLINE_DUAL_CDN_IMAGE_URL_HINT,
  imageCandidateSelector: selectShoplineImageCandidates,
  catalogDiscoveryKind: "sitemap",
} as const satisfies ShoplinePlatformModule;

export interface ShoplineCatalogDiscoverySpec {
  readonly url?: string;
  readonly productUrlRegex?: RegExp;
  readonly excludedSlugPatterns?: readonly RegExp[];
}

export interface ShoplineSourceSpec extends
  Omit<
    SourceModule,
    | "catalogDiscovery"
    | "commercePlatform"
    | "imageCandidateSelector"
    | "imageUrlHint"
    | "productUrlRegex"
  > {
  readonly productUrlRegex: RegExp;
  readonly catalogDiscovery?: ShoplineCatalogDiscoverySpec | null;
  readonly imageCandidateSelector?: ImageCandidateSelector | null;
  readonly imageUrlHint?: RegExp;
}

export type DefinedShoplineSource<TSpec extends ShoplineSourceSpec> =
  & SourceModule
  & Omit<
    TSpec,
    "catalogDiscovery" | "imageCandidateSelector" | "imageUrlHint"
  >;

export function defineShoplineSource<const TSpec extends ShoplineSourceSpec>(
  spec: TSpec,
): DefinedShoplineSource<TSpec> {
  const {
    catalogDiscovery: _catalogDiscovery,
    imageCandidateSelector,
    imageUrlHint,
    ...source
  } = spec;

  const definedBrand = {
    ...source,
    commercePlatform: SHOPLINE_PLATFORM_MODULE.commercePlatform,
    imageUrlHint: imageUrlHint ?? SHOPLINE_PLATFORM_MODULE.imageUrlHint,
    imageCandidateSelector: imageCandidateSelector === undefined
      ? SHOPLINE_PLATFORM_MODULE.imageCandidateSelector
      : imageCandidateSelector,
    catalogDiscovery: shoplineCatalogDiscoveryFor(spec),
  } satisfies SourceModule;

  return definedBrand as DefinedShoplineSource<TSpec>;
}

function shoplineCatalogDiscoveryFor(
  spec: ShoplineSourceSpec,
): CatalogDiscoverySource | null {
  if (spec.catalogDiscovery === null) return null;

  const discovery = spec.catalogDiscovery ?? {};
  const catalogDiscovery: CatalogDiscoverySource = {
    kind: SHOPLINE_PLATFORM_MODULE.catalogDiscoveryKind,
    url: discovery.url ?? defaultShoplineSitemapUrl(spec),
    productUrlRegex: discovery.productUrlRegex ?? spec.productUrlRegex,
  };

  if (discovery.excludedSlugPatterns === undefined) {
    return catalogDiscovery;
  }

  return {
    ...catalogDiscovery,
    excludedSlugPatterns: discovery.excludedSlugPatterns,
  };
}

function defaultShoplineSitemapUrl(spec: ShoplineSourceSpec): string {
  const siteUrl = spec.pipelineFns?.download?.siteUrl ??
    `https://${spec.rawHost}`;
  return `${siteUrl.replace(/\/+$/u, "")}/sitemap.xml`;
}
