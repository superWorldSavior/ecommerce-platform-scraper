# AGENTS.md

Instructions for coding agents onboarding a new site into this toolkit. Humans
should read [README.md](README.md) instead — it explains the same tools in
prose.

## What you are doing

Onboarding a site means writing one file: a **source module** that declares
where the site lives and which capabilities it has. You do not write a parser
per site. You declare a platform and override what differs.

Three CLIs exist so you don't have to guess. Each answers a question the next
would otherwise make you invent. `inspect` and `primitives` take `--json`;
`scaffold` emits TypeScript, to stdout or to `--out`.

## The loop

### 1. Observe the page — never assume

```bash
deno task inspect <product-url> --json
```

Returns `PageObservations`:

```json
{
  "url": "https://shop.example.test/products/thing",
  "platform": {
    "kind": "shopline",
    "evidence": ["image host img.shoplineapp.com"]
  },
  "imageHosts": [{ "host": "img.shoplineapp.com", "count": 3 }],
  "hasProductJsonLd": true,
  "productPathSegment": "products",
  "labelImageCandidates": ["nutrition-label-back.jpg"],
  "lazyLoadedImageCount": 2
}
```

`platform.kind` is decided by CDN image host, and `evidence` states why. A
`kind` of `custom` means no known engine matched — not that detection failed.

Working from a saved page needs both flags: `--file page.html --url <url>`. The
URL is what reveals the product path shape; the file alone cannot.

**Confirm against a second product page before you commit to a hint.** One page
is not a pattern. This is the single most common way an onboarding goes wrong: a
detail true of one product gets baked in as an engine-wide rule.

### 2. Ask what already exists — before writing anything

```bash
deno task primitives --json                 # all 85, as {symbol, axis, summary}
deno task primitives --axis images --json   # one axis
deno task primitives --search robots --json # substring over symbol and summary
```

Axes: `contract`, `platform`, `discovery`, `http`, `storage`, `images`,
`artifact-context`, `ocr`, `llm`, `presets`, `locales`.

Run this before implementing any helper. The failure it prevents is
reimplementing a primitive that already shipped — which happens because READMEs
get skimmed, not because anyone decided to. A test asserts the catalogue and the
public exports describe exactly the same set of symbols, so the answer is
trustworthy by construction.

### 3. Generate the skeleton

Straight from the observations:

```bash
deno task inspect <url> --scaffold --name <slug> --out sources/<slug>/mod.ts
```

Or unattended, when you already know the answers:

```bash
deno task scaffold --yes --name <slug> --host shop.example.test \
  --platform shopline --out sources/<slug>/mod.ts
```

**Always pass `--yes` in automation.** Without it `scaffold` prompts, and a
prompt in a non-interactive context hangs. With `--yes` a missing required
answer is an error, which is what you want.

Flags that are conditionally required, and fail loudly when absent:

| Flag         | Required when                                    |
| ------------ | ------------------------------------------------ |
| `--name`     | always — see below                               |
| `--cdn`      | `--platform custom` (no engine to inherit from)  |
| `--store-id` | `--platform bvshop`                              |
| `--segment`  | product path is not `products` (BV SHOP: `item`) |

### 4. Fill in the skeleton

The generated file comes out with `null` in every capability field. **`null` is
a valid answer, not a placeholder** — it means "deliberately absent and
audited". Read [docs/choosing-primitives.md](docs/choosing-primitives.md) to
decide what belongs there and when `null` is right.

Verify before reporting done:

```bash
deno task check   # fmt + lint + type-check + tests
```

## Rules that are not negotiable

**Ask the human for `--name`.** It is the one thing no tool will invent. A slug
guessed from a hostname is a slug renamed five minutes later. It is also the
identifier every later phase keys off.

**The setup path uses no LLM, and must not start.** `inspect`, `primitives` and
`scaffold` are deterministic — they need no API key and run offline against a
saved file. Detecting an engine from a CDN host is a verifiable observation;
routing it through a model adds cost, latency and a chance of being wrong, for
nothing. The LLM belongs to the _extraction_ phases, not to setup. Do not add a
model call to this path.

**You cannot write the extraction schema.** The toolkit is domain-agnostic on
purpose: the role vocabulary, the extraction schema and the output model belong
to the consumer. Ask what is being extracted rather than inventing a plausible
shape. `zod` is a dependency of the LLM client only — it constrains model
output, it does not describe the source contract.

**Do not add a platform on one example.** A new `defineXSource()` factory earns
its place at the third site on that engine, not the first. Two data points
cannot distinguish an engine default from a site quirk. Until then, `custom`
plus explicit fields is the correct answer.

**Respect the scope.** This toolkit fetches publicly reachable pages. It ships
`robots.txt` parsing and rate limiting because that is the baseline. Check
`isDisallowed` before fetching, set a real `userAgent` with a contact URL, and
leave terms-of-service and legal judgement to the operator — do not decide on
their behalf that a site may be crawled.

## Known limits — check before promising a run

- **OCR requires macOS.** Apple Vision is the only `OcrProvider` shipped.
  Elsewhere `available()` returns `false` and the caller must inject their own.
  Do not plan an image-transcription run on Linux CI without one.
- **Presets are scaffolding, not parsers.** With no usable JSON-LD, DOM parsing
  remains the consumer's cost. Nothing here removes it.
- **Rate limiting is fixed-interval.** No jitter, no backoff, `Retry-After` is
  not honoured. Harden it before pointing this at a site that answers 429.
- **One provider and one model pair per process.** Both are read from the
  environment when the client is constructed, so per-call-site model choice
  needs configuration passed in instead.

## Pipeline vocabulary

`PIPELINE_PHASES`, in execution order. A source declares which it supports via
`SourceModule.phases`; an absent field means all of them.

`download` → `stage` → `reconcile` → `transcribe-html` → `transcribe-images` →
`apply-projections` → `score` → `project`

Setup (the loop above) produces the declaration those phases run on. It does not
run them.
