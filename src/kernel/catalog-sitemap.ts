/**
 * Catalog discovery via sitemap.xml — primitive agnostique de la source.
 *
 * Fetch un sitemap (urlset OU sitemapindex), suit récursivement les
 * sitemap-index avec une profondeur bornée à 2 (un niveau d'index +
 * sub-sitemaps), et retourne les URLs produits qui matchent
 * `productUrlRegex` du BrandModule. Capacité consommée par
 * `SourceModule.catalogDiscovery` et réutilise les primitives sitemap.
 *
 * Politesse réseau : par défaut on passe par `PoliteFetcher` (UA identifié,
 * timeout 30 s, throttle 2 s/host) — singleton module pour que le rate-limit
 * s'applique aussi quand `Promise.all` lance plusieurs sub-sitemaps en
 * parallèle. Tests : passer `opts.fetcher` pour bypass.
 */

import { PoliteFetcher } from "./http/fetch.ts";
import { splitSitemap } from "./sitemap.ts";

const MAX_DEPTH = 2;

export interface CatalogProductCandidate {
  /** URL canonique de la fiche produit (telle qu'elle apparaît dans le sitemap). */
  url: string;
  /** Slug ASCII extrait via productUrlRegex.exec(url)[1]. URI-decoded. */
  productId: string;
}

export type SitemapFetcher = (url: string) => Promise<string>;

const sharedPoliteFetcher = new PoliteFetcher();
const defaultFetcher: SitemapFetcher = (url) =>
  sharedPoliteFetcher.fetchText(url);

/**
 * Fetch puis parse un sitemap pour produire la liste des URLs produits.
 *
 * @throws si la profondeur de recursion depasse MAX_DEPTH, ou si une
 * requete HTTP echoue. Les URLs ne matchant pas productUrlRegex sont
 * silencieusement ignorees (pages categorie, blog, about, etc.).
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
 * Écarte les entrées dont le `productId` matche au moins un pattern de la
 * denylist (typiquement cosmétiques / skincare quand le site vend hors
 * compléments sous le même path `/products/`). No-op si la denylist est vide
 * ou absente.
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
