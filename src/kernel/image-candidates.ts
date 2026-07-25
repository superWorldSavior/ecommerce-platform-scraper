export const IMAGE_CANDIDATE_DROP_REASONS = [
  "ui_asset",
  "promo_asset",
  "decorative_asset",
  "duplicate",
  "brand_story_asset",
] as const;

export type ImageCandidateDropReason =
  typeof IMAGE_CANDIDATE_DROP_REASONS[number];

export interface ImageCandidateSelectorInput {
  html: string;
  sourceName: string;
  quarter: string;
  productId: string;
  imageUrls: readonly string[];
}

export interface ImageCandidateDrop {
  url: string;
  reason: ImageCandidateDropReason;
  note?: string;
}

export type ImageCandidateDropCounts = Record<ImageCandidateDropReason, number>;

export interface ImageCandidateSelectionStats {
  total: number;
  selected: number;
  dropped: number;
  droppedByReason: ImageCandidateDropCounts;
}

export interface ImageCandidateSelection {
  selectedUrls: string[];
  dropped: ImageCandidateDrop[];
  stats: ImageCandidateSelectionStats;
}

export class ImageCandidateSelectionError extends Error {
  readonly code = "IMAGE_CANDIDATE_SELECTION_INVALID";

  constructor(
    message: string,
    readonly context: {
      productId: string;
      sourceName: string;
      url?: string;
    },
  ) {
    super(message);
    this.name = "ImageCandidateSelectionError";
  }
}

export type ImageCandidateSelector = (
  input: ImageCandidateSelectorInput,
) => ImageCandidateSelection | Promise<ImageCandidateSelection>;

export type ImageCandidateDecision =
  | { keep: true }
  | {
    keep: false;
    reason: ImageCandidateDropReason;
    note?: string;
  };

export function emptyImageCandidateDropCounts(): ImageCandidateDropCounts {
  return {
    ui_asset: 0,
    promo_asset: 0,
    decorative_asset: 0,
    duplicate: 0,
    brand_story_asset: 0,
  };
}

export function buildImageCandidateSelection(
  input: ImageCandidateSelectorInput,
  decide: (
    url: string,
    input: ImageCandidateSelectorInput,
  ) => ImageCandidateDecision,
): ImageCandidateSelection {
  const selectedUrls: string[] = [];
  const dropped: ImageCandidateDrop[] = [];
  const seen = new Set<string>();

  for (const url of input.imageUrls) {
    if (seen.has(url)) {
      dropped.push({
        url,
        reason: "duplicate",
        note: "duplicate image URL",
      });
      continue;
    }
    seen.add(url);

    const decision = decide(url, input);
    if (decision.keep) {
      selectedUrls.push(url);
      continue;
    }
    dropped.push({
      url,
      reason: decision.reason,
      note: decision.note,
    });
  }

  return {
    selectedUrls,
    dropped,
    stats: imageCandidateSelectionStats(
      input.imageUrls.length,
      selectedUrls,
      dropped,
    ),
  };
}

export function capImageCandidateSelection(
  selection: ImageCandidateSelection,
  options: {
    maxSelected: number;
    reason: ImageCandidateDropReason;
    note: string;
  },
): ImageCandidateSelection {
  if (!Number.isInteger(options.maxSelected) || options.maxSelected < 1) {
    throw new ImageCandidateSelectionError(
      "image candidate cap must be a positive integer",
      {
        productId: "unknown",
        sourceName: "unknown",
      },
    );
  }
  if (selection.selectedUrls.length <= options.maxSelected) return selection;

  const selectedUrls = selection.selectedUrls.slice(0, options.maxSelected);
  const dropped = [
    ...selection.dropped,
    ...selection.selectedUrls.slice(options.maxSelected).map((url) => ({
      url,
      reason: options.reason,
      note: options.note,
    })),
  ];

  return {
    selectedUrls,
    dropped,
    stats: imageCandidateSelectionStats(
      selection.stats.total,
      selectedUrls,
      dropped,
    ),
  };
}

export function selectAllImageCandidates(
  input: ImageCandidateSelectorInput,
): ImageCandidateSelection {
  return {
    selectedUrls: [...input.imageUrls],
    dropped: [],
    stats: imageCandidateSelectionStats(
      input.imageUrls.length,
      input.imageUrls,
      [],
    ),
  };
}

export function normalizeImageCandidateHtml(html: string): string {
  return html.replaceAll("&amp;", "&").replaceAll("\\/", "/");
}

export function imageCandidateUrlLookupVariants(url: string): string[] {
  const protocolRelative = url.replace(/^https:/iu, "");
  return [
    ...new Set([
      url,
      protocolRelative,
      url.replaceAll("/", "\\/"),
      protocolRelative.replaceAll("/", "\\/"),
      url.replaceAll("&", "&amp;"),
      protocolRelative.replaceAll("&", "&amp;"),
    ]),
  ];
}

/**
 * URL pattern for the two Shopline CDNs a Shopline site can serve from:
 *  - `img.shoplineapp.com/media/image_clips/`: Product JSON-LD packshots
 *    (the older CDN, lazyload header).
 *  - `shoplineimg.com/<store>/<image>/<size>x.<ext>`: body HTML slides
 *    (composition, dosage, marketing — the modern one).
 *
 * Consumed through `imageUrlHint` by the image discovery layer to attribute
 * HTML URLs to the right source. A site that serves from only one of these two
 * CDNs keeps an `imageUrlHint` of its own, more restrictive.
 */
export const SHOPLINE_DUAL_CDN_IMAGE_URL_HINT =
  /img\.shoplineapp\.com\/media\/image_clips\/|shoplineimg\.com\//i;

export interface BvShopImageCandidateSelectorOptions {
  readonly storeId: string;
}

export function bvShopImageUrlHint(storeId: string): RegExp {
  return new RegExp(
    `image\\.bvshop\\.tw\\/${escapeRegExp(storeId)}\\/(?:product|ckeditor)\\/`,
    "i",
  );
}

export function createBvShopImageCandidateSelector(
  options: BvShopImageCandidateSelectorOptions,
): ImageCandidateSelector {
  const productImageRe = bvShopStoreFolderRe(options.storeId, "product");
  const contentImageRe = bvShopStoreFolderRe(options.storeId, "ckeditor");
  const globalAssetRe = bvShopStoreFolderRe(options.storeId, "favicon|logo");

  return (input) => {
    const selection = buildImageCandidateSelection(input, (url) => {
      if (productImageRe.test(url) || contentImageRe.test(url)) {
        return { keep: true };
      }
      if (globalAssetRe.test(url)) {
        return {
          keep: false,
          reason: "ui_asset",
          note: "BvShop global asset",
        };
      }
      if (BVSHOP_TEMPLATE_ASSET_RE.test(url)) {
        return {
          keep: false,
          reason: "decorative_asset",
          note: "BvShop template asset",
        };
      }
      return {
        keep: false,
        reason: "ui_asset",
        note: "BvShop non-product image URL",
      };
    });
    return dedupeBvShopFormatAliases(selection);
  };
}

function bvShopStoreFolderRe(storeId: string, folderPattern: string): RegExp {
  return new RegExp(
    `image\\.bvshop\\.tw\\/${escapeRegExp(storeId)}\\/(?:${folderPattern})\\/`,
    "i",
  );
}

const BVSHOP_TEMPLATE_ASSET_RE =
  /(?:js\.bvshop\.tw\/s_template\/|bvshop\.tw\/s_template\/)/i;

function dedupeBvShopFormatAliases(
  selection: ImageCandidateSelection,
): ImageCandidateSelection {
  const dropped = [...selection.dropped];
  const groups = new Map<
    string,
    {
      firstIndex: number;
      preferredUrl: string;
      urls: string[];
    }
  >();

  for (const [index, url] of selection.selectedUrls.entries()) {
    const canonicalUrl = canonicalBvShopImageUrlKey(url);
    const group = groups.get(canonicalUrl);
    if (group === undefined) {
      groups.set(canonicalUrl, {
        firstIndex: index,
        preferredUrl: url,
        urls: [url],
      });
      continue;
    }

    group.urls.push(url);
    if (isPreferredBvShopImageUrl(url, group.preferredUrl)) {
      group.preferredUrl = url;
    }
  }

  const selectedUrls = [...groups.values()]
    .sort((left, right) => left.firstIndex - right.firstIndex)
    .map((group) => {
      for (const url of group.urls) {
        if (url === group.preferredUrl) continue;
        dropped.push({
          url,
          reason: "duplicate",
          note: `BvShop format alias of ${group.preferredUrl}`,
        });
      }
      return group.preferredUrl;
    });

  return {
    selectedUrls,
    dropped,
    stats: imageCandidateSelectionStats(
      selection.stats.total,
      selectedUrls,
      dropped,
    ),
  };
}

function canonicalBvShopImageUrl(url: string): string {
  return url.replace(/\.(jpe?g|png)\.webp(?=$|[?#])/iu, ".$1");
}

function canonicalBvShopImageUrlKey(url: string): string {
  return canonicalBvShopImageUrl(url).replace(/[?#].*$/u, "");
}

function isPreferredBvShopImageUrl(
  candidate: string,
  current: string,
): boolean {
  return bvShopImagePreferenceRank(candidate) <
    bvShopImagePreferenceRank(current);
}

function bvShopImagePreferenceRank(url: string): number {
  const formatAliasPenalty = /\.(jpe?g|png)\.webp(?=$|[?#])/iu.test(url)
    ? 2
    : 0;
  const queryOrHashPenalty = /[?#]/u.test(url) ? 1 : 0;
  return formatAliasPenalty + queryOrHashPenalty;
}

const SHOPLINE_SIZED_URL_RE = /\/(\d+)x\.(?:jpe?g|png|webp)/i;
const SHOPLINE_HOST_RE = /(?:img\.shoplineapp\.com|shoplineimg\.com)/i;

export const SHOPLINE_TINY_IMAGE_DEFAULT_THRESHOLD = 96;

/**
 * On Shopline sites, drops the `<id>/<N>x.<ext>` URLs where N < threshold.
 * Images that small are UI icons and decorative buttons, and they crash some
 * vision models outright — `qwen3-vl` panics in `SmartResize` on anything
 * below factor:32. A
 * composable helper, not a global default: it only applies to the sources
 * whose `imageCandidateSelector` references this filter.
 *
 * The filter checks the host (Shopline's two CDNs) before the sized pattern —
 * another CDN that happens to serve a `/24x.png` icon must not be affected.
 * Consistent with the helper's "Shopline" naming.
 */
export function dropTinyShoplineImages(
  threshold: number = SHOPLINE_TINY_IMAGE_DEFAULT_THRESHOLD,
): (url: string) => ImageCandidateDecision {
  return (url) => {
    if (!SHOPLINE_HOST_RE.test(url)) return { keep: true };
    const match = url.match(SHOPLINE_SIZED_URL_RE);
    if (!match) return { keep: true };

    const size = Number(match[1]);
    if (!Number.isFinite(size) || size >= threshold) return { keep: true };

    return {
      keep: false,
      reason: "decorative_asset",
      note: "Shopline tiny resize " + size + "px < " + threshold +
        "px threshold",
    };
  };
}

/**
 * Captures the Shopline `image_id` — the CDN hash that identifies an image
 * independently of its resize dimensions. Pattern:
 * `<base>/<image_id>/<size>x.<ext>`, where `<image_id>` is a SHA-style hex
 * string. Returns null when the URL does not match the Shopline sized pattern
 * (`/original.<ext>`, say, or a different CDN).
 */
const SHOPLINE_IMAGE_ID_URL_RE =
  /\/([a-f0-9]{20,})\/(\d+)x\.(?:jpe?g|png|webp)/i;

export function parseShoplineSizedUrl(
  url: string,
): { imageId: string; size: number } | null {
  const match = SHOPLINE_IMAGE_ID_URL_RE.exec(url);
  if (!match) return null;
  const size = Number(match[2]);
  if (!Number.isFinite(size)) return null;
  return { imageId: match[1], size };
}

/**
 * Deduplicates Shopline URLs by `image_id`: for every image_id encountered,
 * keeps only the version at the largest `<N>x` (the most detailed one). The
 * other versions of the same image_id are dropped as `"duplicate"`.
 *
 * URLs that do not match the Shopline sized pattern (`/original.<ext>`, say)
 * are kept as they are — each is implicitly its own group.
 *
 * Combined with `dropTinyShoplineImages`, this cuts OCR volume on Shopline
 * dramatically: a typical product page with 23 distinct URLs may hold only
 * 8-10 unique `image_id`s once deduplicated.
 */
/**
 * Composed pre-OCR selector, shared by every Shopline site. The chain:
 *
 *   1. Exact URL dedup
 *   2. `dropTinyShoplineImages()` — drops the UI icons (<96px) that crash
 *      `qwen3-vl` in SmartResize.
 *   3. `dedupeShoplineImagesById()` — for each Shopline image_id, keeps only
 *      the version at the largest resize (the most detailed one).
 *
 * Typical use in `mod.ts`:
 *   ```ts
 *   import { selectShoplineImageCandidates } from "../kernel/image-candidates.ts";
 *   export const source = {
 *     ...
 *     imageCandidateSelector: selectShoplineImageCandidates,
 *   } satisfies SourceModule;
 *   ```
 *
 * A Shopline site with specific needs — dropping every hero image, say — can
 * compose primitives of its own or wrap this one.
 */
export const selectShoplineImageCandidates: ImageCandidateSelector = (
  input: ImageCandidateSelectorInput,
): ImageCandidateSelection => {
  const decideTiny = dropTinyShoplineImages();
  const dedupeByImageId = dedupeShoplineImagesById();

  const dropped: ImageCandidateDrop[] = [];
  const seen = new Set<string>();
  const afterTiny: string[] = [];

  for (const url of input.imageUrls) {
    if (seen.has(url)) {
      dropped.push({ url, reason: "duplicate", note: "exact URL duplicate" });
      continue;
    }
    seen.add(url);

    const decision = decideTiny(url);
    if (decision.keep) {
      afterTiny.push(url);
    } else {
      dropped.push({ url, reason: decision.reason, note: decision.note });
    }
  }

  const { keptByUrl, droppedByUrl } = dedupeByImageId(afterTiny);
  for (const [url, note] of droppedByUrl) {
    dropped.push({ url, reason: "duplicate", note });
  }

  const selectedUrls = afterTiny.filter((url) => keptByUrl.has(url));

  const droppedByReason = emptyImageCandidateDropCounts();
  for (const drop of dropped) droppedByReason[drop.reason]++;

  return {
    selectedUrls,
    dropped,
    stats: {
      total: input.imageUrls.length,
      selected: selectedUrls.length,
      dropped: dropped.length,
      droppedByReason,
    },
  };
};

export function dedupeShoplineImagesById(): (
  urls: readonly string[],
) => { keptByUrl: Set<string>; droppedByUrl: Map<string, string> } {
  return (urls) => {
    const byImageId = new Map<string, { url: string; size: number }>();
    const dropped = new Map<string, string>();
    const passthrough = new Set<string>();

    for (const url of urls) {
      const parsed = parseShoplineSizedUrl(url);
      if (!parsed) {
        passthrough.add(url);
        continue;
      }

      const existing = byImageId.get(parsed.imageId);
      if (!existing) {
        byImageId.set(parsed.imageId, { url, size: parsed.size });
        continue;
      }

      if (parsed.size > existing.size) {
        dropped.set(
          existing.url,
          `Shopline image_id ${parsed.imageId} : ${existing.size}px superseded by ${parsed.size}px`,
        );
        byImageId.set(parsed.imageId, { url, size: parsed.size });
      } else {
        dropped.set(
          url,
          `Shopline image_id ${parsed.imageId} : ${parsed.size}px superseded by ${existing.size}px`,
        );
      }
    }

    const kept = new Set<string>(passthrough);
    for (const { url } of byImageId.values()) kept.add(url);
    return { keptByUrl: kept, droppedByUrl: dropped };
  };
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function validateImageCandidateSelection(
  input: ImageCandidateSelectorInput,
  selection: ImageCandidateSelection,
): ImageCandidateSelection {
  const remaining = new Map<string, number>();
  for (const url of input.imageUrls) {
    remaining.set(url, (remaining.get(url) ?? 0) + 1);
  }

  for (const url of selection.selectedUrls) {
    consumeUrl(input, remaining, url, "selected URL");
  }
  for (const drop of selection.dropped) {
    consumeUrl(input, remaining, drop.url, "dropped URL");
  }

  for (const [url, count] of remaining) {
    if (count > 0) {
      throw new ImageCandidateSelectionError(
        `image candidate selector left ${count} URL occurrence(s) unaccounted`,
        {
          productId: input.productId,
          sourceName: input.sourceName,
          url,
        },
      );
    }
  }

  return {
    selectedUrls: [...selection.selectedUrls],
    dropped: [...selection.dropped],
    stats: imageCandidateSelectionStats(
      input.imageUrls.length,
      selection.selectedUrls,
      selection.dropped,
    ),
  };
}

function imageCandidateSelectionStats(
  total: number,
  selectedUrls: readonly string[],
  dropped: readonly ImageCandidateDrop[],
): ImageCandidateSelectionStats {
  const droppedByReason = emptyImageCandidateDropCounts();
  for (const drop of dropped) droppedByReason[drop.reason]++;
  return {
    total,
    selected: selectedUrls.length,
    dropped: dropped.length,
    droppedByReason,
  };
}

function consumeUrl(
  input: ImageCandidateSelectorInput,
  remaining: Map<string, number>,
  url: string,
  label: string,
): void {
  const count = remaining.get(url) ?? 0;
  if (count <= 0) {
    throw new ImageCandidateSelectionError(
      `image candidate selector returned ${label} outside discovered image URLs`,
      {
        productId: input.productId,
        sourceName: input.sourceName,
        url,
      },
    );
  }
  if (count === 1) {
    remaining.delete(url);
  } else {
    remaining.set(url, count - 1);
  }
}
