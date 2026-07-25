/**
 * Preset: find the label image inside a carousel of slides.
 *
 * Plenty of storefronts keep the regulatory information out of the HTML
 * altogether. It lives in an **image** — a shot of the back of the packaging,
 * dropped into the product carousel among the marketing slides. This preset
 * finds it, using two complementary strategies:
 *
 *  1. **By filename** — the most reliable one when the site names its files
 *     meaningfully (`…-nutrition-facts.jpg`, `…-specifications.png`).
 *  2. **By position in the carousel** — the fallback when filenames say
 *     nothing. Slides are ordered by the index in their filename and the
 *     caller feeds them to a vision model, usually starting from the end: the
 *     label is most often the last slide.
 *
 * Nothing here is specific to one site: the path, the filename patterns and
 * the index pattern are all parameters. That is what separates a preset from
 * an adapter.
 *
 * ```ts
 * const picker = createCarouselLabelPicker({
 *   slidePathPattern: /\/slides\//i,
 *   labelFilenamePattern: /(?:nutrition|supplement)[-_]?facts/i,
 * });
 *
 * const direct = picker.findLabelImageUrl(html);
 * const ordered = picker.listSlideUrls(html);   // fallback, feed to vision
 * ```
 *
 * **A note on caching**: hashing the slide URL is a good enough cache key when
 * the site serves stable URLs per packaging revision — no need to hash the
 * image itself. Check that assumption before relying on it: a site that adds a
 * cache-busting parameter breaks it.
 */

/**
 * Pulls the absolute URLs out of the `src` and `data-src` attributes of
 * `<img>` tags. Non-greedy so it stops at the first `>`, and indifferent to
 * attribute order. `data-src` is included because carousels are almost always
 * lazy-loaded.
 */
const IMG_URL_RE =
  /<img[^>]+(?:src|data-src)=["'](https?:\/\/[^"']+)["'][^>]*>/giu;

/** Numeric index framed by dashes: `PREFIX-008-suffix.jpg` → 8. */
const DEFAULT_SLIDE_INDEX_RE = /-(\d+)-/u;

export interface CarouselLabelPickerOptions {
  /**
   * Path that holds the carousel slides, used to rule out images from outside
   * the gallery (logo, icons, cross-sell). Omit to skip path filtering.
   */
  readonly slidePathPattern?: RegExp;
  /**
   * Filename that marks the label image. It has to stay **narrow**: too broad
   * a pattern catches marketing slides and makes downstream extraction fail
   * with high, misleading confidence.
   */
  readonly labelFilenamePattern: RegExp;
  /**
   * Captures the slide index from the filename. Defaults to `-NNN-`.
   * The first group must be the number.
   */
  readonly slideIndexPattern?: RegExp;
}

export interface CarouselLabelPicker {
  /**
   * Carousel slides, deduplicated and sorted by ascending index.
   *
   * A slide with no detectable index gets index `-1` and comes out first: that
   * way it stands out as unusual instead of being quietly buried in the
   * middle. Lazy-loaded pages often repeat the same slide in both the static
   * and the dynamic gallery, hence the deduplication.
   */
  listSlideUrls(html: string): string[];
  /** First image whose filename marks it as a label. */
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
 * Filename patterns commonly used for a regulatory label.
 * A starting point to narrow down per site — not a safe default.
 */
export const COMMON_LABEL_FILENAME_PATTERN =
  /(?:nutrition|supplement|ingredient|spec)[-_]?(?:facts|sheet|s)?/iu;
