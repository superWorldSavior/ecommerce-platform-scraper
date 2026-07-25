/**
 * Queryable catalogue of everything the toolkit exports.
 *
 * This exists because prose gets skimmed. A reader — human or agent — about to
 * write an adapter needs a way to *ask* what already exists, and get an answer
 * grounded in the real exports rather than in whatever a document last claimed.
 *
 * The guarantee that makes it worth trusting: a test asserts this catalogue and
 * the public surface of `mod.ts` describe exactly the same set of symbols. Add
 * an export without cataloguing it and the suite fails. There is no way for
 * this list to go quietly stale, which is the only property that matters in a
 * document meant to prevent reinvention.
 */

/** The axis a primitive belongs to. Also the `--axis` filter values. */
export const PRIMITIVE_AXES = [
  "contract",
  "platform",
  "discovery",
  "http",
  "storage",
  "images",
  "artifact-context",
  "ocr",
  "llm",
  "presets",
  "locales",
] as const;

export type PrimitiveAxis = typeof PRIMITIVE_AXES[number];

export interface PrimitiveEntry {
  readonly symbol: string;
  readonly axis: PrimitiveAxis;
  /** One line, in the imperative. What it does, not how. */
  readonly summary: string;
}

export const PRIMITIVE_CATALOGUE: readonly PrimitiveEntry[] = [
  // ── contract ──────────────────────────────────────────────────────────────
  {
    symbol: "PIPELINE_PHASES",
    axis: "contract",
    summary: "The pipeline phases, in execution order.",
  },

  // ── platform ──────────────────────────────────────────────────────────────
  {
    symbol: "defineShoplineSource",
    axis: "platform",
    summary:
      "Declare a SHOPLINE source; fills in engine defaults incl. a shared pre-OCR selector.",
  },
  {
    symbol: "defineCyberbizSource",
    axis: "platform",
    summary:
      "Declare a CYBERBIZ source; fills in CDN hint and sitemap discovery.",
  },
  {
    symbol: "defineBvShopSource",
    axis: "platform",
    summary: "Declare a BV SHOP source; fills in engine defaults.",
  },
  {
    symbol: "customCommercePlatform",
    axis: "platform",
    summary: "Label a storefront that runs on no shared engine.",
  },
  {
    symbol: "SHOPLINE_COMMERCE_PLATFORM",
    axis: "platform",
    summary: "The SHOPLINE engine identity.",
  },
  {
    symbol: "CYBERBIZ_COMMERCE_PLATFORM",
    axis: "platform",
    summary: "The CYBERBIZ engine identity.",
  },
  {
    symbol: "BVSHOP_COMMERCE_PLATFORM",
    axis: "platform",
    summary: "The BV SHOP engine identity.",
  },
  {
    symbol: "SHOPLINE_PLATFORM_MODULE",
    axis: "platform",
    summary: "SHOPLINE defaults, if you need them without the factory.",
  },
  {
    symbol: "CYBERBIZ_PLATFORM_MODULE",
    axis: "platform",
    summary: "CYBERBIZ defaults, if you need them without the factory.",
  },
  {
    symbol: "BVSHOP_PLATFORM_MODULE",
    axis: "platform",
    summary: "BV SHOP defaults, if you need them without the factory.",
  },
  {
    symbol: "CYBERBIZ_CDN_IMAGE_URL_HINT",
    axis: "platform",
    summary: "Match CYBERBIZ asset hosts, including regionalised ones.",
  },
  {
    symbol: "CYBERBIZ_DEFAULT_MAX_SELECTED_IMAGES",
    axis: "platform",
    summary: "Default per-page image cap for CYBERBIZ.",
  },
  {
    symbol: "cyberbizImageContextWindows",
    axis: "platform",
    summary: "Slice the markup around every occurrence of an image URL.",
  },
  {
    symbol: "decideCyberbizContentImageContext",
    axis: "platform",
    summary: "Classify a CYBERBIZ image from one markup window.",
  },
  {
    symbol: "decideCyberbizContentImageByHtmlContext",
    axis: "platform",
    summary: "Classify a CYBERBIZ image from a whole page.",
  },
  {
    symbol: "capCyberbizImageCandidateSelection",
    axis: "platform",
    summary: "Cap a selection, attributing drops to the cap not to a rule.",
  },
  {
    symbol: "BVSHOP_ITEM_QUERY_SCRIPT_ATTR",
    axis: "platform",
    summary: "Attribute marking the stored BV SHOP item/query JSON.",
  },
  {
    symbol: "bvShopItemQueryUrlForProductUrl",
    axis: "platform",
    summary: "Derive the BV SHOP JSON endpoint URL, or null.",
  },
  {
    symbol: "resolveBvShopItemQueryUrlForProductUrl",
    axis: "platform",
    summary: "Same, with a typed error code instead of null.",
  },
  {
    symbol: "extractBvShopItemSlugFromUrl",
    axis: "platform",
    summary: "Pull the product slug out of a BV SHOP item URL.",
  },
  {
    symbol: "bvShopCookieHeaderFromSetCookies",
    axis: "platform",
    summary: "Build the Cookie header the BV SHOP JSON endpoint expects.",
  },

  // ── discovery ─────────────────────────────────────────────────────────────
  {
    symbol: "loadCandidateProducts",
    axis: "discovery",
    summary: "Load and validate candidates; throws on an empty list.",
  },
  {
    symbol: "loadCandidateProductsWithMeta",
    axis: "discovery",
    summary: "Same, keeping your domain metadata attached.",
  },
  {
    symbol: "inMemoryCandidateSource",
    axis: "discovery",
    summary:
      "A CandidateSource over a fixed array, for tests and getting started.",
  },
  {
    symbol: "CandidatesNotFoundError",
    axis: "discovery",
    summary: "Thrown when a source yields no candidates at all.",
  },
  {
    symbol: "InvalidCandidateError",
    axis: "discovery",
    summary:
      "Thrown when a row is present but unusable; carries index and field.",
  },
  {
    symbol: "parseSitemapUrls",
    axis: "discovery",
    summary: "Extract <loc> URLs from a sitemap payload.",
  },
  {
    symbol: "splitSitemap",
    axis: "discovery",
    summary: "Separate product URLs from child sitemaps in one document.",
  },
  {
    symbol: "filterByPrefix",
    axis: "discovery",
    summary: "Keep URLs starting with a prefix.",
  },
  {
    symbol: "excludeByPattern",
    axis: "discovery",
    summary: "Drop URLs matching a pattern.",
  },
  {
    symbol: "fetchCatalogFromSitemap",
    axis: "discovery",
    summary: "Walk a sitemap into product candidates, recursion bounded.",
  },
  {
    symbol: "filterCatalogEntriesByDenylist",
    axis: "discovery",
    summary: "Drop out-of-scope products before any page fetch.",
  },
  {
    symbol: "isDenylistedProductId",
    axis: "discovery",
    summary: "Test one product id against the denylist patterns.",
  },

  // ── http ──────────────────────────────────────────────────────────────────
  {
    symbol: "PoliteFetcher",
    axis: "http",
    summary: "Fetch with a minimum interval per host and typed failures.",
  },
  {
    symbol: "HttpFetchError",
    axis: "http",
    summary: "Fetch failure carrying a discriminable code.",
  },
  {
    symbol: "parseRobotsTxt",
    axis: "http",
    summary: "Parse robots.txt into allow, disallow and sitemap rules.",
  },
  {
    symbol: "isDisallowed",
    axis: "http",
    summary: "Test a path against parsed robots rules, longest-match wins.",
  },

  // ── storage ───────────────────────────────────────────────────────────────
  {
    symbol: "readProductHtml",
    axis: "storage",
    summary: "Read the first stored HTML found among the candidate paths.",
  },
  {
    symbol: "productHtmlPath",
    axis: "storage",
    summary: "Build the conventional storage path for one product snapshot.",
  },
  {
    symbol: "productHtmlPaths",
    axis: "storage",
    summary: "All paths to try, primary first, deduplicated.",
  },
  {
    symbol: "ProductHtmlNotFoundError",
    axis: "storage",
    summary: "Thrown when no candidate path holds the HTML.",
  },
  {
    symbol: "DEFAULT_RAW_ROOT",
    axis: "storage",
    summary: "Default raw storage root.",
  },
  {
    symbol: "createStageProgressTracker",
    axis: "storage",
    summary: "Track staging progress so a run can resume.",
  },
  {
    symbol: "stageProgressPathForSnapshot",
    axis: "storage",
    summary: "Where a snapshot's progress file lives.",
  },

  // ── images ────────────────────────────────────────────────────────────────
  {
    symbol: "buildImageCandidateSelection",
    axis: "images",
    summary:
      "Build a pre-OCR selection where every drop carries URL and reason.",
  },
  {
    symbol: "emptyImageCandidateDropCounts",
    axis: "images",
    summary: "Zeroed drop counters, one per reason.",
  },
  {
    symbol: "IMAGE_CANDIDATE_DROP_REASONS",
    axis: "images",
    summary: "The closed set of reasons an image may be dropped.",
  },
  {
    symbol: "ImageCandidateSelectionError",
    axis: "images",
    summary: "Thrown when a selection is internally inconsistent.",
  },
  {
    symbol: "fetchImageAsBase64",
    axis: "images",
    summary: "Download an image to base64, MIME read from the response.",
  },
  {
    symbol: "ImageFetchError",
    axis: "images",
    summary: "Image fetch failure; separates a 404 from a network error.",
  },

  // ── artifact-context ──────────────────────────────────────────────────────
  {
    symbol: "createPerArtifactContextProvider",
    axis: "artifact-context",
    summary: "Classify each artifact on its own; covers the common case.",
  },
  {
    symbol: "createDefaultArtifactContextProvider",
    axis: "artifact-context",
    summary: "Classify nothing and filter nothing; the no-provider behaviour.",
  },
  {
    symbol: "selectProjectionContext",
    axis: "artifact-context",
    summary:
      "Reduce artifacts to those useful for one projection, with fallbacks.",
  },
  {
    symbol: "defineRoleVocabulary",
    axis: "artifact-context",
    summary: "Declare your domain's roles and per-projection preferences.",
  },
  {
    symbol: "RoleVocabularyError",
    axis: "artifact-context",
    summary: "Thrown when a vocabulary references a role it does not declare.",
  },
  {
    symbol: "BASE_ARTIFACT_ROLES",
    axis: "artifact-context",
    summary: "Roles valid for any storefront; extend rather than replace.",
  },
  {
    symbol: "BASE_NOISE_ROLES",
    axis: "artifact-context",
    summary: "Base roles that never carry product content.",
  },
  {
    symbol: "createEmptyRoleCounts",
    axis: "artifact-context",
    summary: "Zeroed counters for every role in a vocabulary.",
  },
  {
    symbol: "preferredRolesForProjection",
    axis: "artifact-context",
    summary: "Which roles a projection prefers, or null if unspecified.",
  },
  {
    symbol: "projectionContextArtifactsWithRoles",
    axis: "artifact-context",
    summary: "Artifacts in a context carrying any of the given roles.",
  },
  {
    symbol: "sumArtifactChars",
    axis: "artifact-context",
    summary: "Total characters across artifacts, for context budgeting.",
  },
  {
    symbol: "normalizeArtifactUrl",
    axis: "artifact-context",
    summary: "Normalise a URL scraped out of raw HTML; null if not http(s).",
  },

  // ── ocr ───────────────────────────────────────────────────────────────────
  {
    symbol: "createAppleVisionOcrProvider",
    axis: "ocr",
    summary: "An OcrProvider backed by Apple Vision. macOS only.",
  },
  {
    symbol: "parseAppleVisionOcrOutput",
    axis: "ocr",
    summary: "Parse the helper's JSON; testable on any host.",
  },
  {
    symbol: "appleVisionHelperSourcePath",
    axis: "ocr",
    summary: "Path to the bundled Objective-C helper source.",
  },
  {
    symbol: "APPLE_VISION_PROVIDER_NAME",
    axis: "ocr",
    summary: "Provider name recorded in results.",
  },
  {
    symbol: "APPLE_VISION_OUTPUT_VERSION",
    axis: "ocr",
    summary: "Version of the helper's output contract.",
  },
  {
    symbol: "confidenceFromAverage",
    axis: "ocr",
    summary: "Band an average confidence into HIGH, MEDIUM or LOW.",
  },
  {
    symbol: "averageConfidence",
    axis: "ocr",
    summary: "Mean line confidence; null when there are no lines.",
  },
  {
    symbol: "DEFAULT_OCR_CONFIDENCE_THRESHOLDS",
    axis: "ocr",
    summary: "Thresholds calibrated on photographed labels.",
  },
  {
    symbol: "renderOcrLinesToMarkdown",
    axis: "ocr",
    summary: "Join non-empty lines in the order received.",
  },
  {
    symbol: "runOcrQualityChecks",
    axis: "ocr",
    summary: "Run every quality check and aggregate the warnings.",
  },
  {
    symbol: "emptyOcrResult",
    axis: "ocr",
    summary: "Typed empty result for any failure path.",
  },
  {
    symbol: "parseOcrLayoutDocument",
    axis: "ocr",
    summary: "Validate a stored OCR layout document, or null.",
  },

  // ── llm ───────────────────────────────────────────────────────────────────
  {
    symbol: "createLlmClient",
    axis: "llm",
    summary:
      "Client over any OpenAI-compatible endpoint; routes text and vision separately.",
  },
  {
    symbol: "LlmClientError",
    axis: "llm",
    summary: "Model call failure carrying a discriminable code.",
  },
  {
    symbol: "extractLlmErrorCode",
    axis: "llm",
    summary: "Recover the code from a caught error, or null.",
  },

  // ── presets ───────────────────────────────────────────────────────────────
  {
    symbol: "createCarouselLabelPicker",
    axis: "presets",
    summary:
      "Find the label image in a carousel, by filename then by position.",
  },
  {
    symbol: "COMMON_LABEL_FILENAME_PATTERN",
    axis: "presets",
    summary:
      "Common label filename shapes. A starting point, not a safe default.",
  },

  // ── locales ───────────────────────────────────────────────────────────────
  {
    symbol: "traditionalChineseOcrQualityCheck",
    axis: "locales",
    summary: "Flag known Traditional Chinese OCR character confusions.",
  },
  {
    symbol: "TRADITIONAL_CHINESE_OCR_CONFUSIONS",
    axis: "locales",
    summary: "The confusion table behind that check.",
  },
];

/** Entries on one axis, in catalogue order. */
export function primitivesForAxis(
  axis: PrimitiveAxis,
): readonly PrimitiveEntry[] {
  return PRIMITIVE_CATALOGUE.filter((entry) => entry.axis === axis);
}

/** Case-insensitive substring search over symbol and summary. */
export function searchPrimitives(query: string): readonly PrimitiveEntry[] {
  const needle = query.toLowerCase();
  return PRIMITIVE_CATALOGUE.filter((entry) =>
    entry.symbol.toLowerCase().includes(needle) ||
    entry.summary.toLowerCase().includes(needle)
  );
}
