import { assertEquals } from "@std/assert";
import {
  CYBERBIZ_CDN_IMAGE_URL_HINT,
  decideCyberbizContentImageByHtmlContext,
  defineCyberbizSource,
} from "../src/platforms/cyberbiz.ts";
import type { ImageCandidateDropReason } from "../src/kernel/image-candidates.ts";
import { defineShoplineSource } from "../src/platforms/shopline.ts";

const PRODUCT_URL_RE = /^https:\/\/shop\.example\.test\/products\/([^/?#]+)/u;

const baseSpec = {
  name: "example",
  rawHost: "shop.example.test",
  productUrlRegex: PRODUCT_URL_RE,
  imageCandidateSelector: null,
  projectionProviders: { artifactContext: null, structuredFacts: null },
} as const;

Deno.test("defineCyberbizSource applies the engine platform and CDN hint", () => {
  const source = defineCyberbizSource(baseSpec);

  assertEquals(source.commercePlatform.kind, "cyberbiz");
  assertEquals(source.imageUrlHint, CYBERBIZ_CDN_IMAGE_URL_HINT);
});

Deno.test("defineCyberbizSource derives sitemap discovery from rawHost", () => {
  const source = defineCyberbizSource(baseSpec);

  assertEquals(source.catalogDiscovery, {
    kind: "sitemap",
    url: "https://shop.example.test/sitemap.xml",
    productUrlRegex: PRODUCT_URL_RE,
  });
});

Deno.test("defineCyberbizSource prefers a declared siteUrl over rawHost", () => {
  const source = defineCyberbizSource({
    ...baseSpec,
    pipelineFns: { download: { siteUrl: "https://www.other.test/" } },
  });

  assertEquals(
    source.catalogDiscovery?.url,
    "https://www.other.test/sitemap.xml",
  );
});

Deno.test("defineCyberbizSource lets a source override the CDN hint", () => {
  const custom = /assets\.example\.test\//iu;
  const source = defineCyberbizSource({ ...baseSpec, imageUrlHint: custom });

  assertEquals(source.imageUrlHint, custom);
});

Deno.test("defineCyberbizSource honours an explicit null catalog discovery", () => {
  const source = defineCyberbizSource({ ...baseSpec, catalogDiscovery: null });

  assertEquals(source.catalogDiscovery, null);
});

Deno.test("defineCyberbizSource carries excluded slug patterns through", () => {
  const patterns = [/^gift-/u];
  const source = defineCyberbizSource({
    ...baseSpec,
    catalogDiscovery: { excludedSlugPatterns: patterns },
  });

  assertEquals(source.catalogDiscovery?.excludedSlugPatterns, patterns);
});

Deno.test("the CYBERBIZ CDN hint matches regionalised asset hosts", () => {
  assertEquals(
    CYBERBIZ_CDN_IMAGE_URL_HINT.test(
      "https://cdn.cybassets.com/s/files/1/img.jpg",
    ),
    true,
  );
  assertEquals(
    CYBERBIZ_CDN_IMAGE_URL_HINT.test(
      "https://cdn-ap-1.cybassets.com/media/img.jpg",
    ),
    true,
  );
  assertEquals(
    CYBERBIZ_CDN_IMAGE_URL_HINT.test("https://cdn.other.test/media/img.jpg"),
    false,
  );
});

Deno.test("an unrecognised image context yields no verdict, so the image is kept", () => {
  const url = "https://cdn.cybassets.com/media/plain.jpg";
  const html = `<div class="content"><img src="${url}"></div>`;

  assertEquals(decideCyberbizContentImageByHtmlContext(html, url), null);
});

/** Narrows the decision union to the drop reason, or null when kept. */
function dropReason(
  html: string,
  url: string,
): ImageCandidateDropReason | null {
  const decision = decideCyberbizContentImageByHtmlContext(html, url);
  if (decision === null || decision.keep) return null;
  return decision.reason;
}

Deno.test("endorsement imagery is dropped as a story asset", () => {
  const url = "https://cdn.cybassets.com/media/person.jpg";
  const html = `<div class="person_img"><img src="${url}"></div>`;

  assertEquals(dropReason(html, url), "brand_story_asset");
});

Deno.test("editor chrome is dropped as a decorative asset", () => {
  const url = "https://cdn.cybassets.com/media/icon.png";
  const html = `<div class="element_img_icon"><img src="${url}"></div>`;

  assertEquals(dropReason(html, url), "decorative_asset");
});

Deno.test("defineShoplineSource applies its own engine defaults", () => {
  // The selector field is OMITTED here: that is what opts into the engine
  // default. Passing null would mean "deliberately no selection".
  const { imageCandidateSelector: _omitted, ...specWithoutSelector } = baseSpec;
  const source = defineShoplineSource(specWithoutSelector);

  assertEquals(source.commercePlatform.kind, "shopline");
  assertEquals(
    source.catalogDiscovery?.url,
    "https://shop.example.test/sitemap.xml",
  );
  // Unlike CYBERBIZ, this engine does supply a shared pre-OCR selector.
  assertEquals(typeof source.imageCandidateSelector, "function");
});

Deno.test("an explicit null selector survives the SHOPLINE defaults", () => {
  // Distinguishing "omitted" from "explicitly null" is the whole point of the
  // required-but-nullable contract: a source can refuse selection on purpose.
  const source = defineShoplineSource(baseSpec);

  assertEquals(source.imageCandidateSelector, null);
});
