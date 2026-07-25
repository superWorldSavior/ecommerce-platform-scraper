/**
 * Contrat déclaratif d'une source scrapée.
 *
 * Chaque site expose une instance `SourceModule`. Un registry les agrège et les
 * phases du pipeline consomment les capacités déclarées ici. Le module est de la
 * **donnée**, pas du comportement : il décrit ce que le site sait faire, les
 * runners génériques décident quoi en faire.
 *
 * Avant d'écrire un adapter, regarder si le site tourne sur un moteur connu :
 * `platforms/shopline`, `platforms/cyberbiz`, `platforms/bvshop` composent les
 * defaults du moteur et ne laissent à déclarer que le spécifique du site.
 *
 * ## Deux paramètres de type
 *
 * - `TRole` — vocabulaire de rôles d'artefacts du domaine
 *   (cf `artifact-context.ts`). Défaut : les rôles e-commerce de base.
 * - `TFacts` — provider de faits structurés du domaine. Le kernel ne l'inspecte
 *   jamais ; il le transporte jusqu'à la couche qui sait le lire.
 *
 * ## Champs required nullable
 *
 * `imageCandidateSelector`, `catalogDiscovery` et les deux providers sont
 * **required mais nullable**. `null` signifie « absence assumée et auditée » ;
 * `undefined` est interdit. Ajouter un champ obligatoire ici fait donc échouer
 * la compilation sur toutes les sources qui l'omettent — inversion de contrôle
 * sans framework, et aucun oubli silencieux à l'ajout d'une source.
 */

import type {
  ArtifactContextProvider,
  BaseArtifactRole,
} from "./artifact-context.ts";
import type { ImageCandidateSelector } from "./image-candidates.ts";
import type { CommercePlatform } from "./commerce-platform.ts";
import type { PipelinePhase } from "./phases.ts";

/**
 * Capacités de projection déclarées par source. Les deux champs sont required
 * et nullable : `null` = absence assumée, provider présent = extraction
 * structurée. La couche appelante décide du repli sur `null` (typiquement une
 * passe modèle).
 */
export interface ProjectionProviders<
  TRole extends string = BaseArtifactRole,
  TFacts = unknown,
> {
  readonly artifactContext: ArtifactContextProvider<TRole> | null;
  readonly structuredFacts: TFacts | null;
}

export interface SourceModule<
  TRole extends string = BaseArtifactRole,
  TFacts = unknown,
> {
  /** Identifiant lowercase ASCII, utilisé comme clé dans tout le pipeline. */
  readonly name: string;

  /**
   * Hôte du site, tel qu'il apparaît dans l'arborescence de stockage brut :
   * `<rawRoot>/<rawHost>/<quarter>/products/*.html`.
   */
  readonly rawHost: string;

  /** Moteur de boutique du site. `custom` si aucun moteur commun. */
  readonly commercePlatform: CommercePlatform;

  /**
   * Motif d'URL du CDN d'images du site. Sert à attribuer les images trouvées
   * dans un HTML à la bonne source — deux sites peuvent citer les images l'un
   * de l'autre.
   */
  readonly imageUrlHint: RegExp;

  /**
   * Capture du slug produit depuis l'URL canonique. Optionnel : une source sans
   * ce champ ne supporte pas le filtrage automatique des URLs découvertes.
   */
  readonly productUrlRegex?: RegExp;

  /** Phases supportées. Optionnel : défaut à toutes (`PIPELINE_PHASES`). */
  readonly phases?: readonly PipelinePhase[];

  readonly projectionProviders: ProjectionProviders<TRole, TFacts>;

  /**
   * Télémétrie read-only de la découverte d'images : compte les URLs classées
   * par rôle pour mesurer la qualité du filtrage. N'influence pas le pipeline —
   * pour le filtre actif, voir `imageCandidateSelector`. Optionnel.
   */
  readonly imageDiscoveryUsefulnessAnalyzer?: (
    html: string,
    imageUrls: readonly string[],
  ) => ImageDiscoveryUsefulnessStats<TRole>;

  /**
   * Sélection des images candidates avant l'OCR. Required, nullable : `null` =
   * aucune sélection, toutes les candidates sont conservées. Required pour
   * forcer chaque source à se prononcer — les sites d'un même moteur ont
   * vocation à partager le même selector.
   */
  readonly imageCandidateSelector: ImageCandidateSelector | null;

  /**
   * Emplacements HTML secondaires à essayer si le principal est absent. Utile
   * pour les sites qui gardent une archive en plus du catalogue courant.
   * Optionnel.
   */
  readonly htmlFallbackPathsFor?: (
    productId: string,
    quarter: string,
  ) => readonly string[];

  /**
   * Fonctions de pipeline propres à la source, exposées aux runners génériques.
   * Une source opte pour un runner en exposant le bundle correspondant ; sans
   * le bundle requis, le runner échoue explicitement au lieu de deviner.
   */
  readonly pipelineFns?: SourcePipelineFns;

  /**
   * Découverte du catalogue complet, au-delà d'une liste de candidats fournie.
   * Required, nullable : `null` = la source n'expose pas de catalogue
   * énumérable.
   */
  readonly catalogDiscovery: CatalogDiscoverySource | null;
}

export interface MinimalStageSnapshot {
  parsedProducts: number;
  totalPages: number;
  gateSummary: Record<string, number>;
}

export interface MinimalReconciledSnapshot {
  reconcileSummary: {
    canonicalRecords: number;
    mergedAwayRecords: number;
    duplicateGroups: number;
  };
}

/**
 * Bundle download : configure la récupération des HTML vers le stockage brut.
 * Une source qui l'expose accepte le runner de download générique ; les autres
 * gardent leur propre chemin de récupération (proxy résidentiel, navigateur
 * piloté, réseau géo-restreint…).
 */
export interface DownloadPipelineFns {
  /** URL de base du site. Required : sert de racine aux URLs canoniques. */
  readonly siteUrl: string;
  /**
   * Construit l'URL canonique depuis un slug. Optionnel : défaut
   * `${siteUrl}/products/${slug}`. Le builder doit encoder le slug lui-même.
   */
  readonly productUrlForSlug?: (slug: string) => string;
  /**
   * Slugs de découverte additionnels, chargés en best-effort. Cas d'usage :
   * plusieurs enseignes servies par un même domaine.
   */
  readonly additionalDiscoverySlugs?: readonly string[];
}

/**
 * Bundle stage : `parsePages` et `buildStageSnapshot` sont required **ensemble**.
 * Une source ne peut exposer l'un sans l'autre — sinon un bundle présent mais
 * incomplet compilerait pour échouer au runtime.
 */
export interface StagePipelineFns {
  readonly parsePages: (
    pages: ReadonlyArray<{ url: string; html: string }>,
  ) => {
    /**
     * Produits parsés. La forme exacte varie par source, mais toutes exposent
     * au moins `productId` — le runner s'en sert pour filtrer un sous-ensemble.
     */
    products: ReadonlyArray<{ readonly productId: string }>;
    skipped: {
      noJsonLdBlock: number;
      noProductType: number;
      missingProductId: number;
      missingName: number;
    };
  };
  readonly buildStageSnapshot: (
    // deno-lint-ignore no-explicit-any
    input: any,
  ) => MinimalStageSnapshot;
}

/** Bundle reconcile : déduplication post-staging. */
export interface ReconcilePipelineFns {
  readonly reconcileSnapshot: (
    // deno-lint-ignore no-explicit-any
    snapshot: any,
  ) => MinimalReconciledSnapshot;
}

/**
 * Union discriminée encodant l'invariant **`stage` exige `download`**.
 *
 * - Variante A — `{ reconcile? }` seul : la source n'utilise les runners
 *   génériques que pour la déduplication. `download` et `stage` interdits.
 * - Variante B — `{ download, stage?, reconcile? }` : `download` required,
 *   le reste opt-in.
 *
 * `{ stage }` sans `download` est rejeté à la compilation : le staging
 * reconstruit les URLs canoniques depuis `download.siteUrl` +
 * `productUrlForSlug`. Sans la configuration d'URL, le design est invalide —
 * autant l'apprendre du compilateur que d'une exécution.
 *
 * Les **sorties** des fonctions sont typées strictement. Les **entrées**
 * restent `any` pour que chaque source déclare ses vraies fonctions typées sans
 * bataille de variance sur les paramètres.
 */
export type SourcePipelineFns =
  | {
    readonly download?: undefined;
    readonly stage?: undefined;
    readonly reconcile?: ReconcilePipelineFns;
  }
  | {
    readonly download: DownloadPipelineFns;
    readonly stage?: StagePipelineFns;
    readonly reconcile?: ReconcilePipelineFns;
  };

/**
 * Stratégie de découverte du catalogue complet d'une source.
 *
 * `productUrlRegex` est required ici, contrairement au champ homonyme optionnel
 * de `SourceModule` : la dépendance « découvrir exige de savoir filtrer les
 * entrées du sitemap » est encodée au compile-time. Les deux champs ont des
 * sémantiques distinctes ; une source qui fait les deux les duplique
 * explicitement.
 */
export type CatalogDiscoverySource = {
  readonly kind: "sitemap";
  /** URL d'un `sitemap.xml` ou `sitemapindex.xml` (récursion bornée). */
  readonly url: string;
  /** Capture du slug produit depuis une entrée de sitemap. */
  readonly productUrlRegex: RegExp;
  /**
   * Motifs appliqués au slug décodé pour écarter les produits hors périmètre
   * avant tout fetch. Économise le quota OCR et les appels modèle sur des pages
   * qu'on jetterait ensuite. Optionnel : absence = aucun filtre.
   */
  readonly excludedSlugPatterns?: readonly RegExp[];
};

/**
 * Statistiques d'un analyseur d'utilité de découverte d'images. Défini ici pour
 * éviter un cycle d'import avec le module de découverte d'images, qui consomme
 * le registry de sources.
 */
export interface ImageDiscoveryUsefulnessStats<TRole extends string> {
  imageUrlsTotal: number;
  imageUrlsClassifiedUseful: number;
  roles: Record<TRole, number>;
}
