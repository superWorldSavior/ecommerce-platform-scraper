/**
 * Catalog discovery via sitemap.xml — a source-agnostic primitive.
 *
 * Fetches a sitemap (either urlset OR sitemapindex), follows sitemap-index
 * entries recursively with the depth capped at 2 (one index level and its
 * sub-sitemaps), and returns the product URLs matching the module's
 * `productUrlRegex`. This is the capability consumed by
 * `SourceModule.catalogDiscovery`, and it reuses the sitemap primitives.
 *
 * Network politeness: by default requests go through `PoliteFetcher`
 * (identified UA, 30 s timeout, 2 s throttle per host) — a module-level
 * singleton, so the rate limit still applies when `Promise.all` fires off
 * several sub-sitemaps in parallel. Tests can pass `opts.fetcher` to bypass it.
 */

import { PoliteFetcher } from "./http/fetch.ts";
import { splitSitemap } from "./sitemap.ts";

const MAX_DEPTH = 2;

export interface CatalogProductCandidate {
  /** Canonical product page URL, exactly as it appears in the sitemap. */
  url: string;
  /** ASCII slug captured by productUrlRegex.exec(url)[1]. URI-decoded. */
  productId: string;
}

export type SitemapFetcher = (url: string) => Promise<string>;

const sharedPoliteFetcher = new PoliteFetcher();
const defaultFetcher: SitemapFetcher = (url) =>
  sharedPoliteFetcher.fetchText(url);

/**
 * Fetches then parses a sitemap to produce the list of product URLs.
 *
 * @throws if the recursion goes deeper than MAX_DEPTH, or if an HTTP request
 * fails. URLs that do not match productUrlRegex are silently ignored
 * (category pages, blog, about, etc.).
 */
export function fetchCatalogFromSitemap(opts: {
  rootUrl: string;
  productUrlRegex: RegExp;
  fetcher?: SitemapFetcher;
}): Promise<CatalogProductCandidate[]> {
  const fetcher = opts.fetcher ?? defaultFetcher;
  const seen = new Set<string>();
  return collectFromSitemap(
    opts.rootUrl,
    opts.productUrlRegex,
    fetcher,
    0,
    seen,
  );
}

async function collectFromSitemap(
  url: string,
  productUrlRegex: RegExp,
  fetcher: SitemapFetcher,
  depth: number,
  seen: Set<string>,
): Promise<CatalogProductCandidate[]> {
  if (depth > MAX_DEPTH) {
    throw new Error(
      `Sitemap recursion exceeded ${MAX_DEPTH} levels at ${url}`,
    );
  }
  if (seen.has(url)) return [];
  seen.add(url);

  const xml = await fetcher(url);
  const { urls, childSitemaps } = splitSitemap(xml);

  if (childSitemaps.length > 0) {
    const sub = await Promise.all(
      childSitemaps.map((loc) =>
        collectFromSitemap(loc, productUrlRegex, fetcher, depth + 1, seen)
      ),
    );
    return dedupeByUrl(sub.flat());
  }

  return dedupeByUrl(toProductCandidates(urls, productUrlRegex));
}

function toProductCandidates(
  urls: readonly string[],
  productUrlRegex: RegExp,
): CatalogProductCandidate[] {
  const out: CatalogProductCandidate[] = [];
  for (const url of urls) {
    const match = productUrlRegex.exec(url);
    if (match?.[1]) {
      out.push({ url, productId: decodeURIComponent(match[1]) });
    }
  }
  return out;
}

function dedupeByUrl(
  items: readonly CatalogProductCandidate[],
): CatalogProductCandidate[] {
  const seen = new Set<string>();
  const out: CatalogProductCandidate[] = [];
  for (const item of items) {
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push(item);
  }
  return out;
}

/**
 * Drops the entries whose `productId` matches at least one denylist pattern —
 * typically cosmetics or skincare, when a site sells more than supplements
 * under the same `/products/` path. No-op when the denylist is empty or
 * missing.
 */
export function filterCatalogEntriesByDenylist(
  entries: readonly CatalogProductCandidate[],
  patterns: readonly RegExp[] | undefined,
): CatalogProductCandidate[] {
  if (!patterns?.length) return [...entries];
  return entries.filter((e) => !isDenylistedProductId(e.productId, patterns));
}

export function isDenylistedProductId(
  productId: string,
  patterns: readonly RegExp[] | undefined,
): boolean {
  if (!patterns?.length) return false;
  return patterns.some((pattern) => pattern.test(productId));
}
