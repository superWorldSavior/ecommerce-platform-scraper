/**
 * BV SHOP platform adapter.
 *
 * Products live at `/item/<slug>`, and assets under
 * `image.bvshop.tw/<storeId>/…` — note the store id in the path, which is why
 * this engine's image hint and selector are built per store rather than being
 * shared constants.
 *
 * ## The `item/query` companion endpoint
 *
 * The interesting part of this engine: alongside the HTML page at
 * `/item/<slug>` there is a JSON endpoint at `/item/query/<slug>` returning the
 * same product as structured data — description, photos, Q&A, style. Reading it
 * is far more reliable than parsing the rendered page, so the flow is:
 *
 *  1. `resolveBvShopItemQueryUrlForProductUrl(productUrl)` derives the JSON URL.
 *  2. Fetch the HTML page first, keep its cookies
 *     (`bvShopCookieHeaderFromSetCookies`), then fetch the JSON with them — the
 *     endpoint expects the session the page established.
 *  3. `buildBvShopItemQueryArtifactJson()` narrows the payload to the fields
 *     worth storing, and returns `null` when it holds nothing useful.
 *
 * The JSON is stored in the saved HTML inside a `<script>` tag marked with
 * `BVSHOP_ITEM_QUERY_SCRIPT_ATTR`, so a single HTML artifact carries both the
 * page and its structured companion. `extractBvShopItemQueryArtifactJson()`
 * reads it back.
 */

import type {
  CatalogDiscoverySource,
  SourceModule,
} from "../kernel/source-module.ts";
import type { ImageCandidateSelector } from "../kernel/image-candidates.ts";
import { BVSHOP_COMMERCE_PLATFORM } from "../kernel/commerce-platform.ts";
import {
  bvShopImageUrlHint,
  createBvShopImageCandidateSelector,
} from "../kernel/image-candidates.ts";

export interface BvShopPlatformModule {
  readonly commercePlatform: typeof BVSHOP_COMMERCE_PLATFORM;
  readonly catalogDiscoveryKind: CatalogDiscoverySource["kind"];
}

export const BVSHOP_PLATFORM_MODULE = {
  commercePlatform: BVSHOP_COMMERCE_PLATFORM,
  catalogDiscoveryKind: "sitemap",
} as const satisfies BvShopPlatformModule;

export const BVSHOP_ITEM_QUERY_SCRIPT_ATTR = "data-scraper-bvshop-item-query";

const BVSHOP_ITEM_QUERY_SCRIPT_RE =
  /<script\b(?=[^>]*\bdata-scraper-bvshop-item-query\b)[^>]*>([\s\S]*?)<\/script>/giu;

export type BvShopItemQueryUrlErrorCode =
  | "INVALID_PRODUCT_URL"
  | "NOT_BVSHOP_ITEM_URL";

export type BvShopItemQueryUrlResolution =
  | {
    readonly ok: true;
    readonly slug: string;
    readonly url: string;
  }
  | {
    readonly ok: false;
    readonly code: BvShopItemQueryUrlErrorCode;
  };

export interface BvShopCatalogDiscoverySpec {
  readonly url?: string;
  readonly productUrlRegex?: RegExp;
  readonly excludedSlugPatterns?: readonly RegExp[];
}

export interface BvShopSourceSpec extends
  Omit<
    SourceModule,
    | "catalogDiscovery"
    | "commercePlatform"
    | "imageCandidateSelector"
    | "imageUrlHint"
    | "productUrlRegex"
  > {
  readonly storeId: string;
  readonly productUrlRegex: RegExp;
  readonly catalogDiscovery?: BvShopCatalogDiscoverySpec | null;
  readonly imageCandidateSelector?: ImageCandidateSelector | null;
  readonly imageUrlHint?: RegExp;
}

export function defineBvShopSource(
  spec: BvShopSourceSpec,
): SourceModule {
  const {
    catalogDiscovery: _catalogDiscovery,
    imageCandidateSelector,
    imageUrlHint,
    storeId,
    ...source
  } = spec;

  return {
    ...source,
    commercePlatform: BVSHOP_PLATFORM_MODULE.commercePlatform,
    imageUrlHint: imageUrlHint ?? bvShopImageUrlHint(storeId),
    imageCandidateSelector: imageCandidateSelector === undefined
      ? createBvShopImageCandidateSelector({ storeId })
      : imageCandidateSelector,
    catalogDiscovery: bvShopCatalogDiscoveryFor(spec),
  } satisfies SourceModule;
}

function bvShopCatalogDiscoveryFor(
  spec: BvShopSourceSpec,
): CatalogDiscoverySource | null {
  if (spec.catalogDiscovery === null) return null;

  const discovery = spec.catalogDiscovery ?? {};
  const catalogDiscovery: CatalogDiscoverySource = {
    kind: BVSHOP_PLATFORM_MODULE.catalogDiscoveryKind,
    url: discovery.url ?? defaultBvShopSitemapUrl(spec),
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

function defaultBvShopSitemapUrl(spec: BvShopSourceSpec): string {
  const siteUrl = spec.pipelineFns?.download?.siteUrl ??
    `https://${spec.rawHost}`;
  return `${siteUrl.replace(/\/+$/u, "")}/sitemap.xml`;
}

export function bvShopItemQueryUrlForProductUrl(
  productUrl: string,
): string | null {
  const resolution = resolveBvShopItemQueryUrlForProductUrl(productUrl);
  return resolution.ok ? resolution.url : null;
}

export function resolveBvShopItemQueryUrlForProductUrl(
  productUrl: string,
): BvShopItemQueryUrlResolution {
  let url: URL;
  try {
    url = new URL(productUrl);
  } catch {
    return { ok: false, code: "INVALID_PRODUCT_URL" };
  }

  const slug = extractBvShopItemSlugFromParsedUrl(url);
  if (slug === null) return { ok: false, code: "NOT_BVSHOP_ITEM_URL" };

  return {
    ok: true,
    slug,
    url: new URL(`/item/query/${slug}`, url.origin).href,
  };
}

export function extractBvShopItemSlugFromUrl(
  productUrl: string,
): string | null {
  try {
    return extractBvShopItemSlugFromParsedUrl(new URL(productUrl));
  } catch {
    return null;
  }
}

function extractBvShopItemSlugFromParsedUrl(url: URL): string | null {
  const pathParts = url.pathname.split("/").filter(Boolean);
  if (pathParts.length !== 2 || pathParts[0] !== "item") return null;

  const slugSegment = pathParts[1];
  return slugSegment.length > 0 ? slugSegment : null;
}

export function bvShopCookieHeaderFromSetCookies(
  setCookies: readonly string[],
): string | null {
  const pairs = setCookies
    .map((cookie) => cookie.split(";")[0]?.trim() ?? "")
    .filter((cookie) => /^[^=]+=.+/u.test(cookie));

  if (pairs.length === 0) return null;
  return pairs.join("; ");
}

export function buildBvShopItemQueryArtifactJson(
  queryUrl: string,
  payloadText: string,
): string | null {
  const payload = parseJsonRecord(payloadText);
  if (payload === null) return null;

  const response = recordValue(payload, "response");
  const prod = recordValue(response, "prod");
  if (prod === null) return null;

  const style = recordValue(response, "style");
  const artifact = {
    source: "bvshop:item-query",
    queryUrl,
    prod: {
      id: prod.id,
      name: stringValue(prod.name),
      description: stringValue(prod.description),
      photos: arrayValue(prod.photos),
      q_and_a: arrayValue(prod.q_and_a),
    },
    style: style === null ? null : {
      style: stringValue(style.style),
    },
  };

  if (
    artifact.prod.description === null &&
    artifact.prod.photos.length === 0 &&
    artifact.prod.q_and_a.length === 0 &&
    (artifact.style === null || artifact.style.style === null)
  ) {
    return null;
  }

  return JSON.stringify(artifact);
}

export function appendBvShopItemQueryArtifact(
  html: string,
  artifactJson: string,
): string {
  return `${html}\n<script type="application/json" ${BVSHOP_ITEM_QUERY_SCRIPT_ATTR}>${
    escapeScriptJson(artifactJson)
  }</script>\n`;
}

export function hasUsableBvShopItemQueryArtifact(html: string): boolean {
  for (const match of html.matchAll(BVSHOP_ITEM_QUERY_SCRIPT_RE)) {
    const scriptJson = match[1]?.trim() ?? "";
    const artifact = parseJsonRecord(scriptJson);
    if (artifact !== null && isUsableBvShopItemQueryArtifact(artifact)) {
      return true;
    }
  }
  return false;
}

function isUsableBvShopItemQueryArtifact(
  artifact: Record<string, unknown>,
): boolean {
  if (artifact.source !== "bvshop:item-query") return false;

  const prod = recordValue(artifact, "prod");
  const style = recordValue(artifact, "style");
  return stringValue(prod?.description) !== null ||
    arrayValue(prod?.photos).length > 0 ||
    arrayValue(prod?.q_and_a).length > 0 ||
    stringValue(style?.style) !== null;
}

function parseJsonRecord(text: string): Record<string, unknown> | null {
  try {
    const value = JSON.parse(text) as unknown;
    return asRecord(value);
  } catch {
    return null;
  }
}

function recordValue(
  record: Record<string, unknown> | null,
  key: string,
): Record<string, unknown> | null {
  if (record === null) return null;
  return asRecord(record[key]);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function arrayValue(value: unknown): readonly unknown[] {
  return Array.isArray(value) ? value : [];
}

function escapeScriptJson(json: string): string {
  return json.replace(/<\/script/giu, "<\\/script");
}
