/**
 * Lecture du HTML brut stocké pour un produit.
 *
 * Le stockage suit une convention `<rawRoot>/<rawHost>/<quarter>/products/`, où
 * `quarter` est l'étiquette d'instantané : le même produit rescrapé plus tard
 * cohabite avec sa version précédente au lieu de l'écraser. C'est ce qui permet
 * de rejouer une extraction sur d'anciennes pages après correction d'un parser,
 * sans refetch.
 *
 * `rawRoot` et le constructeur de chemin sont paramétrables — la convention est
 * un défaut, pas une contrainte.
 */

/** Racine de stockage par défaut, relative au répertoire de travail. */
export const DEFAULT_RAW_ROOT = "data/raw";

export interface ProductHtmlSourceConfig {
  readonly rawHost: string;
  /** Racine de stockage. Défaut `DEFAULT_RAW_ROOT`. */
  readonly rawRoot?: string;
  /** Remplace entièrement le constructeur de chemin principal. */
  readonly htmlPathFor?: (productId: string, quarter: string) => string;
  /**
   * Emplacements secondaires à essayer si le principal est absent. Utile pour
   * les sites qui gardent une archive à côté du catalogue courant.
   */
  readonly htmlFallbackPathsFor?: (
    productId: string,
    quarter: string,
  ) => readonly string[];
}

export interface ResolvedProductHtml {
  readonly html: string;
  readonly path: string;
  /** Tous les chemins essayés, dans l'ordre. Utile au diagnostic. */
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

/** Chemins à essayer, dédupliqués, principal d'abord. */
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
 * Lit le premier HTML trouvé parmi les chemins candidats.
 *
 * Seuls les `NotFound` font passer au chemin suivant : une erreur de permission
 * ou de disque est remontée telle quelle, parce que la traiter comme une absence
 * transformerait un problème d'environnement en « produit introuvable ».
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
