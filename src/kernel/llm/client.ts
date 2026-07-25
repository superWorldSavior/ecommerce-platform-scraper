/**
 * Client LLM provider-agnostic : extraction structurée et complétion texte,
 * avec routage automatique vers un modèle vision quand une image est fournie.
 *
 * Parle à **toute API compatible OpenAI** — runtime local, passerelle
 * auto-hébergée, service hébergé. Changer de fournisseur ou de modèle se fait
 * par variables d'environnement, sans modification de code.
 *
 * Contrat :
 *   - Pas de JSON Schema strict : tous les endpoints ne l'implémentent pas.
 *     À la place, schéma décrit dans le prompt + mode `json_object` +
 *     validation Zod + retry borné. Échec explicite si toujours invalide.
 *   - Pas de side-effect : fonction pure qui renvoie `{ data, usage }`. Le
 *     caller décide quoi faire du coût/tokens (log, métrique, cache).
 *   - Pas de cache interne : le cache (si nécessaire) vit au niveau caller
 *     (hash du payload input → résultat), jamais dans ce module.
 *   - **Erreurs discriminables** : chaque échec porte un `code` + un message
 *     explicite. Le batch peut router selon le code (re-essayer plus tard sur
 *     `RATE_LIMITED`, abort sur `AUTH`, escalader sur `MODEL_NOT_FOUND`).
 *     Pas de retry interne sur les codes déterministes (AUTH, MODEL_NOT_FOUND,
 *     INVALID_OUTPUT) — re-essayer ne les répare pas.
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
   * Optionnel : image base64 (sans préfixe `data:`) à fournir au modèle vision.
   * Le content du message user devient un array
   * `[{type:"text",...}, {type:"image_url",...}]`.
   * Quand présent, route vers `LLM_VISION_MODEL` (obligatoire dans ce cas).
   * Sinon route vers `LLM_MODEL`.
   */
  imageBase64?: string;
  /** MIME type de l'image. Défaut "image/jpeg". */
  imageMimeType?: "image/jpeg" | "image/png" | "image/webp";
  /** Taille de la fenêtre de contexte, si l'endpoint expose `options.num_ctx`. */
  numCtx?: number;
}

export interface LlmCompleteInput {
  systemPrompt: string;
  userPrompt: string;
  maxRetries?: number;
  /**
   * Optionnel : image base64 (sans préfixe `data:`) à fournir au modèle vision.
   * Quand présent, route vers `LLM_VISION_MODEL` (comme `extract()`).
   * Le content du message user devient un array
   * `[{type:"text",...}, {type:"image_url",...}]`.
   */
  imageBase64?: string;
  /** MIME type de l'image. Défaut "image/jpeg". */
  imageMimeType?: "image/jpeg" | "image/png" | "image/webp";
  /** Taille de la fenêtre de contexte, si l'endpoint expose `options.num_ctx`. */
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
   * Complétion plain text — pas de mode `response_format: json_object`. Utile
   * pour les sorties longues où le JSON strict fait timeout côté provider
   * (transcription markdown ~10-20 KB en zh-TW). Le caller est responsable
   * de parser/valider le texte selon son contrat. Aucun retry sur output
   * vide — c'est au caller de décider si une réponse vide est acceptable.
   */
  complete(input: LlmCompleteInput): Promise<LlmCompleteResult>;
}

/**
 * Codes d'erreur discriminables. Le batch caller route selon :
 *  - `AUTH` / `MODEL_NOT_FOUND` : abort, problème de configuration.
 *  - `RATE_LIMITED` : attendre `retryAfterSeconds`, puis re-soumettre. Quota
 *    endpoint par fenêtre — le caller doit gérer la pause.
 *  - `NETWORK` / `PROVIDER_ERROR` : transient, peut être ré-essayé après
 *    backoff. Le client retry déjà en interne avec backoff exponentiel.
 *  - `INVALID_OUTPUT` : le LLM a produit du JSON/Zod invalide après tous les
 *    retries. Pas un bug réseau — soit le prompt est mauvais, soit le modèle.
 *  - `EMPTY_RESPONSE` : choix.length 0 ou content vide — anomalie provider.
 *  - `UNKNOWN` : tout le reste, log + escalade.
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
 * Classifie une erreur OpenAI SDK ou native vers un `LlmErrorCode`.
 *
 * Le SDK `openai` (v4) lève `OpenAI.APIError` avec un champ `status` HTTP. On
 * mappe explicitement les codes attendus de l'endpoint compatible OpenAI :
 *  - 401 / 403 → AUTH (clé invalide ou révoquée)
 *  - 404 → MODEL_NOT_FOUND (modèle pas dispo sur le compte)
 *  - 429 → RATE_LIMITED (quota fenêtre épuisé, lire `retry-after` header)
 *  - 5xx → PROVIDER_ERROR (transient, retry OK)
 *  - autre → UNKNOWN
 *
 * Les `TypeError` / `AbortError` côté fetch sont classés NETWORK.
 */
function classifyError(
  error: unknown,
): { code: LlmErrorCode; retryAfterSeconds?: number; message: string } {
  // APIConnectionError extends APIError mais n'a pas de status HTTP — il représente
  // un échec réseau (fetch throw, timeout) que le SDK a enveloppé. À traiter avant
  // le check générique APIError pour éviter de tomber dans la branche status=undefined.
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
 * `true` si le code mérite un nouveau retry (transient). `false` pour les
 * erreurs déterministes (AUTH, MODEL_NOT_FOUND, RATE_LIMITED) — re-essayer
 * sur la même fenêtre ne les répare pas, c'est au caller batch de décider
 * (waiter, abort, escalader).
 */
function isRetriableCode(code: LlmErrorCode): boolean {
  return code === "NETWORK" || code === "PROVIDER_ERROR";
}

/**
 * Walk la chaîne `error.cause` pour récupérer le `LlmErrorCode` typé d'une
 * erreur — quel que soit le nombre de wrappers (`TranscriptionError`,
 * `ImageTranscriptionError`, etc.) entre le call site et la racine.
 *
 * Renvoie `null` si la chaîne ne contient aucun `LlmClientError`. Plus
 * robuste qu'un regex sur `error.message` qui rompt si un wrapper change
 * son format de message.
 *
 * Exemple consommateur : negative cache de transcribe-images qui veut
 * skipper les SKUs siblings d'un contenu qui a déclenché un
 * `code === "PROVIDER_ERROR"` (qwen3-vl OOM sur banner Shopline).
 */
export function extractLlmErrorCode(err: unknown): LlmErrorCode | null {
  let cursor: unknown = err;
  // Garde-fou anti-cycle (cause peut pointer en boucle théoriquement).
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
// Helpers privés
// ---------------------------------------------------------------------------

/** Construit le content du message user. Pure, sans side-effect. */
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

/** Sélectionne le modèle texte ou vision selon la présence d'une image. Pure. */
function selectModel(
  textModel: string,
  visionModel: string,
  imageBase64?: string,
): string {
  return imageBase64 ? visionModel : textModel;
}

/**
 * Certains modèles cloud (gemma) entourent le JSON de fences markdown malgré
 * `json_object` mode. Retire une paire de fences englobante ; laisse tout
 * autre contenu intact (le JSON.parse tranchera).
 */
function stripMarkdownFences(raw: string): string {
  const match = raw.trim().match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  return match ? match[1] : raw;
}

/**
 * Résultat interne de validation du contenu brut d'une réponse LLM.
 * - `ok: true`  → `data` est la valeur typée finale.
 * - `ok: false` → erreur récupérable (retry) ou fatale selon `errorCode`.
 */
type ValidateResult<T> =
  | { ok: true; data: T }
  | { ok: false; errorCode: LlmErrorCode; message: string; cause?: unknown };

/**
 * Cœur partagé de la boucle retry pour `extract` et `complete`.
 *
 * `validateContent` encapsule la seule logique divergente entre les deux
 * callers :
 *  - `extract` : parse JSON → valide Zod → INVALID_OUTPUT si échec (retry).
 *  - `complete` : passe-through, toujours `ok: true`.
 *
 * `aggregateUsage` gère la politique d'accumulation des tokens :
 *  - `extract` : somme cross-retries (chaque appel coûte des tokens).
 *  - `complete` : non fourni → la fonction renvoie l'usage du dernier appel.
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
// Options et factory publique
// ---------------------------------------------------------------------------

/**
 * Options internes de `createLlmClient`. L'underscore préfixe indique que
 * `_fetch` est réservé aux tests (injection d'un stub fetch). L'API publique
 * est backward-compatible : appeler `createLlmClient()` sans argument reste
 * valide.
 */
export interface LlmClientOptions {
  /**
   * Injecter un fetch stub — usage test uniquement.
   * Typé `unknown` pour éviter le conflit entre globalThis.Response (Deno) et
   * node-fetch.Response (capturé par @types/node-fetch via le SDK OpenAI). Le
   * cast vers ClientOptions["fetch"] est fait en interne lors de la construction.
   */
  _fetch?: unknown;
}

/**
 * Crée un client LLM lié à la configuration env. Réutilise la même instance
 * `OpenAI` (réuse connexion keep-alive).
 *
 * Variables d'environnement, toutes obligatoires :
 *  - `LLM_API_KEY` — clé du fournisseur. Une valeur factice convient pour les
 *    serveurs locaux qui n'authentifient pas.
 *  - `LLM_BASE_URL` — racine d'une API compatible OpenAI. Fonctionne avec tout
 *    serveur respectant ce contrat : runtime local, passerelle auto-hébergée,
 *    ou API hébergée.
 *  - `LLM_MODEL` — modèle texte.
 *  - `LLM_VISION_MODEL` — utilisé uniquement quand `imageBase64` est présent
 *    dans l'input. Séparation explicite pour éviter qu'un changement de modèle
 *    vision n'affecte l'extraction texte, et inversement.
 *
 * **Aucun défaut, y compris pour `LLM_BASE_URL`** : un repli silencieux masque
 * les erreurs de configuration et peut router vers un modèle inexistant, ou
 * vers le service d'un fournisseur que l'appelant n'avait pas choisi. On préfère
 * un `MISSING_ENV` explicite au démarrage.
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
    // Les retries SDK sont désactivés (maxRetries: 0) pour que extract() soit
    // le seul gestionnaire de retry. Cela permet un contrôle fin par code d'erreur
    // (RATE_LIMITED non-retry, PROVIDER_ERROR retry avec backoff exponentiel).
    // Sans ce 0, le SDK ferait ses propres retries sur 429/5xx avant de throw,
    // empêchant notre classification de voir les réponses intermédiaires.
    maxRetries: 0,
    // Cast justifié : _fetch est unknown pour contourner le conflit de types
    // entre globalThis.Response (Deno) et node-fetch.Response (@types/node-fetch
    // transitivement importé par le SDK OpenAI). En runtime, tout fetch valide
    // fonctionne — le conflit est purement au niveau des déclarations de types.
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
        // PAS de responseFormat : on laisse le LLM produire du texte libre.
        // Pour les transcriptions markdown longues, le mode JSON strict fait
        // crasher certains endpoints (timeout sur génération contrainte
        // >10K chars).
        numCtx: input.numCtx,
        maxRetries: input.maxRetries ?? 2,
        validateContent: (raw: string): ValidateResult<string> => ({
          ok: true,
          data: raw,
        }),
        // Pas d'aggregateUsage → usage du dernier appel uniquement.
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
