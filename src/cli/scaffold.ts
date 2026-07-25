/**
 * Interactive scaffold: asks a handful of questions, writes a `SourceModule`
 * skeleton.
 *
 * ```
 * deno task scaffold
 * deno task scaffold --out sources/example/mod.ts
 * ```
 *
 * Every answer can also be passed as a flag, so the same command works
 * unattended in a script or a test:
 *
 * ```
 * deno task scaffold --name example --host shop.example.test \
 *   --platform shopline --out sources/example/mod.ts --yes
 * ```
 *
 * Only prompts for what the flags did not supply. With `--yes` it never
 * prompts, and a missing required answer is an error rather than a silent
 * default — the wrong `rawHost` guessed for you costs a whole scrape run.
 *
 * The generation itself lives in `render-source-module.ts` and is pure; this
 * file is only terminal plumbing.
 */

import { parseArgs } from "@std/cli/parse-args";
import { dirname } from "@std/path/dirname";
import {
  renderSourceModule,
  type ScaffoldSpec,
  ScaffoldSpecError,
} from "./render-source-module.ts";
import type { CommercePlatformKind } from "../kernel/commerce-platform.ts";

const PLATFORMS: readonly CommercePlatformKind[] = [
  "shopline",
  "cyberbiz",
  "bvshop",
  "custom",
];

const DEFAULT_IMPORT_SPECIFIER = "jsr:@casys/ecommerce-platform-scraper";

interface Flags {
  name?: string;
  host?: string;
  siteUrl?: string;
  platform?: string;
  label?: string;
  cdn?: string;
  segment?: string;
  catalog?: boolean;
  import?: string;
  out?: string;
  yes: boolean;
  force: boolean;
  help: boolean;
}

const HELP = `Scaffold a SourceModule skeleton.

  deno task scaffold [options]

Options
  --name <slug>        Source identifier, lowercase ASCII.
  --host <hostname>    Storage host, e.g. shop.example.test
  --site-url <url>     Site root. Defaults to https://<host>
  --platform <kind>    ${PLATFORMS.join(" | ")}
  --label <text>       Engine label, custom only. Defaults to the name.
  --cdn <hostname>     Asset CDN host. Required for custom.
  --segment <path>     Path before the product slug. Default: products
  --catalog / --no-catalog
                       Whether a sitemap catalog exists. Default: yes
  --import <specifier> Module specifier the file imports from.
  --out <path>         Where to write. Default: stdout.
  --force              Overwrite an existing file.
  --yes                Never prompt; error on a missing required answer.
  --help               Show this.
`;

function ask(question: string, fallback?: string): string {
  const suffix = fallback === undefined ? "" : ` (${fallback})`;
  const answer = prompt(`${question}${suffix}:`)?.trim();
  if (answer) return answer;
  if (fallback !== undefined) return fallback;
  throw new ScaffoldSpecError(`${question} is required.`);
}

function askPlatform(): CommercePlatformKind {
  console.log("\nWhich commerce engine does the site run on?");
  console.log("  Not sure? Check the product URL shape and the image CDN:");
  console.log("    /products/<slug> + shoplineimg.com     → shopline");
  console.log("    /products/<slug> + cybassets.com       → cyberbiz");
  console.log("    /item/<slug>     + image.bvshop.tw     → bvshop");
  console.log("    anything else                          → custom\n");

  PLATFORMS.forEach((platform, index) => {
    console.log(`  ${index + 1}) ${platform}`);
  });

  const raw = ask("Engine", "custom").toLowerCase();
  const byNumber = PLATFORMS[Number(raw) - 1];
  const chosen = byNumber ?? raw;

  if (!PLATFORMS.includes(chosen as CommercePlatformKind)) {
    throw new ScaffoldSpecError(
      `Unknown engine "${raw}". Expected one of: ${PLATFORMS.join(", ")}.`,
    );
  }
  return chosen as CommercePlatformKind;
}

function requireFlag(value: string | undefined, flag: string): string {
  if (value === undefined || value.length === 0) {
    throw new ScaffoldSpecError(`--${flag} is required with --yes.`);
  }
  return value;
}

/** Builds the spec from flags, prompting only for what is missing. */
export function collectSpec(flags: Flags): ScaffoldSpec {
  const interactive = !flags.yes;

  const name = flags.name ??
    (interactive ? ask("Source name") : requireFlag(flags.name, "name"));
  const rawHost = flags.host ??
    (interactive ? ask("Storage host") : requireFlag(flags.host, "host"));
  const siteUrl = flags.siteUrl ??
    (interactive
      ? ask("Site root URL", `https://${rawHost}`)
      : `https://${rawHost}`);

  const platform = (flags.platform ??
    (interactive ? askPlatform() : "custom")) as CommercePlatformKind;

  if (!PLATFORMS.includes(platform)) {
    throw new ScaffoldSpecError(
      `Unknown engine "${platform}". Expected one of: ${PLATFORMS.join(", ")}.`,
    );
  }

  const isCustom = platform === "custom";
  const defaultSegment = platform === "bvshop" ? "item" : "products";

  const segment = flags.segment ??
    (interactive
      ? ask("Product path segment", defaultSegment)
      : defaultSegment);

  const imageCdnHost = flags.cdn ??
    (isCustom
      ? interactive ? ask("Asset CDN host") : requireFlag(flags.cdn, "cdn")
      : undefined);

  const customLabel = isCustom
    ? flags.label ?? (interactive ? ask("Engine label", name) : name)
    : undefined;

  const catalogDiscovery = flags.catalog ??
    (interactive ? confirm("Does the site expose a sitemap catalog?") : true);

  return {
    name,
    rawHost,
    siteUrl,
    platform,
    productPathSegment: segment,
    catalogDiscovery,
    importSpecifier: flags.import ?? DEFAULT_IMPORT_SPECIFIER,
    ...(imageCdnHost === undefined ? {} : { imageCdnHost }),
    ...(customLabel === undefined ? {} : { customLabel }),
  };
}

async function write(path: string, contents: string, force: boolean) {
  if (!force) {
    const exists = await Deno.stat(path).then(() => true).catch(() => false);
    if (exists) {
      throw new ScaffoldSpecError(
        `${path} already exists. Pass --force to overwrite it.`,
      );
    }
  }
  await Deno.mkdir(dirname(path), { recursive: true });
  await Deno.writeTextFile(path, contents);
}

export async function main(argv: readonly string[]): Promise<number> {
  const parsed = parseArgs([...argv], {
    string: [
      "name",
      "host",
      "site-url",
      "platform",
      "label",
      "cdn",
      "segment",
      "import",
      "out",
    ],
    boolean: ["catalog", "yes", "force", "help"],
    // `catalog` must be declared negatable for `--no-catalog` to reach us as
    // `false`; without this it would land as a stray `no-catalog` flag and be
    // silently ignored.
    negatable: ["catalog"],
    default: { catalog: undefined, yes: false, force: false, help: false },
    alias: { h: "help", y: "yes", o: "out" },
  });

  const flags: Flags = {
    name: parsed.name,
    host: parsed.host,
    siteUrl: parsed["site-url"],
    platform: parsed.platform,
    label: parsed.label,
    cdn: parsed.cdn,
    segment: parsed.segment,
    catalog: parsed.catalog,
    import: parsed.import,
    out: parsed.out,
    yes: parsed.yes,
    force: parsed.force,
    help: parsed.help,
  };

  if (flags.help) {
    console.log(HELP);
    return 0;
  }

  try {
    const contents = renderSourceModule(collectSpec(flags));

    if (flags.out === undefined) {
      console.log(contents);
    } else {
      await write(flags.out, contents, flags.force);
      console.error(`Wrote ${flags.out}`);
      console.error(
        "Next: run `deno check` on it, then fill in the parser and the artifact context.",
      );
    }
    return 0;
  } catch (error) {
    if (error instanceof ScaffoldSpecError) {
      console.error(`error: ${error.message}`);
      return 1;
    }
    throw error;
  }
}

if (import.meta.main) {
  Deno.exit(await main(Deno.args));
}
