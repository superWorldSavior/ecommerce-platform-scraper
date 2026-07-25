/**
 * Discovery of the products to scrape for a source, at a given snapshot.
 *
 * The kernel does not know **where** the candidate list lives: a database, a
 * JSON file, an HTTP call, a hard-coded array. It consumes a `CandidateSource`
 * and takes care of the one invariant that matters — validation that *fails
 * loudly*.
 *
 * Failing loudly is the intended behavior: an empty list almost always means a
 * synchronization step was skipped upstream. Silently scraping zero URLs costs
 * a full run before anyone notices.
 *
 * ```ts
 * const source = inMemoryCandidateSource([
 *   { productId: "sku-1", productUrl: "https://example.test/products/sku-1" },
 * ]);
 * const products = await loadCandidateProducts(source, {
 *   sourceSlug: "example",
 *   quarter: "2026-Q3",
 * });
 * ```
 */

/** Validated candidate product, ready to be fetched. */
export interface CandidateProduct {
  url: string;
  productId: string;
}

/** Coordinates of a candidate query: which source, which snapshot. */
export interface CandidateQuery {
  sourceSlug: string;
  quarter: string;
}

/**
 * Raw row returned by a `CandidateSource`, before validation.
 *
 * `TMeta` carries the metadata specific to the consumer's domain (catalog
 * identifier, localized name, category…). The kernel never reads it: it
 * carries it through to the caller untouched.
 */
export interface CandidateRecord<TMeta = Record<string, unknown>> {
  productUrl: string | null;
  productId: string | null;
  meta?: TMeta;
}

/**
 * A source of candidates. One method only, and it is up to the implementation
 * to return rows already ordered by decreasing priority — the kernel keeps the
 * order it receives and never reorders.
 */
export interface CandidateSource<TMeta = Record<string, unknown>> {
  list(query: CandidateQuery): Promise<readonly CandidateRecord<TMeta>[]>;
}

/**
 * Thrown when a source returns no candidate at all. Typed so that callers who
 * tolerate the absence can filter on `instanceof` rather than string-matching
 * the message.
 */
export class CandidatesNotFoundError extends Error {
  readonly query: CandidateQuery;

  constructor(query: CandidateQuery) {
    super(
      `No candidate products for sourceSlug='${query.sourceSlug}' quarter='${query.quarter}'.`,
    );
    this.name = "CandidatesNotFoundError";
    this.query = query;
  }
}

/** Thrown when a row is present but unusable. */
export class InvalidCandidateError extends Error {
  readonly index: number;
  readonly field: "productUrl" | "productId";

  constructor(
    query: CandidateQuery,
    index: number,
    field: "productUrl" | "productId",
  ) {
    super(
      `Candidate row ${index} (sourceSlug='${query.sourceSlug}', quarter='${query.quarter}'): missing ${field}`,
    );
    this.name = "InvalidCandidateError";
    this.index = index;
    this.field = field;
  }
}

function assertUsable<TMeta>(
  rows: readonly CandidateRecord<TMeta>[],
  query: CandidateQuery,
): readonly CandidateRecord<TMeta>[] {
  if (rows.length === 0) throw new CandidatesNotFoundError(query);

  rows.forEach((row, index) => {
    if (typeof row.productUrl !== "string" || row.productUrl.length === 0) {
      throw new InvalidCandidateError(query, index, "productUrl");
    }
    if (typeof row.productId !== "string" || row.productId.length === 0) {
      throw new InvalidCandidateError(query, index, "productId");
    }
  });

  return rows;
}

/** Loads the validated candidates, without metadata. */
export async function loadCandidateProducts(
  source: CandidateSource,
  query: CandidateQuery,
): Promise<CandidateProduct[]> {
  const rows = await source.list(query);

  return assertUsable(rows, query).map((row) => ({
    url: row.productUrl as string,
    productId: row.productId as string,
  }));
}

/** Loads the validated candidates, keeping the domain metadata. */
export async function loadCandidateProductsWithMeta<TMeta>(
  source: CandidateSource<TMeta>,
  query: CandidateQuery,
): Promise<Array<CandidateProduct & { meta: TMeta | undefined }>> {
  const rows = await source.list(query);

  return assertUsable(rows, query).map((row) => ({
    url: row.productUrl as string,
    productId: row.productId as string,
    meta: row.meta,
  }));
}

/**
 * In-memory source, for tests and for getting started. Ignores `query`: it
 * always returns the rows supplied at construction time.
 */
export function inMemoryCandidateSource<TMeta = Record<string, unknown>>(
  rows: readonly CandidateRecord<TMeta>[],
): CandidateSource<TMeta> {
  return { list: () => Promise.resolve(rows) };
}
