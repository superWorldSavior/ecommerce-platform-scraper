/**
 * Preset : trouver l'image d'étiquette dans un carrousel de slides.
 *
 * Beaucoup de storefronts ne mettent pas les informations réglementaires dans le
 * HTML. Elles sont dans une **image** — un visuel du dos de l'emballage, posé
 * dans le carrousel produit au milieu de slides marketing. Ce preset la trouve,
 * par deux stratégies complémentaires :
 *
 *  1. **Par nom de fichier** — le plus fiable quand le site nomme ses fichiers
 *     de façon parlante (`…-nutrition-facts.jpg`, `…-specifications.png`).
 *  2. **Par position dans le carrousel** — repli quand les noms n'indiquent
 *     rien. Les slides sont ordonnées par l'index de leur nom de fichier et
 *     l'appelant les fait passer à un modèle vision, généralement en partant de
 *     la fin : l'étiquette est le plus souvent la dernière slide.
 *
 * Rien ici n'est propre à un site : chemin, motifs de nom et motif d'index sont
 * des paramètres. C'est ce qui distingue un preset d'un adapter.
 *
 * ```ts
 * const picker = createCarouselLabelPicker({
 *   slidePathPattern: /\/slides\//i,
 *   labelFilenamePattern: /(?:nutrition|supplement)[-_]?facts/i,
 * });
 *
 * const direct = picker.findLabelImageUrl(html);
 * const ordered = picker.listSlideUrls(html);   // repli, à passer au vision
 * ```
 *
 * **Note sur le cache** : hacher l'URL de la slide suffit comme clé de cache
 * quand le site sert des URLs stables par version d'emballage — inutile de
 * hacher l'image. Vérifier cette hypothèse avant de s'y fier : un site qui
 * ajoute un paramètre de cache-busting la casse.
 */

/**
 * Extrait les URLs absolues des attributs `src` et `data-src` des `<img>`.
 * Non-greedy pour s'arrêter au premier `>`, insensible à l'ordre des attributs.
 * `data-src` est inclus parce que les carrousels sont presque toujours en
 * chargement différé.
 */
const IMG_URL_RE =
  /<img[^>]+(?:src|data-src)=["'](https?:\/\/[^"']+)["'][^>]*>/giu;

/** Index numérique encadré de tirets : `PREFIX-008-suffix.jpg` → 8. */
const DEFAULT_SLIDE_INDEX_RE = /-(\d+)-/u;

export interface CarouselLabelPickerOptions {
  /**
   * Chemin qui contient les slides du carrousel, pour écarter les images hors
   * galerie (logo, icônes, cross-sell). Omettre pour ne pas filtrer par chemin.
   */
  readonly slidePathPattern?: RegExp;
  /**
   * Nom de fichier désignant l'image d'étiquette. Doit rester **étroit** : un
   * motif trop large attrape des slides marketing et fait échouer l'extraction
   * en aval avec une confiance haute et trompeuse.
   */
  readonly labelFilenamePattern: RegExp;
  /**
   * Capture de l'index de slide dans le nom de fichier. Défaut : `-NNN-`.
   * Le premier groupe doit être le nombre.
   */
  readonly slideIndexPattern?: RegExp;
}

export interface CarouselLabelPicker {
  /**
   * Slides du carrousel, dédupliquées et triées par index croissant.
   *
   * Une slide sans index détectable reçoit l'index `-1` et passe en tête : elle
   * est signalée comme atypique plutôt que silencieusement noyée au milieu.
   * Les pages en chargement différé répètent souvent la même slide dans la
   * galerie statique et la galerie dynamique, d'où la déduplication.
   */
  listSlideUrls(html: string): string[];
  /** Première image dont le nom de fichier désigne une étiquette. */
  findLabelImageUrl(html: string): string | null;
}

export function createCarouselLabelPicker(
  options: CarouselLabelPickerOptions,
): CarouselLabelPicker {
  const slideIndexPattern = options.slideIndexPattern ??
    DEFAULT_SLIDE_INDEX_RE;

  const imageUrls = (html: string): string[] =>
    [...html.matchAll(IMG_URL_RE)].map((match) => match[1]);

  return {
    listSlideUrls(html: string): string[] {
      const seen = new Set<string>();
      const entries: Array<{ url: string; index: number }> = [];

      for (const url of imageUrls(html)) {
        if (
          options.slidePathPattern !== undefined &&
          !options.slidePathPattern.test(url)
        ) {
          continue;
        }
        if (seen.has(url)) continue;
        seen.add(url);

        const matched = slideIndexPattern.exec(url);
        entries.push({
          url,
          index: matched ? Number.parseInt(matched[1], 10) : -1,
        });
      }

      entries.sort((a, b) => a.index - b.index);
      return entries.map((entry) => entry.url);
    },

    findLabelImageUrl(html: string): string | null {
      for (const url of imageUrls(html)) {
        if (options.labelFilenamePattern.test(url)) return url;
      }
      return null;
    },
  };
}

/**
 * Motifs de nom de fichier fréquents pour une étiquette réglementaire.
 * Point de départ à restreindre selon le site — pas une valeur par défaut sûre.
 */
export const COMMON_LABEL_FILENAME_PATTERN =
  /(?:nutrition|supplement|ingredient|spec)[-_]?(?:facts|sheet|s)?/iu;
