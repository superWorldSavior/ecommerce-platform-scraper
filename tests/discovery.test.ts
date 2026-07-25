import { assertEquals, assertRejects } from "@std/assert";
import {
  CandidatesNotFoundError,
  inMemoryCandidateSource,
  InvalidCandidateError,
  loadCandidateProducts,
  loadCandidateProductsWithMeta,
} from "../src/kernel/discovery.ts";

const query = { sourceSlug: "example", quarter: "2026-Q3" };

Deno.test("loadCandidateProducts valide et projette les lignes", async () => {
  const source = inMemoryCandidateSource([
    { productUrl: "https://example.test/p/1", productId: "1" },
    { productUrl: "https://example.test/p/2", productId: "2" },
  ]);

  assertEquals(await loadCandidateProducts(source, query), [
    { url: "https://example.test/p/1", productId: "1" },
    { url: "https://example.test/p/2", productId: "2" },
  ]);
});

Deno.test("loadCandidateProducts préserve l'ordre reçu", async () => {
  const source = inMemoryCandidateSource([
    { productUrl: "https://example.test/p/b", productId: "b" },
    { productUrl: "https://example.test/p/a", productId: "a" },
  ]);

  const products = await loadCandidateProducts(source, query);
  assertEquals(products.map((p) => p.productId), ["b", "a"]);
});

Deno.test("une source vide échoue fort", async () => {
  const error = await assertRejects(
    () => loadCandidateProducts(inMemoryCandidateSource([]), query),
    CandidatesNotFoundError,
  );
  assertEquals(error.query, query);
});

Deno.test("une URL manquante échoue avec le champ fautif", async () => {
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

Deno.test("une URL vide est traitée comme manquante", async () => {
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

Deno.test("un productId manquant est signalé à son index", async () => {
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

Deno.test("les métadonnées du domaine traversent le kernel intactes", async () => {
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
