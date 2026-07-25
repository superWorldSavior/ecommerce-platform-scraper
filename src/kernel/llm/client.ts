/**
 * Provider-agnostic LLM client: structured extraction and text completion,
 * with automatic routing to a vision model when an image is supplied.
 *
 * Talks to **any OpenAI-compatible API** — a local runtime, a self-hosted
 * gateway, a hosted service. Switching provider or model is done through
 * environment variables, with no code change.
 *
 * The contract:
 *   - No strict JSON Schema: not every endpoint implements it. Instead, the
 *     schema is described in the prompt, `json_object` mode is requested, the
 *     result is validated with Zod, and retries are bounded. Explicit failure
 *     if it is still invalid.
 *   - No side effects: a pure function returning `{ data, usage }`. The caller
 *     decides what to do with the cost and token counts (log, metric, cache).
 *   - No internal cache: the cache, where one is needed, lives at the caller
 *     level (hash of the input payload → result), never in this module.
 *   - **Discriminable errors**: every failure carries a `code` and an explicit
 *     message. A batch can route on the code (retry later on `RATE_LIMITED`,
 *     abort on `AUTH`, escalate on `MODEL_NOT_FOUND`). No internal retry on the
 *     deterministic codes (AUTH, MODEL_NOT_FOUND, INVALID_OUTPUT) — retrying
 *     does not fix them.
 */

import OpenAI, { type ClientOptions } from "openai";
import type { z } from "zod";

export interface LlmUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface LlmExtractResult<T> {
  data: T;
  usage: LlmUsage;
  retries: number;
}

export interface LlmExtractInput<T> {
  systemPrompt: string;
  userPrompt: string;
  schema: z.ZodType<T, z.ZodTypeDef, unknown>;
  maxRetries?: number;
  /**
   * Optional: base64 image (no `data:` prefix) to hand to the vision model.
   * The user message content then becomes an array
   * `[{type:"text",...}, {type:"image_url",...}]`.
   * When present, routes to `LLM_VISION_MODEL` (mandatory in that case).
   * Otherwise routes to `LLM_MODEL`.
   */
  imageBase64?: string;
  /** MIME type of the image. Defaults to "image/jpeg". */
  imageMimeType?: "image/jpeg" | "image/png" | "image/webp";
  /** Context window size, if the endpoint exposes `options.num_ctx`. */
  numCtx?: number;
}

export interface LlmCompleteInput {
  systemPrompt: string;
  userPrompt: string;
  maxRetries?: number;
  /**
   * Optional: base64 image (no `data:` prefix) to hand to the vision model.
   * When present, routes to `LLM_VISION_MODEL` (same as `extract()`).
   * The user message content then becomes an array
   * `[{type:"text",...}, {type:"image_url",...}]`.
   */
  imageBase64?: string;
  /** MIME type of the image. Defaults to "image/jpeg". */
  imageMimeType?: "image/jpeg" | "image/png" | "image/webp";
  /** Context window size, if the endpoint exposes `options.num_ctx`. */
  numCtx?: number;
}

export interface LlmCompleteResult {
  text: string;
  usage: LlmUsage;
  retries: number;
}

export interface LlmClient {
  extract<T>(input: LlmExtractInput<T>): Promise<LlmExtractResult<T>>;
  /**
   * Plain-text completion — no `response_format: json_object` mode. Useful for
   * long outputs where strict JSON times out on the provider side (markdown
   * transcription of ~10-20 KB in zh-TW). The caller is responsible for
   * parsing and validating the text against its own contract. No retry on
   * empty output — it is up to the caller to decide whether an empty response
   * is acceptable.
   */
  complete(input: LlmCompleteInput): Promise<LlmCompleteResult>;
}

/**
 * Discriminable error codes. The batch caller routes on them:
 *  - `AUTH` / `MODEL_NOT_FOUND`: abort, this is a configuration problem.
 *  - `RATE_LIMITED`: wait `retryAfterSeconds`, then resubmit. Per-window
 *    endpoint quota — pausing is the caller's job.
 *  - `NETWORK` / `PROVIDER_ERROR`: transient, can be retried after a backoff.
 *    The client already retries internally with exponential backoff.
 *  - `INVALID_OUTPUT`: the model produced JSON that failed to parse or to
 *    validate, after every retry. Not a network bug — either the prompt is
 *    wrong or the model is.
 *  - `EMPTY_RESPONSE`: zero choices, or empty content — a provider anomaly.
 *  - `UNKNOWN`: everything else; log and escalate.
 */
export type LlmErrorCode =
  | "AUTH"
  | "MODEL_NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK"
  | "PROVIDER_ERROR"
  | "INVALID_OUTPUT"
  | "EMPTY_RESPONSE"
  | "MISSING_ENV"
  | "UNKNOWN";

export class LlmClientError extends Error {
  override readonly name = "LlmClientError";
  constructor(
    readonly code: LlmErrorCode,
    message: string,
    override readonly cause?: unknown,
    readonly retries?: number,
    readonly retryAfterSeconds?: number,
  ) {
    super(message);
  }
}

function requireEnv(key: string): string {
  const value = Deno.env.get(key);
  if (!value) {
    throw new LlmClientError(
      "MISSING_ENV",
      `Missing env var ${key}. Set it in .env (cf .env.example)`,
    );
  }
  return value;
}

function readRequestTimeoutMs(): number {
  const raw = Deno.env.get("LLM_REQUEST_TIMEOUT_MS");
  if (!raw) return 180_000;

  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new LlmClientError(
      "MISSING_ENV",
      `Invalid LLM_REQUEST_TIMEOUT_MS="${raw}". Expected a positive number of milliseconds.`,
    );
  }

  return parsed;
}

function createTimeoutFetch(timeoutMs: number): typeof fetch {
  return (input, init) => {
    const timeoutSignal = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal
      ? AbortSignal.any([init.signal, timeoutSignal])
      : timeoutSignal;

    return fetch(input, { ...init, signal });
  };
}

/**
 * Classifies an OpenAI SDK error, or a native one, into an `LlmErrorCode`.
 *
 * The `openai` SDK (v4) throws `OpenAI.APIError` with an HTTP `status` field.
 * We map the codes an OpenAI-compatible endpoint is expected to return:
 *  - 401 / 403 → AUTH (invalid or revoked key)
 *  - 404 → MODEL_NOT_FOUND (model not available on the account)
 *  - 429 → RATE_LIMITED (window quota exhausted, read the `retry-after` header)
 *  - 5xx → PROVIDER_ERROR (transient, safe to retry)
 *  - anything else → UNKNOWN
 *
 * The `TypeError` / `AbortError` raised by fetch are classified as NETWORK.
 */
function classifyError(
  error: unknown,
): { code: LlmErrorCode; retryAfterSeconds?: number; message: string } {
  // APIConnectionError extends APIError but carries no HTTP status — it stands
  // for a network failure (fetch throw, timeout) that the SDK wrapped. Handle
  // it before the generic APIError check, to avoid landing in the
  // status=undefined branch.
  if (error instanceof OpenAI.APIConnectionError) {
    return {
      code: "NETWORK",
      message: `Network error reaching LLM endpoint: ${error.message}`,
    };
  }

  if (error instanceof OpenAI.APIError) {
    const status = error.status;
    const headers = error.headers as
      | Record<string, string | undefined>
      | undefined;
    const retryAfterRaw = headers?.["retry-after"] ?? headers?.["Retry-After"];
    const retryAfterSeconds = retryAfterRaw ? Number(retryAfterRaw) : undefined;

    if (status === 401 || status === 403) {
      return {
        code: "AUTH",
        message:
          `LLM endpoint authentication rejected (HTTP ${status}). Check LLM_API_KEY.`,
      };
    }
    if (status === 404) {
      return {
        code: "MODEL_NOT_FOUND",
        message:
          `LLM endpoint rejected the model (HTTP 404). Check LLM_MODEL / LLM_VISION_MODEL.`,
      };
    }
    if (status === 429) {
      const wait = Number.isFinite(retryAfterSeconds)
        ? ` Retry-After: ${retryAfterSeconds}s.`
        : " (no Retry-After header — back off and retry on next batch window).";
      return {
        code: "RATE_LIMITED",
        retryAfterSeconds: Number.isFinite(retryAfterSeconds)
          ? retryAfterSeconds
          : undefined,
        message: `LLM endpoint rate limit or quota exhausted.${wait}`,
      };
    }
    if (status !== undefined && status >= 500 && status < 600) {
      return {
        code: "PROVIDER_ERROR",
        message:
          `LLM endpoint transient error (HTTP ${status}): ${error.message}`,
      };
    }
    return {
      code: "UNKNOWN",
      message:
        `LLM endpoint unexpected error (HTTP ${status}): ${error.message}`,
    };
  }

  if (
    error instanceof TypeError &&
    /fetch|network|connect|ECONNREFUSED|ENOTFOUND/i.test(error.message)
  ) {
    return {
      code: "NETWORK",
      message: `Network error reaching LLM endpoint: ${error.message}`,
    };
  }
  if (error instanceof Error && error.name === "AbortError") {
    return {
      code: "NETWORK",
      message: `Request to LLM endpoint aborted: ${error.message}`,
    };
  }

  return {
    code: "UNKNOWN",
    message: error instanceof Error ? error.message : String(error),
  };
}

/**
 * `true` when the code deserves another retry (transient). `false` for the
 * deterministic errors (AUTH, MODEL_NOT_FOUND, RATE_LIMITED) — retrying within
 * the same window does not fix them; it is up to the batch caller to decide
 * (wait, abort, escalate).
 */
function isRetriableCode(code: LlmErrorCode): boolean {
  return code === "NETWORK" || code === "PROVIDER_ERROR";
}

/**
 * Walks the `error.cause` chain to recover an error's typed `LlmErrorCode`,
 * however many wrappers (`TranscriptionError`, `ImageTranscriptionError`, etc.)
 * sit between the call site and the root.
 *
 * Returns `null` when the chain holds no `LlmClientError`. More robust than a
 * regex over `error.message`, which breaks as soon as a wrapper changes its
 * message format.
 *
 * Example consumer: the negative cache in transcribe-images, which wants to
 * skip the sibling SKUs of a piece of content that triggered a
 * `code === "PROVIDER_ERROR"` (vision model out of memory on a Shopline
 * banner).
 */
export function extractLlmErrorCode(err: unknown): LlmErrorCode | null {
  let cursor: unknown = err;
  // Cycle guard (in theory, `cause` can loop back on itself).
  for (
    let depth = 0;
    depth < 8 && cursor !== null && cursor !== undefined;
    depth++
  ) {
    if (cursor instanceof LlmClientError) return cursor.code;
    if (!(cursor instanceof Error)) return null;
    cursor = cursor.cause;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/** Builds the user message content. Pure, no side effects. */
function buildUserContent(
  userPrompt: string,
  imageBase64?: string,
  imageMimeType?: "image/jpeg" | "image/png" | "image/webp",
): OpenAI.ChatCompletionUserMessageParam["content"] {
  if (!imageBase64) return userPrompt;
  return [
    { type: "text", text: userPrompt },
    {
      type: "image_url",
      image_url: {
        url: `data:${imageMimeType ?? "image/jpeg"};base64,${imageBase64}`,
      },
    },
  ];
}

/** Picks the text or vision model based on whether an image is present. */
function selectModel(
  textModel: string,
  visionModel: string,
  imageBase64?: string,
): string {
  return imageBase64 ? visionModel : textModel;
}

/**
 * Some hosted models wrap the JSON in markdown fences despite `json_object`
 * mode. Strips one enclosing pair of fences; leaves any other content
 * untouched (`JSON.parse` will be the judge).
 */
function stripMarkdownFences(raw: string): string {
  const match = raw.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return match ? match[1] : raw;
}

/**
 * Internal result of validating the raw content of an LLM response.
 * - `ok: true`  → `data` is the final typed value.
 * - `ok: false` → recoverable (retry) or fatal, depending on `errorCode`.
 */
type ValidateResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorCode: LlmErrorCode; message: string; cause?: unknown };

/**
 * Shared core of the retry loop for `extract` and `complete`.
 *
 * `validateContent` holds the only logic that differs between the two callers:
 *  - `extract`: parse JSON → validate with Zod → INVALID_OUTPUT on failure
 *    (retry).
 *  - `complete`: pass-through, always `ok: true`.
 *
 * `aggregateUsage` holds the token accounting policy:
 *  - `extract`: summed across retries (every call costs tokens).
 *  - `complete`: not supplied → the function returns the last call's usage.
 */
async function runChatCompletionWithRetry<T>(opts: {
  client: OpenAI;
  model: string;
  systemPrompt: string;
  userContent: OpenAI.ChatCompletionUserMessageParam["content"];
  responseFormat?: { type: "json_object" };
  numCtx?: number;
  maxRetries: number;
  validateContent: (raw: string) => ValidateResult<T>;
  aggregateUsage?: (
    current: LlmUsage,
    attempt: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
    },
  ) => LlmUsage;
  errorPrefix: string;
}): Promise<{ data: T; usage: LlmUsage; retries: number }> {
  const {
    client,
    model,
    systemPrompt,
    userContent,
    responseFormat,
    numCtx,
    maxRetries,
    validateContent,
    aggregateUsage,
    errorPrefix,
  } = opts;

  let lastErrorCode: LlmErrorCode = "UNKNOWN";
  let lastErrorMessage = "no attempt was completed";
  let lastCause: unknown = null;
  let lastRetryAfter: number | undefined;
  let usage: LlmUsage = {
    promptTokens: 0,
    completionTokens: 0,
    totalTokens: 0,
  };

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const response = await client.chat.completions.create({
        model,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userContent },
        ],
        ...(responseFormat ? { response_format: responseFormat } : {}),
        ...(numCtx !== undefined
          ? { extra_body: { options: { num_ctx: numCtx } } }
          : {}),
      });

      const raw = response.usage ?? {
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: 0,
      };
      const attemptUsage = {
        promptTokens: raw.prompt_tokens,
        completionTokens: raw.completion_tokens,
        totalTokens: raw.total_tokens,
      };
      usage = aggregateUsage
        ? aggregateUsage(usage, attemptUsage)
        : attemptUsage;

      const rawContent = response.choices[0]?.message?.content;
      if (!rawContent) {
        lastErrorCode = "EMPTY_RESPONSE";
        lastErrorMessage =
          `LLM endpoint returned an empty content (choices[0].message.content). attempt ${
            attempt + 1
          }/${maxRetries + 1}`;
        continue;
      }

      const validated = validateContent(rawContent);
      if (!validated.ok) {
        lastErrorCode = validated.errorCode;
        lastErrorMessage = validated.message;
        lastCause = validated.cause;
        continue;
      }

      return { data: validated.data, usage, retries: attempt };
    } catch (error) {
      const classified = classifyError(error);
      lastErrorCode = classified.code;
      lastErrorMessage = classified.message;
      lastCause = error;
      lastRetryAfter = classified.retryAfterSeconds;

      if (!isRetriableCode(classified.code)) {
        throw new LlmClientError(
          classified.code,
          classified.message,
          error,
          attempt,
          classified.retryAfterSeconds,
        );
      }
    }
  }

  throw new LlmClientError(
    lastErrorCode,
    `${errorPrefix} failed after ${
      maxRetries + 1
    } attempts: ${lastErrorMessage}`,
    lastCause,
    maxRetries,
    lastRetryAfter,
  );
}

// ---------------------------------------------------------------------------
// Options and public factory
// ---------------------------------------------------------------------------

/**
 * Internal options for `createLlmClient`. The leading underscore marks `_fetch`
 * as reserved for tests (injecting a fetch stub). The public API stays
 * backward-compatible: calling `createLlmClient()` with no argument is still
 * valid.
 */
export interface LlmClientOptions {
  /**
   * Inject a fetch stub — test use only.
   * Typed `unknown` to avoid the clash between globalThis.Response (Deno) and
   * node-fetch.Response (picked up by @types/node-fetch through the OpenAI
   * SDK). The cast to ClientOptions["fetch"] happens internally, at
   * construction time.
   */
  _fetch?: unknown;
}

/**
 * Creates an LLM client bound to the environment configuration. Reuses one
 * `OpenAI` instance (keep-alive connection reuse).
 *
 * Environment variables, all mandatory:
 *  - `LLM_API_KEY` — the provider's key. A dummy value is fine for local
 *    servers that do not authenticate.
 *  - `LLM_BASE_URL` — root of an OpenAI-compatible API. Works with any server
 *    honoring that contract: a local runtime, a self-hosted gateway, or a
 *    hosted API.
 *  - `LLM_MODEL` — the text model.
 *  - `LLM_VISION_MODEL` — used only when `imageBase64` is present in the input.
 *    Kept separate so that changing the vision model cannot affect text
 *    extraction, or the other way round.
 *
 * **No defaults, `LLM_BASE_URL` included**: a silent fallback hides
 * configuration mistakes and can route to a model that does not exist, or to
 * the service of a provider the caller never chose. An explicit `MISSING_ENV`
 * at startup is preferable.
 */
export function createLlmClient(opts?: LlmClientOptions): LlmClient {
  const apiKey = requireEnv("LLM_API_KEY");
  const baseURL = requireEnv("LLM_BASE_URL");
  const textModel = requireEnv("LLM_MODEL");
  const visionModel = requireEnv("LLM_VISION_MODEL");
  const timeout = readRequestTimeoutMs();

  const client = new OpenAI({
    apiKey,
    baseURL,
    timeout,
    // SDK retries are disabled (maxRetries: 0) so that extract() is the only
    // retry handler. That allows fine-grained control per error code
    // (RATE_LIMITED not retried, PROVIDER_ERROR retried with exponential
    // backoff). Without the 0, the SDK would run its own retries on 429/5xx
    // before throwing, hiding the intermediate responses from our
    // classification.
    maxRetries: 0,
    // The cast is justified: _fetch is unknown to work around the type clash
    // between globalThis.Response (Deno) and node-fetch.Response
    // (@types/node-fetch, imported transitively by the OpenAI SDK). At runtime
    // any valid fetch works — the clash is purely at the type-declaration
    // level.
    fetch: (opts?._fetch as ClientOptions["fetch"] | undefined) ??
      (createTimeoutFetch(timeout) as unknown as ClientOptions["fetch"]),
  });

  return {
    async extract<T>(input: LlmExtractInput<T>): Promise<LlmExtractResult<T>> {
      const result = await runChatCompletionWithRetry<T>({
        client,
        model: selectModel(textModel, visionModel, input.imageBase64),
        systemPrompt: input.systemPrompt,
        userContent: buildUserContent(
          input.userPrompt,
          input.imageBase64,
          input.imageMimeType,
        ),
        responseFormat: { type: "json_object" },
        numCtx: input.numCtx,
        maxRetries: input.maxRetries ?? 2,
        validateContent: (raw: string): ValidateResult<T> => {
          let parsed: unknown;
          try {
            parsed = JSON.parse(stripMarkdownFences(raw));
          } catch (parseError) {
            return {
              ok: false,
              errorCode: "INVALID_OUTPUT",
              message:
                `LLM endpoint returned non-JSON content despite json_object mode.`,
              cause: parseError,
            };
          }
          const validated = input.schema.safeParse(parsed);
          if (!validated.success) {
            return {
              ok: false,
              errorCode: "INVALID_OUTPUT",
              message:
                `LLM endpoint returned JSON that does not match the Zod schema.`,
              cause: validated.error,
            };
          }
          return { ok: true, data: validated.data };
        },
        aggregateUsage: (current, attempt) => ({
          promptTokens: current.promptTokens + attempt.promptTokens,
          completionTokens: current.completionTokens + attempt.completionTokens,
          totalTokens: current.totalTokens + attempt.totalTokens,
        }),
        errorPrefix: "LLM extraction",
      });
      return result;
    },

    async complete(input: LlmCompleteInput): Promise<LlmCompleteResult> {
      const result = await runChatCompletionWithRetry<string>({
        client,
        model: selectModel(textModel, visionModel, input.imageBase64),
        systemPrompt: input.systemPrompt,
        userContent: buildUserContent(
          input.userPrompt,
          input.imageBase64,
          input.imageMimeType,
        ),
        // NO responseFormat: we let the model produce free-form text. For
        // long markdown transcriptions, strict JSON mode crashes some
        // endpoints (timeout on constrained generation over 10K chars).
        numCtx: input.numCtx,
        maxRetries: input.maxRetries ?? 2,
        validateContent: (raw: string): ValidateResult<string> => ({
          ok: true,
          data: raw,
        }),
        // No aggregateUsage → usage from the last call only.
        errorPrefix: "LLM completion",
      });
      return {
        text: result.data,
        usage: result.usage,
        retries: result.retries,
      };
    },
  };
}
