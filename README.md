# ecommerce-platform-scraper

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

## Platform support

| Platform     | What ships                                                                                         | Maturity                                                                                                        |
| ------------ | -------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| **SHOPLINE** | `defineShoplineSource()` — full source factory with engine defaults                                | Best supported. Widest reach by far: SHOPLINE serves hundreds of thousands of merchants across APAC and beyond. |
| **BV SHOP**  | `defineBvShopSource()` — full source factory, plus `item/query` URL resolution and cookie handling | Solid, but a small Taiwan-only platform. Niche unless you scrape there.                                         |
| **CYBERBIZ** | Image-context helpers only — no source factory yet                                                 | Deliberate. Two sites is not enough evidence to design the factory; see below.                                  |

**On the missing CYBERBIZ factory.** It is not an oversight. Extracting a
platform factory from two examples produces either something too loose to help
or something wrong the moment a third site shows its real differences. The bar
used here: at least three sites on the engine, at least two non-trivial shared
capabilities expressible as declarative config, and duplication that cannot be
modelled without branching on the site name. CYBERBIZ currently sits below it.

## Architecture

```
kernel/          source contract, discovery, sitemap, HTTP, raw storage,
                 image candidates, artifact context
  llm/           multi-model client, text/vision routing, typed errors
  ocr/           OcrProvider interface + Apple Vision implementation
platforms/       shopline · bvshop · cyberbiz
presets/         reusable strategies, named by shape not by site
locales/         zh-TW OCR quality checks
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
- **Code comments are in French.** The API, README and identifiers are English;
  inline documentation is not, yet. Translation PRs welcome.

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
