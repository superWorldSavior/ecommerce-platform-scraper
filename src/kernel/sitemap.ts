/**
 * Extract `<loc>` URLs from a `sitemap.xml` payload.
 *
 * Deliberately lenient: it does not validate the sitemap.org schema (no
 * namespace check, no `<lastmod>` parsing), just one global regex match on
 * `<loc>...</loc>`. Enough for the sitemaps seen in the wild (SHOPLINE among
 * them) and robust against the assorted XML wrappers around them.
 *
 * Nested sitemapindex documents are handled by `splitSitemap()`, which reports
 * child sitemap URLs separately from product URLs, leaving the caller to decide
 * how deep to recurse.
 */

export interface SitemapSplit {
  urls: string[];
  childSitemaps: string[];
}

const LOC_RE = /<loc>\s*([^<\s]+)\s*<\/loc>/g;

export function parseSitemapUrls(xml: string): string[] {
  const out: string[] = [];
  for (const match of xml.matchAll(LOC_RE)) {
    const value = match[1].trim();
    if (value) out.push(value);
  }
  return out;
}

export function splitSitemap(xml: string): SitemapSplit {
  const isIndex = /<sitemapindex[\s>]/.test(xml);
  const locs = parseSitemapUrls(xml);
  if (isIndex) {
    return { urls: [], childSitemaps: locs };
  }
  return { urls: locs, childSitemaps: [] };
}

export function filterByPrefix(urls: string[], prefix: string): string[] {
  return urls.filter((url) => url.startsWith(prefix));
}

export function excludeByPattern(urls: string[], pattern: RegExp): string[] {
  return urls.filter((url) => !pattern.test(url));
}
