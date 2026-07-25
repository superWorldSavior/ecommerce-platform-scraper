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
import { dirname } from "@std/path/dirname";
import { PoliteFetcher } from "../kernel/http/fetch.ts";
import {
  observePage,
  type PageObservations,
  renderReport,
  scaffoldFlags,
  scaffoldSpecFromObservations,
} from "./inspect-page.ts";
import {
  renderSourceModule,
  ScaffoldSpecError,
} from "./render-source-module.ts";

const HELP = `Inspect a product page and report what it contains.

  deno task inspect <url> [options]

Options
  --file <path>     Read saved HTML instead of fetching. Requires --url.
  --url <url>       The page's URL, when reading from --file.
  --user-agent <s>  Override the User-Agent. Please set a real one.
  --json            Emit JSON instead of a report.
  --scaffold        Generate the skeleton directly. Needs --name.
  --name <slug>     Source identifier, for --scaffold.
  --out <path>      Write the skeleton here instead of stdout.
  --import <spec>   Module specifier the skeleton imports from.
  --force           Overwrite an existing --out file.
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

/**
 * Hands the observations straight to the renderer, so the whole path from a URL
 * to a compiling skeleton is one command. The printed flags remain for when you
 * want to review or adjust them first.
 */
async function emitScaffold(
  obs: PageObservations,
  options: {
    name: string;
    out?: string;
    importSpecifier?: string;
    force: boolean;
  },
): Promise<number> {
  const spec = scaffoldSpecFromObservations(obs, {
    name: options.name,
    ...(options.importSpecifier === undefined
      ? {}
      : { importSpecifier: options.importSpecifier }),
  });

  if (spec === null) {
    console.error(
      "error: the observations do not support a skeleton. A custom storefront needs at least one image host, and none was seen on this page.",
    );
    return 1;
  }

  let contents: string;
  try {
    contents = renderSourceModule(spec);
  } catch (error) {
    if (error instanceof ScaffoldSpecError) {
      console.error(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }

  if (options.out === undefined) {
    console.log(contents);
    return 0;
  }

  if (!options.force) {
    const exists = await Deno.stat(options.out).then(() => true).catch(() =>
      false
    );
    if (exists) {
      console.error(
        `error: ${options.out} already exists. Pass --force to overwrite it.`,
      );
      return 1;
    }
  }

  await Deno.mkdir(dirname(options.out), { recursive: true });
  await Deno.writeTextFile(options.out, contents);
  console.error(`Wrote ${options.out}`);
  console.error(
    "Next: `deno task primitives` to see what else you can reuse, then fill in the parser.",
  );
  return 0;
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs([...argv], {
    string: ["file", "url", "user-agent", "name", "out", "import"],
    boolean: ["json", "scaffold", "force", "help"],
    default: { json: false, scaffold: false, force: false, help: false },
    alias: { h: "help", o: "out" },
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

  if (parsed.scaffold) {
    if (parsed.name === undefined) {
      console.error(
        "error: --scaffold needs --name. The identifier is yours to choose; it cannot be read off the page.",
      );
      return 1;
    }
    return await emitScaffold(observations, {
      name: parsed.name,
      force: parsed.force,
      ...(parsed.out === undefined ? {} : { out: parsed.out }),
      ...(parsed.import === undefined
        ? {}
        : { importSpecifier: parsed.import }),
    });
  }

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
