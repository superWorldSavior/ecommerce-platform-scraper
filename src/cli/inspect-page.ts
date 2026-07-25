/**
 * Reads a product page and reports what it observed.
 *
 * Pure analysis, separated from the network and the terminal so it can be
 * tested on fixture HTML. `inspect.ts` fetches; this file draws conclusions.
 *
 * Everything here is an **observation with a source**, never a guess. If a
 * signal is absent the report says so rather than filling in a plausible
 * default: a wrong `imageUrlHint` accepted on faith costs a whole scrape run
 * before anyone notices the images were attributed to nobody.
 */

import { PRIMITIVE_CATALOGUE } from "./primitive-catalogue.ts";

export interface DetectedPlatform {
  readonly kind: "shopline" | "cyberbiz" | "bvshop" | "custom";
  /** What in the page led here. Empty when nothing did. */
  readonly evidence: readonly string[];
}

export interface PageObservations {
  readonly url: string;
  readonly platform: DetectedPlatform;
  /** Image hosts seen in `<img>` tags, most frequent first. */
  readonly imageHosts: ReadonlyArray<{ host: string; count: number }>;
  /** Whether a JSON-LD block declaring `Product` is present. */
  readonly hasProductJsonLd: boolean;
  /** Path segment before the product slug, read from the URL. */
  readonly productPathSegment: string | null;
  /** Filenames suggesting a regulatory or spec label image. */
  readonly labelImageCandidates: readonly string[];
  /** Images referenced via `data-src`, i.e. lazy-loaded. */
  readonly lazyLoadedImageCount: number;
}

const IMG_TAG_RE =
  /<img[^>]+(?:src|data-src)=["'](https?:\/\/[^"']+)["'][^>]*>/giu;
const DATA_SRC_RE = /<img[^>]+data-src=["']https?:\/\/[^"']+["']/giu;
const JSONLD_BLOCK_RE =
  /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu;
const LABEL_FILENAME_RE =
  /(?:nutrition|supplement|ingredient|spec|facts|label)[-_]?[a-z0-9]*\.(?:jpe?g|png|webp)/iu;

/** Host signatures, checked against the image hosts actually seen. */
const PLATFORM_IMAGE_SIGNATURES = [
  {
    kind: "shopline" as const,
    re: /(?:img\.shoplineapp\.com|shoplineimg\.com)/iu,
  },
  { kind: "cyberbiz" as const, re: /cybassets\.com/iu },
  { kind: "bvshop" as const, re: /image\.bvshop\.tw/iu },
];

function imageUrls(html: string): string[] {
  return [...html.matchAll(IMG_TAG_RE)].map((match) => match[1]);
}

function hostOf(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function countImageHosts(
  urls: readonly string[],
): ReadonlyArray<{ host: string; count: number }> {
  const counts = new Map<string, number>();
  for (const url of urls) {
    const host = hostOf(url);
    if (host !== null) counts.set(host, (counts.get(host) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([host, count]) => ({ host, count }))
    .sort((a, b) => b.count - a.count || a.host.localeCompare(b.host));
}

function detectProductJsonLd(html: string): boolean {
  for (const match of html.matchAll(JSONLD_BLOCK_RE)) {
    // Deliberately a substring test rather than JSON.parse: these blocks are
    // frequently malformed in the wild, and a parse failure would report
    // "absent" for a block that is plainly there.
    if (/"@type"\s*:\s*"?\[?\s*"?Product/iu.test(match[1])) return true;
  }
  return false;
}

function detectPlatform(
  hosts: ReadonlyArray<{ host: string }>,
  url: string,
): DetectedPlatform {
  const evidence: string[] = [];

  for (const signature of PLATFORM_IMAGE_SIGNATURES) {
    const matched = hosts.filter((entry) => signature.re.test(entry.host));
    if (matched.length > 0) {
      evidence.push(
        `image host ${matched.map((m) => m.host).join(", ")}`,
      );
      if (signature.kind === "bvshop" && /\/item\//u.test(url)) {
        evidence.push("product path /item/");
      }
      return { kind: signature.kind, evidence };
    }
  }

  return { kind: "custom", evidence: [] };
}

function detectProductPathSegment(url: string): string | null {
  try {
    const parts = new URL(url).pathname.split("/").filter(Boolean);
    return parts.length >= 2 ? parts[parts.length - 2] : null;
  } catch {
    return null;
  }
}

function detectLabelCandidates(urls: readonly string[]): readonly string[] {
  const found = new Set<string>();
  for (const url of urls) {
    const filename = url.split("/").pop() ?? "";
    if (LABEL_FILENAME_RE.test(filename)) found.add(filename);
  }
  return [...found].sort();
}

export function observePage(url: string, html: string): PageObservations {
  const urls = imageUrls(html);
  const imageHosts = countImageHosts(urls);

  return {
    url,
    platform: detectPlatform(imageHosts, url),
    imageHosts,
    hasProductJsonLd: detectProductJsonLd(html),
    productPathSegment: detectProductPathSegment(url),
    labelImageCandidates: detectLabelCandidates(urls),
    lazyLoadedImageCount: [...html.matchAll(DATA_SRC_RE)].length,
  };
}

/** Which extraction strategy the observations point at. */
export function suggestedSourceMethod(obs: PageObservations): string {
  if (!obs.hasProductJsonLd) return "html-direct";
  if (obs.platform.kind === "shopline") return "shopline-jsonld-llm";
  if (obs.platform.kind === "cyberbiz") return "cyberbiz-jsonld-llm";
  return "sitemap-jsonld";
}

function primitiveSummary(symbol: string): string {
  return PRIMITIVE_CATALOGUE.find((entry) => entry.symbol === symbol)
    ?.summary ??
    "";
}

/**
 * Primitives the observations point at, each with the reason. The reason is the
 * point: a suggestion you cannot trace back to something seen on the page is
 * indistinguishable from a guess.
 */
export function suggestedPrimitives(
  obs: PageObservations,
): ReadonlyArray<{ symbol: string; because: string }> {
  const suggestions: Array<{ symbol: string; because: string }> = [];

  if (obs.platform.kind !== "custom") {
    const factory = {
      shopline: "defineShoplineSource",
      cyberbiz: "defineCyberbizSource",
      bvshop: "defineBvShopSource",
    }[obs.platform.kind];
    suggestions.push({
      symbol: factory,
      because: `engine detected: ${obs.platform.evidence.join("; ")}`,
    });
  } else {
    suggestions.push({
      symbol: "customCommercePlatform",
      because: "no known engine signature among the image hosts",
    });
  }

  if (obs.labelImageCandidates.length > 0) {
    suggestions.push({
      symbol: "createCarouselLabelPicker",
      because: `filenames suggest a label image: ${
        obs.labelImageCandidates.slice(0, 3).join(", ")
      }`,
    });
  }

  if (obs.lazyLoadedImageCount > 0) {
    suggestions.push({
      symbol: "buildImageCandidateSelection",
      because:
        `${obs.lazyLoadedImageCount} lazy-loaded images — worth filtering before OCR`,
    });
  }

  if (!obs.hasProductJsonLd) {
    suggestions.push({
      symbol: "readProductHtml",
      because: "no Product JSON-LD found, so the page must be parsed directly",
    });
  }

  return suggestions;
}

/** Human-readable report. `--json` in the CLI bypasses this. */
export function renderReport(obs: PageObservations): string {
  const lines: string[] = [`Observed ${obs.url}`, ""];

  lines.push(`  engine              ${obs.platform.kind}`);
  for (const evidence of obs.platform.evidence) {
    lines.push(`                      └ ${evidence}`);
  }
  if (obs.platform.kind === "custom") {
    lines.push("                      └ no known engine signature");
  }

  lines.push(
    `  Product JSON-LD     ${obs.hasProductJsonLd ? "present" : "absent"}`,
    `  product path        ${obs.productPathSegment ?? "unknown"}`,
    `  lazy-loaded images  ${obs.lazyLoadedImageCount}`,
    `  suggested method    ${suggestedSourceMethod(obs)}`,
    "",
    "  image hosts",
  );

  if (obs.imageHosts.length === 0) {
    lines.push("    none found — check the page really is a product page");
  }
  for (const { host, count } of obs.imageHosts.slice(0, 8)) {
    lines.push(`    ${String(count).padStart(4)}  ${host}`);
  }

  if (obs.labelImageCandidates.length > 0) {
    lines.push("", "  possible label images");
    for (const filename of obs.labelImageCandidates.slice(0, 8)) {
      lines.push(`    ${filename}`);
    }
  }

  lines.push("", "  primitives to reach for");
  for (const { symbol, because } of suggestedPrimitives(obs)) {
    lines.push(`    ${symbol}`);
    lines.push(`      ${primitiveSummary(symbol)}`);
    lines.push(`      because: ${because}`);
  }

  lines.push(
    "",
    "  Observations only. Confirm them against a second product page before",
    "  committing a hint — one page is not a pattern.",
  );

  return lines.join("\n");
}

/** Scaffold flags implied by the observations, ready to paste. */
export function scaffoldFlags(obs: PageObservations): string {
  const host = hostOf(obs.url) ?? "";
  const flags = [
    `--host ${host}`,
    `--platform ${obs.platform.kind}`,
  ];

  if (obs.productPathSegment !== null) {
    flags.push(`--segment ${obs.productPathSegment}`);
  }
  if (obs.platform.kind === "custom" && obs.imageHosts.length > 0) {
    flags.push(`--cdn ${obs.imageHosts[0].host}`);
  }

  return `deno task scaffold --name <name> ${flags.join(" ")}`;
}
