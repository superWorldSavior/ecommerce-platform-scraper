/**
 * Identité et méthode d'extraction d'une source scrapée.
 *
 * `SourceKind` est **ouvert** : c'est un alias de `string`, pas une union
 * fermée. Chaque consommateur décide de son propre vocabulaire de sources et
 * peut le refermer chez lui s'il veut l'exhaustivité au compile-time :
 *
 * ```ts
 * const MY_SOURCES = ["acme-store", "globex-store"] as const;
 * type MySource = typeof MY_SOURCES[number];   // union fermée, côté appelant
 * type MyStageSource = StageSource<MySource>;
 * ```
 *
 * Ce choix est volontaire. Une union fermée dans le package obligerait à
 * publier la liste des sites scrapés — information privée du consommateur — et
 * imposerait une release à chaque ajout de source.
 */
export type SourceKind = string;

/**
 * Stratégie d'extraction d'une source, indépendante du site.
 *
 * Les valeurs préfixées par un moteur (`shopline-*`, `cyberbiz-*`) supposent les
 * conventions de ce moteur, décrites dans `platforms/`. Les autres décrivent la
 * forme du storefront sans hypothèse de plateforme :
 *
 *  - `sitemap-jsonld` — sitemap.xml + bloc JSON-LD `Product` par page.
 *  - `sitemap-jsonld-llm` — idem, complété par une passe LLM quand le JSON-LD
 *    est incomplet.
 *  - `jsonld-product-php` — JSON-LD présent, URLs produit en querystring.
 *  - `html-direct` — aucun JSON-LD exploitable, parsing HTML direct.
 */
export type SourceMethod =
  | "jsonld-product-php"
  | "html-direct"
  | "cyberbiz-jsonld-llm"
  | "shopline-jsonld-llm"
  | "sitemap-jsonld-llm"
  | "sitemap-jsonld";

/** Provenance d'un snapshot scrapé, consommée par les étapes de staging. */
export interface StageSource<TKind extends SourceKind = SourceKind> {
  kind: TKind;
  method?: SourceMethod;
  snapshotQuarter: string;
  fetchedAt: string;
  url: string;
}
