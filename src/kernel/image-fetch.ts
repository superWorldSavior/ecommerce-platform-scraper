/**
 * Téléchargement d'images vers du base64, pour l'OCR et les modèles vision.
 *
 * Les deux consommateurs attendent du base64 sans préfixe `data:`, et ont besoin
 * du type MIME réel : un fichier `.jpg` servi en `image/webp` fait échouer un
 * décodeur strict. Le type est donc dérivé du header de la réponse, pas de
 * l'extension de l'URL.
 */

import { encodeBase64 } from "@std/encoding/base64";

export type ImageMimeType = "image/jpeg" | "image/png" | "image/webp";

export interface FetchedImageBase64 {
  base64: string;
  mimeType: ImageMimeType;
}

/**
 * Échec discriminable de `fetchImageAsBase64`.
 *
 *  - `HTTP_NOT_OK` — réponse non-2xx. `status` est renseigné.
 *  - `FETCH_FAILED` — erreur réseau ou dépassement du délai.
 *
 * La distinction compte : un 404 est définitif et l'appelant doit passer à la
 * suite, une erreur réseau mérite un nouvel essai.
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
  /** Délai maximal en millisecondes. Défaut 30 000. */
  timeoutMs?: number;
  /**
   * Implémentation de `fetch` à utiliser. Réservé aux tests.
   *
   * Typé `unknown` pour contourner le conflit entre `globalThis.fetch` et les
   * types `node-fetch` importés transitivement par certaines dépendances. En
   * exécution, toute implémentation conforme fonctionne.
   */
  _fetch?: unknown;
}

/** `image/jpeg` par défaut : le format le plus courant sur les CDN produit. */
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
