/**
 * Extract `<loc>` URLs from a `sitemap.xml` payload.
 *
 * Tolérant : ne valide pas le schéma sitemap.org (pas de vérification du
 * namespace, pas de parsing `<lastmod>`), juste un match regex global
 * sur `<loc>...</loc>`. Suffisant pour les sitemaps observés (
 * Shopline) et robuste face aux wrappers XML variés.
 *
 * Gère les sitemapindex emboîtés : `collectIndexChildren(xml)` retourne
 * les URLs de sitemaps enfants qu'il faudra fetcher séparément.
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
