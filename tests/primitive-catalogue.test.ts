import { assertEquals } from "@std/assert";
import * as toolkit from "../src/mod.ts";
import {
  PRIMITIVE_AXES,
  PRIMITIVE_CATALOGUE,
  primitivesForAxis,
  searchPrimitives,
} from "../src/cli/primitive-catalogue.ts";

/**
 * The test that gives the catalogue its value.
 *
 * A catalogue nobody verifies drifts, and a drifted catalogue is worse than
 * none: a reader trusts it, does not find what they need, and reimplements a
 * primitive that was there all along. So the public surface and the catalogue
 * must describe the same set of symbols, and adding an export without
 * cataloguing it has to fail the suite.
 */
Deno.test("the catalogue covers every public export, and invents none", () => {
  const exported = new Set(Object.keys(toolkit));
  const catalogued = new Set(PRIMITIVE_CATALOGUE.map((e) => e.symbol));

  const missing = [...exported].filter((s) => !catalogued.has(s)).sort();
  const stale = [...catalogued].filter((s) => !exported.has(s)).sort();

  assertEquals(
    missing,
    [],
    `exported but not catalogued — add them to PRIMITIVE_CATALOGUE:\n  ${
      missing.join("\n  ")
    }`,
  );
  assertEquals(
    stale,
    [],
    `catalogued but no longer exported — remove them:\n  ${stale.join("\n  ")}`,
  );
});

Deno.test("every entry is unique", () => {
  const symbols = PRIMITIVE_CATALOGUE.map((e) => e.symbol);
  assertEquals(symbols.length, new Set(symbols).size);
});

Deno.test("every entry carries a usable one-line summary", () => {
  for (const entry of PRIMITIVE_CATALOGUE) {
    const { symbol, summary } = entry;
    assertEquals(
      summary.trim(),
      summary,
      `${symbol}: summary has stray whitespace`,
    );
    assertEquals(
      summary.includes("\n"),
      false,
      `${symbol}: summary must be one line`,
    );
    assertEquals(
      summary.length > 15 && summary.length <= 110,
      true,
      `${symbol}: summary should be between 16 and 110 chars, got ${summary.length}`,
    );
    assertEquals(
      summary.endsWith("."),
      true,
      `${symbol}: summary should end with a period`,
    );
  }
});

Deno.test("every declared axis has at least one entry", () => {
  for (const axis of PRIMITIVE_AXES) {
    assertEquals(
      primitivesForAxis(axis).length > 0,
      true,
      `axis "${axis}" is declared but empty`,
    );
  }
});

Deno.test("every entry sits on a declared axis", () => {
  for (const entry of PRIMITIVE_CATALOGUE) {
    assertEquals(
      PRIMITIVE_AXES.includes(entry.axis),
      true,
      `${entry.symbol}: unknown axis "${entry.axis}"`,
    );
  }
});

Deno.test("search matches on symbol and on summary", () => {
  const bySymbol = searchPrimitives("robots");
  assertEquals(
    bySymbol.map((e) => e.symbol).sort(),
    ["isDisallowed", "parseRobotsTxt"],
  );

  // "carousel" appears only in a summary, not in any symbol name.
  const bySummary = searchPrimitives("carousel");
  assertEquals(
    bySummary.some((e) => e.symbol === "createCarouselLabelPicker"),
    true,
  );
});

Deno.test("search is case-insensitive and returns nothing for a miss", () => {
  assertEquals(searchPrimitives("ROBOTS").length, 2);
  assertEquals(searchPrimitives("zzzznope"), []);
});
