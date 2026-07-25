/**
 * Renders a `SourceModule` skeleton as TypeScript source.
 *
 * Pure on purpose: no prompts, no filesystem. The interactive shell in
 * `scaffold.ts` collects a spec and hands it here, which means the interesting
 * part — does the generated code actually compile and say the right things —
 * is testable without a terminal.
 *
 * A scaffold **generates code you then edit**, unlike a platform factory which
 * hides code you never write. For a site with no shared commerce engine there
 * is nothing to hide, so the skeleton spells every field out, with a comment
 * pointing at the primitive that fills it.
 */

import type { CommercePlatformKind } from "../kernel/commerce-platform.ts";

export interface ScaffoldSpec {
  /** Lowercase ASCII identifier, the source's key across the pipeline. */
  readonly name: string;
  /** Host as stored on disk, e.g. `shop.example.test`. */
  readonly rawHost: string;
  /** Site root, e.g. `https://shop.example.test`. */
  readonly siteUrl: string;
  readonly platform: CommercePlatformKind;
  /** Free-form engine label. Used only when `platform` is `custom`. */
  readonly customLabel?: string;
  /**
   * Asset CDN host, used to build `imageUrlHint`. Only needed for `custom`:
   * the platform factories already know their engine's CDN.
   */
  readonly imageCdnHost?: string;
  /** Path segment before the product slug — `products`, `item`, `p`… */
  readonly productPathSegment: string;
  /** Whether the site exposes an enumerable catalog via sitemap. */
  readonly catalogDiscovery: boolean;
  /** Module specifier the generated file imports the toolkit from. */
  readonly importSpecifier: string;
}

export class ScaffoldSpecError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScaffoldSpecError";
  }
}

const NAME_RE = /^[a-z][a-z0-9-]*$/u;
const HOST_RE =
  /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/iu;
const PATH_SEGMENT_RE = /^[a-z0-9][a-z0-9\-/]*$/iu;

/**
 * Validates a spec, failing loudly rather than emitting code that will not
 * compile. A scaffold that produces broken output costs more than one that
 * refuses to run.
 */
export function assertScaffoldSpec(spec: ScaffoldSpec): void {
  if (!NAME_RE.test(spec.name)) {
    throw new ScaffoldSpecError(
      `Invalid name "${spec.name}". Expected lowercase ASCII, starting with a letter, e.g. "example-shop".`,
    );
  }
  if (!HOST_RE.test(spec.rawHost)) {
    throw new ScaffoldSpecError(
      `Invalid rawHost "${spec.rawHost}". Expected a bare hostname, e.g. "shop.example.test" — no scheme, no path.`,
    );
  }
  if (!/^https?:\/\//u.test(spec.siteUrl)) {
    throw new ScaffoldSpecError(
      `Invalid siteUrl "${spec.siteUrl}". Expected an absolute URL, e.g. "https://shop.example.test".`,
    );
  }
  if (!PATH_SEGMENT_RE.test(spec.productPathSegment)) {
    throw new ScaffoldSpecError(
      `Invalid productPathSegment "${spec.productPathSegment}". Expected a URL path segment, e.g. "products".`,
    );
  }
  if (spec.platform === "custom" && !spec.imageCdnHost) {
    throw new ScaffoldSpecError(
      "A custom source needs imageCdnHost: without it there is no way to build imageUrlHint, and images cannot be attributed to this source.",
    );
  }
  if (spec.imageCdnHost !== undefined && !HOST_RE.test(spec.imageCdnHost)) {
    throw new ScaffoldSpecError(
      `Invalid imageCdnHost "${spec.imageCdnHost}". Expected a bare hostname, e.g. "cdn.example.test".`,
    );
  }
}

/** Escapes a string for literal use inside a regular expression. */
function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function productUrlRegexLiteral(spec: ScaffoldSpec): string {
  const host = escapeForRegExp(spec.rawHost);
  const segment = spec.productPathSegment.replace(/^\/+|\/+$/gu, "");
  return `/^https:\\/\\/${host}\\/${segment}\\/([^/?#]+)/u`;
}

const FACTORY_BY_PLATFORM = {
  shopline: { fn: "defineShoplineSource", module: "SHOPLINE" },
  cyberbiz: { fn: "defineCyberbizSource", module: "CYBERBIZ" },
  bvshop: { fn: "defineBvShopSource", module: "BV SHOP" },
} as const;

/**
 * Emits the skeleton. Two shapes:
 *
 *  - A known engine → a call to that engine's factory, declaring only what the
 *    factory cannot infer.
 *  - `custom` → a full `SourceModule` literal, every field present and
 *    annotated, because nothing can be inferred.
 */
export function renderSourceModule(spec: ScaffoldSpec): string {
  assertScaffoldSpec(spec);

  return spec.platform === "custom"
    ? renderCustomSource(spec)
    : renderPlatformSource(spec);
}

function renderPlatformSource(spec: ScaffoldSpec): string {
  const factory =
    FACTORY_BY_PLATFORM[spec.platform as keyof typeof FACTORY_BY_PLATFORM];
  const urlRegex = productUrlRegexLiteral(spec);

  return `/**
 * ${spec.name} — a ${factory.module} storefront.
 *
 * Generated skeleton. The engine defaults (commerce platform, image CDN hint,
 * sitemap discovery) come from \`${factory.fn}\`; only what the engine cannot
 * infer is declared below.
 */

import { ${factory.fn} } from "${spec.importSpecifier}";

const PRODUCT_URL_RE = ${urlRegex};

export const source = ${factory.fn}({
  name: "${spec.name}",
  rawHost: "${spec.rawHost}",
  productUrlRegex: PRODUCT_URL_RE,

  // Pre-OCR image selection. \`null\` keeps every candidate image — a fine
  // starting point. Narrow it once you see what the pages actually serve.
  imageCandidateSelector: null,

  // Structured extraction capabilities. Both required, both nullable:
  // \`null\` means "deliberately absent", and the caller falls back to a model
  // pass. Fill \`artifactContext\` with \`createPerArtifactContextProvider\`
  // once you know how this site labels its images.
  projectionProviders: {
    artifactContext: null,
    structuredFacts: null,
  },
${renderCatalogDiscoveryOverride(spec)}
  pipelineFns: {
    download: { siteUrl: "${spec.siteUrl}" },
  },
});
`;
}

function renderCatalogDiscoveryOverride(spec: ScaffoldSpec): string {
  if (spec.catalogDiscovery) return "";
  return `
  // This site exposes no enumerable catalog: it is driven from a candidate
  // list only. Remove this line to accept the engine's sitemap default.
  catalogDiscovery: null,
`;
}

function renderCustomSource(spec: ScaffoldSpec): string {
  const label = spec.customLabel ?? spec.name;
  const urlRegex = productUrlRegexLiteral(spec);
  const cdnHost = escapeForRegExp(spec.imageCdnHost as string);
  const segment = spec.productPathSegment.replace(/^\/+|\/+$/gu, "");

  return `/**
 * ${spec.name} — a storefront with no shared commerce engine.
 *
 * Generated skeleton. Every field of the contract is spelled out: there is no
 * engine to inherit defaults from, so nothing can be filled in for you. Each
 * comment names the primitive that belongs there.
 *
 * The parts you still have to write yourself are the ones no toolkit can
 * guess: how this site's HTML yields a product, and how its images are
 * labelled.
 */

import {
  type CatalogDiscoverySource,
  customCommercePlatform,
  type SourceModule,
} from "${spec.importSpecifier}";

const PRODUCT_URL_RE = ${urlRegex};

/**
 * Catalog discovery. \`null\` if the site has no usable sitemap — the pipeline
 * then works from a supplied candidate list only.
 */
const catalogDiscovery: CatalogDiscoverySource${
    spec.catalogDiscovery ? "" : " | null"
  } = ${
    spec.catalogDiscovery
      ? `{
  kind: "sitemap",
  url: "${spec.siteUrl.replace(/\/+$/u, "")}/sitemap.xml",
  productUrlRegex: PRODUCT_URL_RE,
  // Slugs to skip before any fetch, to save OCR and model budget on pages
  // you would discard anyway.
  // excludedSlugPatterns: [/^gift-card/u],
}`
      : "null"
  };

export const source = {
  name: "${spec.name}",
  rawHost: "${spec.rawHost}",

  // No shared engine: the label is free-form and purely descriptive.
  commercePlatform: customCommercePlatform("${label}"),

  // Attributes images found in an HTML page to this source. Two sites can
  // reference each other's images, so this needs to be specific.
  imageUrlHint: /${cdnHost}\\//iu,

  productUrlRegex: PRODUCT_URL_RE,

  // Pre-OCR image selection. \`null\` keeps every candidate. Build a selector
  // with \`buildImageCandidateSelection\` once you have seen real pages.
  imageCandidateSelector: null,

  // Both required, both nullable. \`null\` = deliberately absent, and the
  // caller falls back to a model pass. \`createPerArtifactContextProvider\`
  // covers the common case where an artifact's role follows from its URL.
  projectionProviders: {
    artifactContext: null,
    structuredFacts: null,
  },

  catalogDiscovery,

  pipelineFns: {
    download: {
      siteUrl: "${spec.siteUrl}",
      // Default is \`\${siteUrl}/products/\${slug}\`. Overridden here because
      // this site uses "/${segment}/".
      productUrlForSlug: (slug: string) =>
        \`${spec.siteUrl.replace(/\/+$/u, "")}/${segment}/\${
          encodeURIComponent(slug)
        }\`,
    },
    // Add \`stage\` once you have a parser: it requires \`download\`, and the
    // contract enforces that at compile time.
  },
} satisfies SourceModule;
`;
}
