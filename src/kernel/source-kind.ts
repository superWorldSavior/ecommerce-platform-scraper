/**
 * Identity and extraction method of a scraped source.
 *
 * `SourceKind` is **open**: it is an alias for `string`, not a closed union.
 * Every consumer decides on its own source vocabulary and can close it locally
 * if it wants compile-time exhaustiveness:
 *
 * ```ts
 * const MY_SOURCES = ["acme-store", "globex-store"] as const;
 * type MySource = typeof MY_SOURCES[number];   // closed union, caller-side
 * type MyStageSource = StageSource<MySource>;
 * ```
 *
 * That choice is deliberate. A closed union inside the package would force
 * publishing the list of scraped sites — information private to the consumer —
 * and would require a release for every source added.
 */
export type SourceKind = string;

/**
 * A source's extraction strategy, independent of the site.
 *
 * Values prefixed with an engine name (`shopline-*`, `cyberbiz-*`) assume that
 * engine's conventions, described under `platforms/`. The others describe the
 * shape of the storefront without assuming a platform:
 *
 *  - `sitemap-jsonld` — sitemap.xml and one `Product` JSON-LD block per page.
 *  - `sitemap-jsonld-llm` — the same, topped up by an LLM pass when the JSON-LD
 *    is incomplete.
 *  - `jsonld-product-php` — JSON-LD present, product URLs in the querystring.
 *  - `html-direct` — no usable JSON-LD, direct HTML parsing.
 */
export type SourceMethod =
  | "jsonld-product-php"
  | "html-direct"
  | "cyberbiz-jsonld-llm"
  | "shopline-jsonld-llm"
  | "sitemap-jsonld-llm"
  | "sitemap-jsonld";

/** Provenance of a scraped snapshot, consumed by the staging steps. */
export interface StageSource<TKind extends SourceKind = SourceKind> {
  kind: TKind;
  method?: SourceMethod;
  snapshotQuarter: string;
  fetchedAt: string;
  url: string;
}
