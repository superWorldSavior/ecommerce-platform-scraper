# ecommerce-platform-scraper

**English** · [简体中文](README.zh-Hans.md) · [繁體中文](README.zh-Hant.md)

Scraping toolkit for e-commerce storefronts, organised **by platform**.

Most storefronts don't run on bespoke code — they run on a commerce SaaS. Sites
sharing an engine share URL shapes, CDN patterns, sitemap layout and gallery
markup. This toolkit treats that engine as the unit of reuse: you declare which
platform a site runs on, inherit its defaults, and override only what's actually
different.

It is **domain-agnostic**. Nothing here knows what you're extracting — the role
vocabulary, the extraction schema and the output model are all yours.

## Why it might interest you

- **Platform adapters, not site scripts.** Onboarding a site on a supported
  engine is a declaration, not a new parser.
- **Multimodal and multi-model.** Regulatory and spec information often lives in
  an _image_ — a photo of the back of the box — not in the HTML. The toolkit
  routes text to one model and images to a separate vision model, over any
  OpenAI-compatible endpoint. Swapping provider or model is environment
  configuration, not a code change.
- **Explicit absence.** Capability fields are required-but-nullable: `null`
  means "deliberately absent and audited". Adding a capability to the contract
  breaks compilation on every source that forgot it, so nothing is silently
  skipped.
- **Fails loud.** An empty candidate list throws instead of scraping nothing —
  the failure mode that otherwise costs you a full run before you notice.

## Install

Requires [Deno](https://deno.com/) 2.x.

```ts
import {
  defineShoplineSource,
  PoliteFetcher,
} from "jsr:@casys/ecommerce-platform-scraper";
```

## Quick start

Declare a source on a supported platform:

```ts
import { defineShoplineSource } from "./src/platforms/shopline.ts";

export const source = defineShoplineSource({
  name: "example",
  rawHost: "shop.example.test",
  productUrlRegex: /^https:\/\/shop\.example\.test\/products\/([^/?#]+)/u,
  imageCandidateSelector: null,
  projectionProviders: { artifactContext: null, structuredFacts: null },
  pipelineFns: { download: { siteUrl: "https://shop.example.test" } },
});
```

The Shopline defaults — dual-CDN image hint, pre-OCR image selector, sitemap
discovery at `/sitemap.xml` — are filled in. Overrides win over defaults.

Crawl politely, and check `robots.txt` while you're at it:

```ts
import { isDisallowed, parseRobotsTxt, PoliteFetcher } from "./src/mod.ts";

const fetcher = new PoliteFetcher({
  // Identify yourself and leave a way to be reached. Reachable operators get
  // blocked far less often than anonymous ones.
  userAgent: "acme-bot/1.0 (+https://acme.example/bot)",
  minIntervalMs: 1_000,
});

const rules = parseRobotsTxt(await (await fetch(robotsUrl)).text());
if (!isDisallowed(rules, "/products/")) {
  const page = await fetcher.fetchText(productUrl);
}
```

## Scaffolding a new source

`deno task scaffold` asks a handful of questions and writes a `SourceModule`
skeleton — every field present, each one annotated with the primitive that
belongs there.

```
deno task scaffold --out sources/example/mod.ts
```

Answers can also be passed as flags, so the same command works unattended:

```
deno task scaffold --yes --name example --host shop.example.test \
  --platform shopline --out sources/example/mod.ts
```

Two shapes come out of it. On a **known engine** you get a call to that engine's
factory, declaring only what the engine cannot infer. On **custom** you get the
full contract spelled out, because there is no engine to inherit from and
nothing can be filled in for you.

Note the difference from a factory: a scaffold generates code you then edit,
whereas a factory hides code you never write. For a site with no shared engine
there is nothing to hide, so the skeleton shows everything. What it cannot do is
guess how your site's HTML yields a product — that part stays yours.

The skeleton comes out with `null` in every capability field, which is a valid
answer rather than a placeholder.
**[Choosing primitives](docs/choosing-primitives.md)** is how you decide what to
put there, and when leaving `null` is the right call.

## Platform support

| Platform     | What ships                                                                                    | Maturity                                                                               |
| ------------ | --------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| **SHOPLINE** | `defineShoplineSource()` — engine defaults including a shared pre-OCR image selector          | Best supported. Widest reach by far: SHOPLINE serves merchants across APAC and beyond. |
| **BV SHOP**  | `defineBvShopSource()`, plus the `item/query` JSON companion endpoint and its cookie handling | Solid, but a small Taiwan-only platform. Niche unless you scrape there.                |
| **CYBERBIZ** | `defineCyberbizSource()`, plus markup-context image classification                            | Good. Image selection is deliberately left to each source — see below.                 |

**Why CYBERBIZ does not default the image selector.** On this engine, page
bodies come out of a rich-text editor, and stores differ widely in how much
marketing imagery they push into it. No single keep/drop rule holds across
stores, so `imageCandidateSelector` stays required and each source composes its
own from the helpers in the module. Supplying a default would paper over a real
difference between storefronts, which is worse than asking the caller to decide.
SHOPLINE markup is uniform enough that the same question has one shared answer,
which is why its factory _does_ default it.

## Architecture

```
kernel/          source contract, discovery, sitemap, HTTP, raw storage,
                 image candidates, artifact context
  llm/           multi-model client, text/vision routing, typed errors
  ocr/           OcrProvider interface + Apple Vision implementation
platforms/       shopline · bvshop · cyberbiz
presets/         reusable strategies, named by shape not by site
locales/         zh-TW OCR quality checks
cli/             scaffold: renders a SourceModule skeleton
docs/            choosing-primitives: filling in the skeleton
```

Two ideas carry the design.

**Roles are yours, mechanics are ours.** An _artifact_ is a captured fragment of
a page; a _role_ says what it's for. Scraping supplements needs a "nutrition
label" role, scraping components needs "datasheet". So the kernel owns
classification, selection and fallback, and you supply the vocabulary:

```ts
const vocabulary = defineRoleVocabulary({
  roles: [...BASE_ARTIFACT_ROLES, "datasheet"],
  preferences: { specs: ["html", "datasheet", "product-description"] },
});
```

**Everything external is an interface.** Candidate products come from a
`CandidateSource`, so the toolkit carries no database schema. OCR comes from an
`OcrProvider`, so no engine is privileged. The LLM client talks to any
OpenAI-compatible endpoint. What varies by deployment is injected, not assumed.

## Configuration

Copy `.env.example`. All four LLM variables are required — including
`LLM_BASE_URL`, which has **no default** on purpose: a silent fallback could
send your data to a provider you never chose.

## Known limits

Stated plainly, because they'll be the first things you hit.

- **OCR ships one engine, and it needs macOS.** Apple Vision is behind the
  `OcrProvider` interface, but it's currently the only implementation, and it
  requires macOS with Xcode command-line tools. On Linux or Windows,
  `available()` returns `false` and you must supply your own provider. A
  cross-platform engine is the most useful contribution this repo could receive.
- **Presets give you scaffolding, not parsers.** For a site with no usable
  JSON-LD, DOM parsing remains your cost. Nothing here removes it.
- **Rate limiting is fixed-interval.** No jitter, no exponential backoff, and
  `Retry-After` is not honoured. Fine against sites that don't throttle; harden
  it before pointing this at one that answers 429.

## Scope

This toolkit fetches and structures publicly reachable pages. It ships rate
limiting and `robots.txt` parsing because those are the baseline of scraping
something you don't own — respecting a site's terms of service, its crawl
directives and applicable law is the operator's responsibility.

Marketplaces are out of scope by design: there, the page template belongs to the
marketplace rather than the seller, so the useful unit would be one adapter per
marketplace, not per store.

## License

MIT — see [LICENSE](LICENSE).
