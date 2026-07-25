import { assertEquals, assertStringIncludes } from "@std/assert";
import {
  observePage,
  renderReport,
  scaffoldFlags,
  suggestedPrimitives,
  suggestedSourceMethod,
} from "../src/cli/inspect-page.ts";

const PRODUCT_URL = "https://shop.example.test/products/thing";

const page = (body: string, head = "") =>
  `<html><head>${head}</head><body>${body}</body></html>`;

const productJsonLd =
  `<script type="application/ld+json">{"@type":"Product","name":"T"}</script>`;

Deno.test("a SHOPLINE page is recognised from its image hosts", () => {
  const obs = observePage(
    PRODUCT_URL,
    page(`<img src="https://shoplineimg.com/store/a/800x.jpg">`),
  );

  assertEquals(obs.platform.kind, "shopline");
  assertStringIncludes(obs.platform.evidence[0], "shoplineimg.com");
});

Deno.test("a CYBERBIZ page is recognised, including a regionalised host", () => {
  const obs = observePage(
    PRODUCT_URL,
    page(`<img src="https://cdn-ap-1.cybassets.com/media/a.jpg">`),
  );

  assertEquals(obs.platform.kind, "cyberbiz");
});

Deno.test("a BV SHOP page cites the item path as extra evidence", () => {
  const obs = observePage(
    "https://shop.example.test/item/thing",
    page(`<img src="https://image.bvshop.tw/42/product/a.jpg">`),
  );

  assertEquals(obs.platform.kind, "bvshop");
  assertEquals(obs.platform.evidence.length, 2);
  assertStringIncludes(obs.platform.evidence[1], "/item/");
});

Deno.test("an unknown host yields custom, with no invented evidence", () => {
  const obs = observePage(
    PRODUCT_URL,
    page(`<img src="https://cdn.bespoke.test/a.jpg">`),
  );

  assertEquals(obs.platform.kind, "custom");
  assertEquals(obs.platform.evidence, []);
});

Deno.test("image hosts are counted and ordered by frequency", () => {
  const obs = observePage(
    PRODUCT_URL,
    page(`
      <img src="https://a.test/1.jpg">
      <img src="https://b.test/1.jpg">
      <img src="https://b.test/2.jpg">
    `),
  );

  assertEquals(obs.imageHosts, [
    { host: "b.test", count: 2 },
    { host: "a.test", count: 1 },
  ]);
});

Deno.test("Product JSON-LD is detected, and its absence reported", () => {
  assertEquals(
    observePage(PRODUCT_URL, page("", productJsonLd)).hasProductJsonLd,
    true,
  );
  assertEquals(observePage(PRODUCT_URL, page("")).hasProductJsonLd, false);
});

Deno.test("a non-Product JSON-LD block does not count", () => {
  const breadcrumb =
    `<script type="application/ld+json">{"@type":"BreadcrumbList"}</script>`;

  assertEquals(
    observePage(PRODUCT_URL, page("", breadcrumb)).hasProductJsonLd,
    false,
  );
});

Deno.test("a malformed Product block still counts as present", () => {
  // Malformed JSON-LD is common in the wild. Reporting "absent" for a block
  // that is plainly there would send the reader down the html-direct path for
  // no reason.
  const malformed =
    `<script type="application/ld+json">{"@type": "Product", "name": }</script>`;

  assertEquals(
    observePage(PRODUCT_URL, page("", malformed)).hasProductJsonLd,
    true,
  );
});

Deno.test("the product path segment is read from the URL", () => {
  assertEquals(
    observePage(PRODUCT_URL, page("")).productPathSegment,
    "products",
  );
  assertEquals(
    observePage("https://x.test/item/thing", page("")).productPathSegment,
    "item",
  );
  assertEquals(
    observePage("https://x.test/thing", page("")).productPathSegment,
    null,
  );
});

Deno.test("label-like filenames are surfaced, others ignored", () => {
  const obs = observePage(
    PRODUCT_URL,
    page(`
      <img src="https://a.test/p-nutrition-facts.jpg">
      <img src="https://a.test/p-specifications.png">
      <img src="https://a.test/p-hero.jpg">
    `),
  );

  assertEquals(obs.labelImageCandidates, [
    "p-nutrition-facts.jpg",
    "p-specifications.png",
  ]);
});

Deno.test("lazy-loaded images are counted separately", () => {
  const obs = observePage(
    PRODUCT_URL,
    page(`
      <img src="https://a.test/1.jpg">
      <img data-src="https://a.test/2.jpg">
      <img data-src="https://a.test/3.jpg">
    `),
  );

  assertEquals(obs.lazyLoadedImageCount, 2);
});

Deno.test("the suggested method follows the JSON-LD and the engine", () => {
  const shopline = observePage(
    PRODUCT_URL,
    page(`<img src="https://shoplineimg.com/a/1.jpg">`, productJsonLd),
  );
  assertEquals(suggestedSourceMethod(shopline), "shopline-jsonld-llm");

  const noJsonLd = observePage(
    PRODUCT_URL,
    page(`<img src="https://shoplineimg.com/a/1.jpg">`),
  );
  assertEquals(suggestedSourceMethod(noJsonLd), "html-direct");

  const plainWithJsonLd = observePage(
    PRODUCT_URL,
    page(`<img src="https://cdn.bespoke.test/1.jpg">`, productJsonLd),
  );
  assertEquals(suggestedSourceMethod(plainWithJsonLd), "sitemap-jsonld");
});

Deno.test("every suggestion carries a traceable reason", () => {
  const obs = observePage(
    PRODUCT_URL,
    page(
      `<img data-src="https://shoplineimg.com/a/p-nutrition-facts.jpg">`,
      productJsonLd,
    ),
  );

  const suggestions = suggestedPrimitives(obs);
  assertEquals(suggestions.length > 0, true);
  for (const { because } of suggestions) {
    // A suggestion without a reason is a guess wearing a suit.
    assertEquals(because.trim().length > 0, true);
  }
  assertEquals(
    suggestions.map((s) => s.symbol).includes("defineShoplineSource"),
    true,
  );
});

Deno.test("a custom page is pointed at customCommercePlatform", () => {
  const obs = observePage(
    PRODUCT_URL,
    page(`<img src="https://cdn.bespoke.test/1.jpg">`),
  );

  assertEquals(
    suggestedPrimitives(obs).map((s) => s.symbol).includes(
      "customCommercePlatform",
    ),
    true,
  );
});

Deno.test("the scaffold command carries the observed values", () => {
  const obs = observePage(
    PRODUCT_URL,
    page(`<img src="https://cdn.bespoke.test/1.jpg">`),
  );
  const command = scaffoldFlags(obs);

  assertStringIncludes(command, "--host shop.example.test");
  assertStringIncludes(command, "--platform custom");
  assertStringIncludes(command, "--segment products");
  // Custom needs a CDN, and the busiest observed host is the best evidence.
  assertStringIncludes(command, "--cdn cdn.bespoke.test");
});

Deno.test("the report says so when no images were found at all", () => {
  const report = renderReport(observePage(PRODUCT_URL, page("")));

  assertStringIncludes(report, "none found");
});

Deno.test("the report states its own limits", () => {
  const report = renderReport(
    observePage(PRODUCT_URL, page(`<img src="https://a.test/1.jpg">`)),
  );

  assertStringIncludes(report, "Observations only");
  assertStringIncludes(report, "one page is not a pattern");
});
