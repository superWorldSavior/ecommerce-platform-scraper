import { assertEquals } from "@std/assert";
import { createCarouselLabelPicker } from "../src/presets/carousel-label-picker.ts";

const picker = createCarouselLabelPicker({
  slidePathPattern: /\/slides\//iu,
  labelFilenamePattern: /(?:nutrition|supplement)[-_]?facts/iu,
});

const img = (url: string, attr = "src") => `<img ${attr}="${url}">`;

Deno.test("findLabelImageUrl picks the meaningfully named file", () => {
  const html = [
    img("https://cdn.example.test/slides/PROD-001-hero.jpg"),
    img("https://cdn.example.test/slides/PROD-004-nutrition-facts.jpg"),
  ].join("\n");

  assertEquals(
    picker.findLabelImageUrl(html),
    "https://cdn.example.test/slides/PROD-004-nutrition-facts.jpg",
  );
});

Deno.test("findLabelImageUrl returns null when there is no candidate", () => {
  assertEquals(
    picker.findLabelImageUrl(img("https://cdn.example.test/slides/a-hero.jpg")),
    null,
  );
});

Deno.test("listSlideUrls sorts by slide index", () => {
  const html = [
    img("https://cdn.example.test/slides/P-012-c.jpg"),
    img("https://cdn.example.test/slides/P-002-a.jpg"),
    img("https://cdn.example.test/slides/P-007-b.jpg"),
  ].join("\n");

  assertEquals(picker.listSlideUrls(html), [
    "https://cdn.example.test/slides/P-002-a.jpg",
    "https://cdn.example.test/slides/P-007-b.jpg",
    "https://cdn.example.test/slides/P-012-c.jpg",
  ]);
});

Deno.test("listSlideUrls rules out images outside the carousel path", () => {
  const html = [
    img("https://cdn.example.test/ui/logo.png"),
    img("https://cdn.example.test/slides/P-001-a.jpg"),
  ].join("\n");

  assertEquals(picker.listSlideUrls(html), [
    "https://cdn.example.test/slides/P-001-a.jpg",
  ]);
});

Deno.test("listSlideUrls deduplicates repeated galleries", () => {
  const url = "https://cdn.example.test/slides/P-001-a.jpg";
  assertEquals(picker.listSlideUrls([img(url), img(url, "data-src")].join()), [
    url,
  ]);
});

Deno.test("listSlideUrls also reads data-src (lazy loading)", () => {
  assertEquals(
    picker.listSlideUrls(
      img("https://cdn.example.test/slides/P-003-a.jpg", "data-src"),
    ),
    ["https://cdn.example.test/slides/P-003-a.jpg"],
  );
});

Deno.test("a slide with no index comes out first instead of being buried", () => {
  const html = [
    img("https://cdn.example.test/slides/P-005-a.jpg"),
    img("https://cdn.example.test/slides/unindexed.jpg"),
  ].join("\n");

  assertEquals(
    picker.listSlideUrls(html)[0],
    "https://cdn.example.test/slides/unindexed.jpg",
  );
});

Deno.test("without slidePathPattern, every image is a candidate", () => {
  const loose = createCarouselLabelPicker({
    labelFilenamePattern: /facts/iu,
  });

  assertEquals(
    loose.listSlideUrls(img("https://cdn.example.test/anywhere/P-001-a.jpg")),
    ["https://cdn.example.test/anywhere/P-001-a.jpg"],
  );
});
