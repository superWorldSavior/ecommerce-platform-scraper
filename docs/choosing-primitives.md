# Choosing primitives

The scaffold leaves you a skeleton with `null` in every capability field. This
page is how you fill them in.

It exists because `null` is a _legitimate_ answer, not a placeholder — the
contract makes capability fields required-but-nullable so that "deliberately
absent" is a position you take, and one a later reader can audit. Deciding to
leave a `null` is a decision. This page is about making it deliberately.

Read it after generating a skeleton and after looking at a few real product
pages. Not before: most of the questions below cannot be answered from the
outside.

## The three decisions, and why they are independent

| Field                                 | Question it answers                                                  |
| ------------------------------------- | -------------------------------------------------------------------- |
| `imageCandidateSelector`              | Which images are worth sending to OCR at all?                        |
| `projectionProviders.artifactContext` | What is each captured artifact _for_?                                |
| `projectionProviders.structuredFacts` | Is there a deterministic source of facts, or must a model read them? |

These are three separate axes, and conflating them is the most common mistake.

A **selector** works on URLs, before any OCR. It answers "is this asset worth
the OCR budget" — nothing more. It must not try to infer fine-grained roles: a
selector cannot know whether an image is a spec sheet or a certificate, because
it has not read it yet.

A **context provider** works after capture and assigns roles. That is where the
fine-grained sorting belongs.

A **structured-facts provider** bypasses reading entirely when the site already
publishes the facts in a machine-readable form.

None of the three substitutes for another. A structured-facts provider does not
replace a context classifier; a context classifier does not produce facts.

## Decision 1 — `imageCandidateSelector`

**Default to `null`.** Every candidate image is kept, and OCR sees them all.
That is the right starting point: a filter written before you have seen the
pages drops content you needed.

**Add a selector when** a page serves a lot of global or decorative assets —
theme icons, banners, cross-sell thumbnails — and OCR budget is being spent on
them. The symptom is concrete: a dry run over one product selects images that
obviously carry no product information.

Build it from `buildImageCandidateSelection`, which requires every drop to carry
a URL and a reason. That constraint is the point — an unauditable filter is
indistinguishable from a bug.

Before writing one, check whether a platform already answers this. SHOPLINE
ships a shared selector; CYBERBIZ deliberately does not, because its stores
differ too much (see the README's platform table).

## Decision 2 — `artifactContext`

**Default to `null`.** Every artifact is passed to the model with no role
filtering, and the fallback is recorded as `NO_PROVIDER`. Usable, just
undiscriminating.

**Add a provider when** you are paying for context you do not need — long pages
where most artifacts are irrelevant to what you are extracting — or when
selection quality matters more than recall.

Use `createPerArtifactContextProvider` when an artifact's role follows from the
artifact **alone**, which is the common case:

```ts
projectionProviders: {
  artifactContext: createPerArtifactContextProvider({
    sourceName: "example",
    classify: (artifact) =>
      /spec|datasheet/iu.test(artifact.sourceUrl ?? "")
        ? ["datasheet"]
        : ["unknown"],
  }),
  structuredFacts: null,
}
```

Write the provider by hand instead when classification needs cross-artifact
context — "the label is the last slide of the carousel" — or a disk read. The
helper cannot serve those without turning into a framework.

A reasonable minimum, in the base role vocabulary:

| Artifact                                     | Role                  |
| -------------------------------------------- | --------------------- |
| the product HTML itself                      | `html`                |
| image carrying regulated or spec information | your domain role      |
| image making the sales argument              | `product-description` |
| lab report, certificate, test result         | `certificate`         |
| header, logo, footer, icons                  | `ui`                  |
| promotion, bundle, campaign                  | `promo`               |
| recommendations, other products              | `related-product`     |

Add a test on a real HTML fixture proving at least one useful artifact selected
and one useless artifact excluded. A classifier that never excludes anything is
a `null` with extra steps.

### Calibrating before you trust it

A new classifier can be run in audit mode first: set `selectionMode: "full"` and
every artifact still passes through, with the classification recorded but not
enforced. You get to compare what it _would_ have dropped against what you
actually needed, without risking a loss of context. Switch to `"role-filtered"`
once the comparison is boring.

## Decision 3 — `structuredFacts`

**Default to `null`.** Facts come from a model pass. That is the honest state
for most sites.

**Add a provider when** the site publishes the facts deterministically — a
JSON-LD block, a real HTML table, a companion JSON endpoint. Deterministic beats
a model every time it is available: it is free, stable, and auditable.

Two rules that matter more than they look:

**Only emit facts you can defend.** A provider should return a value only when
it has both a usable quantity and a supported unit. If the source gives a
marketing name or a qualitative concentration, return a typed fallback instead.
A confidently wrong fact is worse than an admitted gap, because nothing
downstream will question it.

**Never rewrite the source text.** Keep the raw extracted string alongside the
parsed value. It is the only evidence a later audit can rest on, and a value
derived from a parse that turns out to be wrong leaves no way back.

Colocate a test with a real fixture: at least one reliable extraction, and a
typed fallback when the expected signal is absent.

## Which primitives already exist

Check this before writing anything local. The kernel is not large, but it is
easy to reimplement a piece of it by accident.

| Axis                | Take from                                                                             | Do not rewrite                                                                     |
| ------------------- | ------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Sitemap and catalog | `parseSitemapUrls`, `splitSitemap`, `fetchCatalogFromSitemap`                         | Nested sitemapindex handling, prefix and pattern filtering                         |
| Raw HTML            | `readProductHtml`, `productHtmlPaths`                                                 | Snapshot path convention, fallback-path resolution, the `NotFound`-only retry rule |
| Images, pre-OCR     | `buildImageCandidateSelection`, `imageCandidateUrlLookupVariants`                     | Drop accounting, URL spelling variants, deduplication                              |
| Image fetch         | `fetchImageAsBase64`                                                                  | MIME detection from the response rather than the extension                         |
| Artifact context    | `createPerArtifactContextProvider`, `selectProjectionContext`, `defineRoleVocabulary` | Fallback logic, role counting, noise filtering                                     |
| OCR                 | `OcrProvider`, `confidenceFromAverage`, `runOcrQualityChecks`                         | Confidence banding, quality-check aggregation, typed empty results                 |
| Model calls         | `createLlmClient`                                                                     | Text/vision routing, typed errors, retry and validation                            |
| HTTP                | `PoliteFetcher`, `parseRobotsTxt`, `isDisallowed`                                     | Per-host pacing, `robots.txt` parsing                                              |
| Progress            | `createStageProgressTracker`                                                          | Resumable staging bookkeeping                                                      |

## Runtime signals that a decision was wrong

Decisions do not have to be right the first time; they have to be observable.
Three signals, and what each one means:

| Signal                                                     | Reading                                                                                                    |
| ---------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `fallbackReason: "NO_PROVIDER"` on a source you care about | No context provider. Fine early, a gap once pages get long.                                                |
| `providerName: "default"` with most artifacts in `unknown` | The classifier exists but is not discriminating. Worse than absent: it looks handled.                      |
| A structured-facts fallback repeating on an active source  | Either an accepted gap that should be written down, or a design gap to fix. Repeating silently is neither. |

The last one is the trap. A fallback that fires every single time is not a
fallback, it is the actual behaviour — and it should be named as such in a
comment, or fixed.

## Checklist

- [ ] Every required-nullable field has an explicit value.
- [ ] Each `null` whose reasoning is not obvious carries a comment. A source on
      a platform that ships a shared selector, declaring `null` anyway, needs a
      reason.
- [ ] A dry run over one product does not select obviously global assets.
- [ ] A test proves one useful artifact kept and one useless artifact dropped.
- [ ] Any structured-facts provider has a test for both a successful extraction
      and a typed fallback.
