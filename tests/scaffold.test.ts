import {
  assert,
  assertEquals,
  assertStringIncludes,
  assertThrows,
} from "@std/assert";
import {
  renderSourceModule,
  type ScaffoldSpec,
  ScaffoldSpecError,
} from "../src/cli/render-source-module.ts";
import { collectSpec } from "../src/cli/scaffold.ts";

const TOOLKIT = new URL("../src/mod.ts", import.meta.url).href;

const base: ScaffoldSpec = {
  name: "example",
  rawHost: "shop.example.test",
  siteUrl: "https://shop.example.test",
  platform: "shopline",
  productPathSegment: "products",
  catalogDiscovery: true,
  importSpecifier: TOOLKIT,
};

const custom: ScaffoldSpec = {
  ...base,
  name: "bespoke",
  platform: "custom",
  imageCdnHost: "cdn.bespoke.test",
  customLabel: "Bespoke engine",
};

Deno.test("a known engine renders a call to that engine's factory", () => {
  const out = renderSourceModule(base);

  assertStringIncludes(out, "defineShoplineSource({");
  assertStringIncludes(out, 'name: "example"');
  // The factory supplies these, so the skeleton must not restate them.
  assert(!out.includes("commercePlatform:"));
  assert(!out.includes("imageUrlHint:"));
});

Deno.test("cyberbiz and bvshop each get their own factory", () => {
  assertStringIncludes(
    renderSourceModule({ ...base, platform: "cyberbiz" }),
    "defineCyberbizSource({",
  );
  assertStringIncludes(
    renderSourceModule({
      ...base,
      platform: "bvshop",
      productPathSegment: "item",
    }),
    "defineBvShopSource({",
  );
});

Deno.test("a custom source spells out every contract field", () => {
  const out = renderSourceModule(custom);

  assertStringIncludes(out, "satisfies SourceModule");
  assertStringIncludes(out, 'customCommercePlatform("Bespoke engine")');
  assertStringIncludes(out, "imageUrlHint: /cdn\\.bespoke\\.test\\//iu");
  assertStringIncludes(out, "imageCandidateSelector: null");
  assertStringIncludes(out, "artifactContext: null");
  assertStringIncludes(out, "structuredFacts: null");
});

Deno.test("the product URL pattern escapes the host and honours the segment", () => {
  const out = renderSourceModule({ ...base, productPathSegment: "p" });

  assertStringIncludes(
    out,
    "/^https:\\/\\/shop\\.example\\.test\\/p\\/([^/?#]+)/u",
  );
});

Deno.test("no catalog renders an explicit null, on both shapes", () => {
  assertStringIncludes(
    renderSourceModule({ ...base, catalogDiscovery: false }),
    "catalogDiscovery: null",
  );
  assertStringIncludes(
    renderSourceModule({ ...custom, catalogDiscovery: false }),
    "CatalogDiscoverySource | null = null",
  );
});

Deno.test("a custom source without a CDN host is refused", () => {
  const { imageCdnHost: _dropped, ...withoutCdn } = custom;

  const error = assertThrows(
    () => renderSourceModule(withoutCdn as ScaffoldSpec),
    ScaffoldSpecError,
  );
  assertStringIncludes(error.message, "imageCdnHost");
});

Deno.test("an invalid name is refused rather than emitted", () => {
  for (const name of ["Example", "9lives", "with space", ""]) {
    assertThrows(
      () => renderSourceModule({ ...base, name }),
      ScaffoldSpecError,
    );
  }
});

Deno.test("a host carrying a scheme or a path is refused", () => {
  for (const rawHost of ["https://shop.example.test", "shop.example.test/x"]) {
    assertThrows(
      () => renderSourceModule({ ...base, rawHost }),
      ScaffoldSpecError,
    );
  }
});

Deno.test("collectSpec defaults siteUrl from the host", () => {
  const spec = collectSpec({
    name: "example",
    host: "shop.example.test",
    platform: "shopline",
    yes: true,
    force: false,
    help: false,
  });

  assertEquals(spec.siteUrl, "https://shop.example.test");
  assertEquals(spec.productPathSegment, "products");
  assertEquals(spec.catalogDiscovery, true);
});

Deno.test("collectSpec defaults the BV SHOP path segment to item", () => {
  const spec = collectSpec({
    name: "example",
    host: "shop.example.test",
    platform: "bvshop",
    yes: true,
    force: false,
    help: false,
  });

  assertEquals(spec.productPathSegment, "item");
});

Deno.test("collectSpec refuses an unknown engine", () => {
  assertThrows(
    () =>
      collectSpec({
        name: "example",
        host: "shop.example.test",
        platform: "magento",
        yes: true,
        force: false,
        help: false,
      }),
    ScaffoldSpecError,
  );
});

Deno.test("collectSpec requires a name when not prompting", () => {
  assertThrows(
    () =>
      collectSpec({
        host: "shop.example.test",
        yes: true,
        force: false,
        help: false,
      }),
    ScaffoldSpecError,
  );
});

/**
 * The one test that matters most: a skeleton that does not compile is worse
 * than no skeleton. Both shapes are written to disk and type-checked for real.
 */
Deno.test({
  name: "both generated shapes type-check",
  permissions: { read: true, write: true, run: true, env: true },
  async fn() {
    const dir = await Deno.makeTempDir({ prefix: "scaffold-test-" });

    try {
      const paths: string[] = [];
      for (
        const [label, spec] of [["platform", base], ["custom", custom]] as const
      ) {
        const path = `${dir}/${label}.ts`;
        await Deno.writeTextFile(path, renderSourceModule(spec));
        paths.push(path);
      }

      const { success, stderr } = await new Deno.Command(Deno.execPath(), {
        args: ["check", ...paths],
        stderr: "piped",
        stdout: "null",
      }).output();

      assert(
        success,
        `generated skeletons failed to type-check:\n${
          new TextDecoder().decode(stderr)
        }`,
      );
    } finally {
      await Deno.remove(dir, { recursive: true });
    }
  },
});
