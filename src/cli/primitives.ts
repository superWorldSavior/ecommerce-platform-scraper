/**
 * `deno task primitives` — ask what already exists.
 *
 * ```
 * deno task primitives                      # everything, grouped by axis
 * deno task primitives --axis images        # one axis
 * deno task primitives --search robots      # substring over symbol and summary
 * deno task primitives --json               # machine-readable
 * ```
 *
 * Run this **before** writing an adapter. The failure mode this exists to
 * prevent is reimplementing a primitive that was already there — which happens
 * because documentation gets skimmed, not because anyone chose to. A command
 * that answers in one line is harder to skip than a page, and a test guarantees
 * its answer matches the real exports.
 */

import { parseArgs } from "@std/cli/parse-args";
import {
  PRIMITIVE_AXES,
  PRIMITIVE_CATALOGUE,
  type PrimitiveAxis,
  type PrimitiveEntry,
  primitivesForAxis,
  searchPrimitives,
} from "./primitive-catalogue.ts";

const HELP = `List the primitives this toolkit already provides.

  deno task primitives [options]

Options
  --axis <name>     Restrict to one axis: ${PRIMITIVE_AXES.join(", ")}
  --search <text>   Substring match over symbol names and summaries.
  --json            Emit JSON instead of a table.
  --help            Show this.

Run it before writing an adapter. If something here covers your case, import it
rather than rewriting it.
`;

function widestSymbol(entries: readonly PrimitiveEntry[]): number {
  return entries.reduce((max, entry) => Math.max(max, entry.symbol.length), 0);
}

function renderGrouped(entries: readonly PrimitiveEntry[]): string {
  const width = widestSymbol(entries);
  const lines: string[] = [];

  for (const axis of PRIMITIVE_AXES) {
    const onAxis = entries.filter((entry) => entry.axis === axis);
    if (onAxis.length === 0) continue;

    lines.push("", `${axis}`, "─".repeat(axis.length));
    for (const entry of onAxis) {
      lines.push(`  ${entry.symbol.padEnd(width)}  ${entry.summary}`);
    }
  }

  return lines.join("\n").trimStart();
}

export function run(argv: readonly string[]): { output: string; code: number } {
  const parsed = parseArgs([...argv], {
    string: ["axis", "search"],
    boolean: ["json", "help"],
    default: { json: false, help: false },
    alias: { h: "help", a: "axis", s: "search" },
  });

  if (parsed.help) return { output: HELP, code: 0 };

  let entries: readonly PrimitiveEntry[] = PRIMITIVE_CATALOGUE;

  if (parsed.axis !== undefined) {
    if (!PRIMITIVE_AXES.includes(parsed.axis as PrimitiveAxis)) {
      return {
        output: `error: unknown axis "${parsed.axis}". Expected one of: ${
          PRIMITIVE_AXES.join(", ")
        }.`,
        code: 1,
      };
    }
    entries = primitivesForAxis(parsed.axis as PrimitiveAxis);
  }

  if (parsed.search !== undefined) {
    const matches = new Set(
      searchPrimitives(parsed.search).map((entry) => entry.symbol),
    );
    entries = entries.filter((entry) => matches.has(entry.symbol));
  }

  if (parsed.json) {
    return { output: JSON.stringify(entries, null, 2), code: 0 };
  }

  if (entries.length === 0) {
    // Not an error: "nothing covers this" is a useful answer, and it is the
    // green light to write something local.
    return {
      output: "No primitive matches. Nothing here covers that case yet.",
      code: 0,
    };
  }

  const header =
    `${entries.length} of ${PRIMITIVE_CATALOGUE.length} primitives`;
  return { output: `${header}\n${renderGrouped(entries)}`, code: 0 };
}

if (import.meta.main) {
  const { output, code } = run(Deno.args);
  (code === 0 ? console.log : console.error)(output);
  Deno.exit(code);
}
