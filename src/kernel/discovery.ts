/**
 * Découverte des produits à scraper pour une source, à un instantané donné.
 *
 * Le kernel ne sait pas **où** vit la liste de candidats : base de données,
 * fichier JSON, appel HTTP, tableau en dur. Il consomme une `CandidateSource`
 * et se charge du seul invariant qui compte — la validation *fail loud*.
 *
 * `fail loud` est le comportement voulu : une liste vide signifie presque
 * toujours une étape de synchronisation oubliée en amont. Scraper zéro URL en
 * silence coûte une exécution complète avant qu'on s'en aperçoive.
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

/** Produit candidat validé, prêt à être fetché. */
export interface CandidateProduct {
  url: string;
  productId: string;
}

/** Coordonnées d'une requête de candidats : quelle source, quel instantané. */
export interface CandidateQuery {
  sourceSlug: string;
  quarter: string;
}

/**
 * Ligne brute retournée par une `CandidateSource`, avant validation.
 *
 * `TMeta` porte les métadonnées propres au domaine du consommateur (identifiant
 * de catalogue, nom localisé, catégorie…). Le kernel ne les lit jamais : il les
 * transporte tel quel jusqu'à l'appelant.
 */
export interface CandidateRecord<TMeta = Record<string, unknown>> {
  productUrl: string | null;
  productId: string | null;
  meta?: TMeta;
}

/**
 * Source de candidats. Une seule méthode, à charge de l'implémentation de
 * retourner les lignes déjà ordonnées par priorité décroissante — le kernel
 * préserve l'ordre reçu et ne réordonne pas.
 */
export interface CandidateSource<TMeta = Record<string, unknown>> {
  list(query: CandidateQuery): Promise<readonly CandidateRecord<TMeta>[]>;
}

/**
 * Levée quand une source ne retourne aucun candidat. Typée pour que les
 * appelants qui tolèrent l'absence filtrent par `instanceof` plutôt que par
 * correspondance de chaîne sur le message.
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

/** Levée quand une ligne est présente mais inexploitable. */
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

/** Charge les candidats validés, sans métadonnées. */
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

/** Charge les candidats validés en conservant les métadonnées du domaine. */
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
 * Source en mémoire, pour les tests et le démarrage. Ignore `query` : elle
 * retourne toujours les lignes fournies à la construction.
 */
export function inMemoryCandidateSource<TMeta = Record<string, unknown>>(
  rows: readonly CandidateRecord<TMeta>[],
): CandidateSource<TMeta> {
  return { list: () => Promise.resolve(rows) };
}
