/**
 * `deno task inspect <url>` — look at a real product page and report what is
 * there, instead of asking you to guess.
 *
 * ```
 * deno task inspect https://shop.example.test/products/thing
 * deno task inspect --file page.html --url https://shop.example.test/products/thing
 * deno task inspect <url> --json
 * ```
 *
 * Answers the questions the scaffold would otherwise ask you blind: which
 * engine, which image CDN, is there Product JSON-LD, does a label image exist.
 * It ends by printing the `scaffold` command its observations imply.
 *
 * `--file` reads a saved page instead of fetching, which is the right mode when
 * you already have the HTML — no reason to hit someone's server twice.
 *
 * Fetching uses the toolkit's own rate-limited client, so this command obeys the
 * same courtesy as the pipeline it prepares.
 */

import { parseArgs } from "@std/cli/parse-args";
import { PoliteFetcher } from "../kernel/http/fetch.ts";
import { observePage, renderReport, scaffoldFlags } from "./inspect-page.ts";

const HELP = `Inspect a product page and report what it contains.

  deno task inspect <url> [options]

Options
  --file <path>     Read saved HTML instead of fetching. Requires --url.
  --url <url>       The page's URL, when reading from --file.
  --user-agent <s>  Override the User-Agent. Please set a real one.
  --json            Emit JSON instead of a report.
  --help            Show this.

Observations only. Confirm them against a second page before committing a hint.
`;

async function loadHtml(
  args: { file?: string; url: string; userAgent?: string },
): Promise<string> {
  if (args.file !== undefined) return await Deno.readTextFile(args.file);

  const fetcher = new PoliteFetcher(
    args.userAgent === undefined ? {} : { userAgent: args.userAgent },
  );
  return await fetcher.fetchText(args.url);
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs([...argv], {
    string: ["file", "url", "user-agent"],
    boolean: ["json", "help"],
    default: { json: false, help: false },
    alias: { h: "help" },
  });

  if (parsed.help) {
    console.log(HELP);
    return 0;
  }

  const url = parsed.url ?? parsed._[0]?.toString();
  if (url === undefined) {
    console.error("error: a URL is required. See --help.");
    return 1;
  }
  if (parsed.file !== undefined && parsed.url === undefined) {
    console.error(
      "error: --file needs --url too. The URL is what tells us the product path shape.",
    );
    return 1;
  }

  let html: string;
  try {
    html = await loadHtml({
      url,
      ...(parsed.file === undefined ? {} : { file: parsed.file }),
      ...(parsed["user-agent"] === undefined
        ? {}
        : { userAgent: parsed["user-agent"] }),
    });
  } catch (error) {
    console.error(
      `error: could not read the page: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
    return 1;
  }

  const observations = observePage(url, html);

  if (parsed.json) {
    console.log(JSON.stringify(observations, null, 2));
    return 0;
  }

  console.log(renderReport(observations));
  console.log("");
  console.log("  scaffold command implied by the above");
  console.log(`    ${scaffoldFlags(observations)}`);

  return 0;
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
