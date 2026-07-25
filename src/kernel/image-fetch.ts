/**
 * Downloads images into base64, for OCR and vision models.
 *
 * Both consumers expect base64 with no `data:` prefix, and need the real MIME
 * type: a `.jpg` file served as `image/webp` breaks a strict decoder. The type
 * is therefore derived from the response header, not from the URL extension.
 */

import { encodeBase64 } from "@std/encoding/base64";

export type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface FetchedImageBase64 {
  base64: string;
  mimeType: ImageMimeType;
}

/**
 * Discriminable failure of `fetchImageAsBase64`.
 *
 *  - `HTTP_NOT_OK` — non-2xx response. `status` is set.
 *  - `FETCH_FAILED` — network error or timeout.
 *
 * The distinction matters: a 404 is final and the caller should move on, while
 * a network error deserves another attempt.
 */
export class ImageFetchError extends Error {
  override readonly name = "ImageFetchError";
  constructor(
    readonly code: "HTTP_NOT_OK" | "FETCH_FAILED",
    message: string,
    readonly status?: number,
    override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export interface FetchImageOptions {
  /** Maximum delay in milliseconds. Defaults to 30,000. */
  timeoutMs?: number;
  /**
   * The `fetch` implementation to use. Reserved for tests.
   *
   * Typed `unknown` to work around the clash between `globalThis.fetch` and the
   * `node-fetch` types some dependencies pull in transitively. At runtime, any
   * conforming implementation works.
   */
  _fetch?: unknown;
}

/** `image/jpeg` by default: the most common format on product CDNs. */
function classifyMimeType(contentType: string | null): ImageMimeType {
  if (!contentType) return "image/jpeg";
  const lower = contentType.toLowerCase();
  if (lower.includes("image/png")) return "image/png";
  if (lower.includes("image/webp")) return "image/webp";
  return "image/jpeg";
}

export async function fetchImageAsBase64(
  url: string,
  options: FetchImageOptions = {},
): Promise<FetchedImageBase64> {
  const fetchFn =
    (options._fetch ?? globalThis.fetch) as typeof globalThis.fetch;
  const signal = AbortSignal.timeout(options.timeoutMs ?? 30_000);

  let response: Response;
  try {
    response = await fetchFn(url, { signal });
  } catch (error) {
    throw new ImageFetchError(
      "FETCH_FAILED",
      `Failed to fetch image ${url}: ${
        error instanceof Error ? error.message : String(error)
      }`,
      undefined,
      error,
    );
  }

  if (!response.ok) {
    throw new ImageFetchError(
      "HTTP_NOT_OK",
      `HTTP ${response.status} fetching image ${url}`,
      response.status,
    );
  }

  const buffer = await response.arrayBuffer();

  return {
    base64: encodeBase64(new Uint8Array(buffer)),
    mimeType: classifyMimeType(response.headers.get("content-type")),
  };
}
