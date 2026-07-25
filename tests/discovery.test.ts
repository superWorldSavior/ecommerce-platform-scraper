import { assertEquals, assertRejects } from "@std/assert";
import {
  CandidatesNotFoundError,
  inMemoryCandidateSource,
  InvalidCandidateError,
  loadCandidateProducts,
  loadCandidateProductsWithMeta,
} from "../src/kernel/discovery.ts";

const query = { sourceSlug: "example", quarter: "2026-Q3" };

Deno.test("loadCandidateProducts validates and projects the rows", async () => {
  const source = inMemoryCandidateSource([
    { productUrl: "https://example.test/p/1", productId: "1" },
    { productUrl: "https://example.test/p/2", productId: "2" },
  ]);

  assertEquals(await loadCandidateProducts(source, query), [
    { url: "https://example.test/p/1", productId: "1" },
    { url: "https://example.test/p/2", productId: "2" },
  ]);
});

Deno.test("loadCandidateProducts preserves the order it received", async () => {
  const source = inMemoryCandidateSource([
    { productUrl: "https://example.test/p/b", productId: "b" },
    { productUrl: "https://example.test/p/a", productId: "a" },
  ]);

  const products = await loadCandidateProducts(source, query);
  assertEquals(products.map((p) => p.productId), ["b", "a"]);
});

Deno.test("an empty source fails loudly", async () => {
  const error = await assertRejects(
    () => loadCandidateProducts(inMemoryCandidateSource([]), query),
    CandidatesNotFoundError,
  );
  assertEquals(error.query, query);
});

Deno.test("a missing URL reports the offending field", async () => {
  const error = await assertRejects(
    () =>
      loadCandidateProducts(
        inMemoryCandidateSource([{ productUrl: null, productId: "1" }]),
        query,
      ),
    InvalidCandidateError,
  );
  assertEquals(error.field, "productUrl");
  assertEquals(error.index, 0);
});

Deno.test("an empty URL is treated as missing", async () => {
  const error = await assertRejects(
    () =>
      loadCandidateProducts(
        inMemoryCandidateSource([{ productUrl: "", productId: "1" }]),
        query,
      ),
    InvalidCandidateError,
  );
  assertEquals(error.field, "productUrl");
});

Deno.test("a missing productId is reported at its index", async () => {
  const error = await assertRejects(
    () =>
      loadCandidateProducts(
        inMemoryCandidateSource([
          { productUrl: "https://example.test/p/1", productId: "1" },
          { productUrl: "https://example.test/p/2", productId: null },
        ]),
        query,
      ),
    InvalidCandidateError,
  );
  assertEquals(error.field, "productId");
  assertEquals(error.index, 1);
});

Deno.test("domain metadata travels through the kernel untouched", async () => {
  interface Meta {
    catalogId: string;
  }

  const source = inMemoryCandidateSource<Meta>([
    {
      productUrl: "https://example.test/p/1",
      productId: "1",
      meta: { catalogId: "cat-9" },
    },
  ]);

  const products = await loadCandidateProductsWithMeta(source, query);
  assertEquals(products[0].meta, { catalogId: "cat-9" });
});
