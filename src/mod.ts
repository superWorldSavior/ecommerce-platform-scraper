/**
 * ecommerce-platform-scraper — scraping toolkit for e-commerce storefronts,
 * organised by platform.
 *
 * Single entry point. Submodules stay directly importable when you only need a
 * part of the toolkit.
 */

// ── Source contract ─────────────────────────────────────────────────────────
export type {
  CatalogDiscoverySource,
  DownloadPipelineFns,
  ImageDiscoveryUsefulnessStats,
  MinimalReconciledSnapshot,
  MinimalStageSnapshot,
  ProjectionProviders,
  ReconcilePipelineFns,
  SourceModule,
  SourcePipelineFns,
  StagePipelineFns,
} from "./kernel/source-module.ts";

export type {
  SourceKind,
  SourceMethod,
  StageSource,
} from "./kernel/source-kind.ts";

export { PIPELINE_PHASES } from "./kernel/phases.ts";
export type { PipelinePhase } from "./kernel/phases.ts";

// ── Platforms ──────────────────────────────────────────────────────────────
export {
  BVSHOP_COMMERCE_PLATFORM,
  type CommercePlatform,
  type CommercePlatformKind,
  customCommercePlatform,
  CYBERBIZ_COMMERCE_PLATFORM,
  SHOPLINE_COMMERCE_PLATFORM,
} from "./kernel/commerce-platform.ts";

export {
  defineShoplineSource,
  SHOPLINE_PLATFORM_MODULE,
} from "./platforms/shopline.ts";
export type {
  DefinedShoplineSource,
  ShoplineCatalogDiscoverySpec,
  ShoplinePlatformModule,
  ShoplineSourceSpec,
} from "./platforms/shopline.ts";

export {
  BVSHOP_ITEM_QUERY_SCRIPT_ATTR,
  BVSHOP_PLATFORM_MODULE,
  bvShopCookieHeaderFromSetCookies,
  bvShopItemQueryUrlForProductUrl,
  defineBvShopSource,
  extractBvShopItemSlugFromUrl,
  resolveBvShopItemQueryUrlForProductUrl,
} from "./platforms/bvshop.ts";
export type {
  BvShopCatalogDiscoverySpec,
  BvShopItemQueryUrlErrorCode,
  BvShopItemQueryUrlResolution,
  BvShopPlatformModule,
  BvShopSourceSpec,
} from "./platforms/bvshop.ts";

export {
  capCyberbizImageCandidateSelection,
  CYBERBIZ_CDN_IMAGE_URL_HINT,
  CYBERBIZ_DEFAULT_MAX_SELECTED_IMAGES,
  CYBERBIZ_PLATFORM_MODULE,
  cyberbizImageContextWindows,
  decideCyberbizContentImageByHtmlContext,
  decideCyberbizContentImageContext,
  defineCyberbizSource,
} from "./platforms/cyberbiz.ts";
export type {
  CyberbizCatalogDiscoverySpec,
  CyberbizPlatformModule,
  CyberbizSourceSpec,
  DefinedCyberbizSource,
} from "./platforms/cyberbiz.ts";

// ── Discovery ───────────────────────────────────────────────────────────────
export {
  CandidatesNotFoundError,
  inMemoryCandidateSource,
  InvalidCandidateError,
  loadCandidateProducts,
  loadCandidateProductsWithMeta,
} from "./kernel/discovery.ts";
export type {
  CandidateProduct,
  CandidateQuery,
  CandidateRecord,
  CandidateSource,
} from "./kernel/discovery.ts";

export {
  excludeByPattern,
  filterByPrefix,
  parseSitemapUrls,
  splitSitemap,
} from "./kernel/sitemap.ts";
export type { SitemapSplit } from "./kernel/sitemap.ts";

export {
  fetchCatalogFromSitemap,
  filterCatalogEntriesByDenylist,
  isDenylistedProductId,
} from "./kernel/catalog-sitemap.ts";
export type {
  CatalogProductCandidate,
  SitemapFetcher,
} from "./kernel/catalog-sitemap.ts";

// ── HTTP ─────────────────────────────────────────────────────────────────────
export {
  HttpFetchError,
  isDisallowed,
  parseRobotsTxt,
  PoliteFetcher,
} from "./kernel/http/fetch.ts";
export type {
  PoliteFetcherOptions,
  PoliteFetchRequestOptions,
  PoliteTextResponse,
  RobotsRules,
} from "./kernel/http/fetch.ts";

// ── Raw storage ────────────────────────────────────────────────────────────
export {
  DEFAULT_RAW_ROOT,
  ProductHtmlNotFoundError,
  productHtmlPath,
  productHtmlPaths,
  readProductHtml,
} from "./kernel/html-source.ts";
export type {
  ProductHtmlSourceConfig,
  ResolvedProductHtml,
} from "./kernel/html-source.ts";

export {
  createStageProgressTracker,
  stageProgressPathForSnapshot,
} from "./kernel/stage-progress.ts";
export type {
  StageProgressPayload,
  StageProgressTracker,
} from "./kernel/stage-progress.ts";

// ── Images ───────────────────────────────────────────────────────────────────
export {
  buildImageCandidateSelection,
  emptyImageCandidateDropCounts,
  IMAGE_CANDIDATE_DROP_REASONS,
  ImageCandidateSelectionError,
} from "./kernel/image-candidates.ts";
export type {
  ImageCandidateDecision,
  ImageCandidateDrop,
  ImageCandidateDropCounts,
  ImageCandidateDropReason,
  ImageCandidateSelection,
  ImageCandidateSelectionStats,
  ImageCandidateSelector,
  ImageCandidateSelectorInput,
} from "./kernel/image-candidates.ts";

export { fetchImageAsBase64, ImageFetchError } from "./kernel/image-fetch.ts";
export type {
  FetchedImageBase64,
  FetchImageOptions,
  ImageMimeType,
} from "./kernel/image-fetch.ts";

// ── Artifact context ─────────────────────────────────────────────────────
export {
  BASE_ARTIFACT_ROLES,
  BASE_NOISE_ROLES,
  createDefaultArtifactContextProvider,
  createEmptyRoleCounts,
  defineRoleVocabulary,
  normalizeArtifactUrl,
  preferredRolesForProjection,
  projectionContextArtifactsWithRoles,
  RoleVocabularyError,
  selectProjectionContext,
  sumArtifactChars,
} from "./kernel/artifact-context.ts";
export type {
  ArtifactClassification,
  ArtifactContextArtifact,
  ArtifactContextFallbackReason,
  ArtifactContextProvider,
  ArtifactContextProviderInput,
  ArtifactContextSelectionMode,
  BaseArtifactRole,
  ClassifiedArtifact,
  ProjectionContext,
  ProjectionContextStats,
  RoleVocabulary,
} from "./kernel/artifact-context.ts";

export { createPerArtifactContextProvider } from "./kernel/artifact-context-helpers.ts";

// ── OCR ──────────────────────────────────────────────────────────────────────
export {
  averageConfidence,
  confidenceFromAverage,
  DEFAULT_OCR_CONFIDENCE_THRESHOLDS,
  emptyOcrResult,
  renderOcrLinesToMarkdown,
  runOcrQualityChecks,
} from "./kernel/ocr/provider.ts";
export type {
  OcrConfidence,
  OcrConfidenceThresholds,
  OcrDiagnostics,
  OcrFallbackReason,
  OcrImageMimeType,
  OcrInput,
  OcrLine,
  OcrProvider,
  OcrQualityCheck,
  OcrResult,
} from "./kernel/ocr/provider.ts";

export {
  APPLE_VISION_OUTPUT_VERSION,
  APPLE_VISION_PROVIDER_NAME,
  appleVisionHelperSourcePath,
  createAppleVisionOcrProvider,
  parseAppleVisionOcrOutput,
} from "./kernel/ocr/apple-vision.ts";
export type { AppleVisionOcrOptions } from "./kernel/ocr/apple-vision.ts";

export { parseOcrLayoutDocument } from "./kernel/ocr/layout.ts";
export type {
  OcrBoundingBox,
  OcrCoordinateSystem,
  OcrLayoutDocument,
  OcrLayoutLine,
} from "./kernel/ocr/layout.ts";

// ── LLM ──────────────────────────────────────────────────────────────────────
export {
  createLlmClient,
  extractLlmErrorCode,
  LlmClientError,
} from "./kernel/llm/client.ts";
export type {
  LlmClient,
  LlmClientOptions,
  LlmCompleteInput,
  LlmCompleteResult,
  LlmErrorCode,
  LlmExtractInput,
  LlmExtractResult,
  LlmUsage,
} from "./kernel/llm/client.ts";

// ── Presets ──────────────────────────────────────────────────────────────────
export {
  COMMON_LABEL_FILENAME_PATTERN,
  createCarouselLabelPicker,
} from "./presets/carousel-label-picker.ts";
export type {
  CarouselLabelPicker,
  CarouselLabelPickerOptions,
} from "./presets/carousel-label-picker.ts";

// ── Locales ──────────────────────────────────────────────────────────────────
export {
  TRADITIONAL_CHINESE_OCR_CONFUSIONS,
  traditionalChineseOcrQualityCheck,
} from "./locales/zh-TW/ocr-quality.ts";
