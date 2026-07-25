/**
 * Reads the raw HTML stored for a product.
 *
 * Storage follows a `<rawRoot>/<rawHost>/<quarter>/products/` convention, where
 * `quarter` is the snapshot label: the same product rescraped later sits next
 * to its earlier version instead of overwriting it. That is what makes it
 * possible to replay an extraction over old pages after fixing a parser, with
 * no refetch.
 *
 * `rawRoot` and the path builder are both configurable — the convention is a
 * default, not a constraint.
 */

/** Default storage root, relative to the working directory. */
export const DEFAULT_RAW_ROOT = "data/raw";

export interface ProductHtmlSourceConfig {
  readonly rawHost: string;
  /** Storage root. Defaults to `DEFAULT_RAW_ROOT`. */
  readonly rawRoot?: string;
  /** Replaces the primary path builder outright. */
  readonly htmlPathFor?: (productId: string, quarter: string) => string;
  /**
   * Secondary locations to try when the primary one is missing. Useful for
   * sites that keep an archive next to the current catalog.
   */
  readonly htmlFallbackPathsFor?: (
    productId: string,
    quarter: string,
  ) => readonly string[];
}

export interface ResolvedProductHtml {
  readonly html: string;
  readonly path: string;
  /** Every path that was tried, in order. Useful when diagnosing. */
  readonly attemptedPaths: readonly string[];
}

export class ProductHtmlNotFoundError extends Error {
  readonly code = "PRODUCT_HTML_NOT_FOUND";

  constructor(
    message: string,
    readonly attemptedPaths: readonly string[],
  ) {
    super(message);
    this.name = "ProductHtmlNotFoundError";
  }
}

export function productHtmlPath(
  rawHost: string,
  productId: string,
  quarter: string,
  rawRoot: string = DEFAULT_RAW_ROOT,
): string {
  return `${rawRoot}/${rawHost}/${quarter}/products/${productId}.html`;
}

/** Paths to try, deduplicated, primary one first. */
export function productHtmlPaths(
  config: ProductHtmlSourceConfig,
  productId: string,
  quarter: string,
): string[] {
  const primaryPath = config.htmlPathFor?.(productId, quarter) ??
    productHtmlPath(config.rawHost, productId, quarter, config.rawRoot);

  return [
    ...new Set([
      primaryPath,
      ...(config.htmlFallbackPathsFor?.(productId, quarter) ?? []),
    ]),
  ];
}

/**
 * Reads the first HTML found among the candidate paths.
 *
 * Only a `NotFound` moves on to the next path: a permission or disk error is
 * rethrown as is, because treating it as an absence would turn an environment
 * problem into "product not found".
 */
export async function readProductHtml(
  config: ProductHtmlSourceConfig,
  productId: string,
  quarter: string,
  readTextFile: (path: string) => Promise<string> = Deno.readTextFile,
): Promise<ResolvedProductHtml> {
  const attemptedPaths = productHtmlPaths(config, productId, quarter);
  const errors: string[] = [];

  for (const path of attemptedPaths) {
    try {
      return { html: await readTextFile(path), path, attemptedPaths };
    } catch (err) {
      if (!(err instanceof Deno.errors.NotFound)) throw err;
      errors.push(`${path} (${err.message})`);
    }
  }

  throw new ProductHtmlNotFoundError(errors.join("; "), attemptedPaths);
}
