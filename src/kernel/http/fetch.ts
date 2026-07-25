/**
 * Client HTTP à débit borné, pour parcourir sitemaps et pages produit.
 *
 * Garantit un intervalle minimal entre deux appels au **même hôte** — la limite
 * qui compte, puisque c'est le serveur d'en face qu'on ménage. Les échecs
 * portent un code discriminable (`HTTP_STATUS`, `FETCH_ABORTED`,
 * `FETCH_FAILED`) pour que l'appelant choisisse entre réessai et abandon sans
 * analyser un message.
 *
 * **Limites assumées** : cadencement fixe, sans gigue ni repli exponentiel, et
 * l'en-tête `Retry-After` n'est pas honoré. Suffisant pour des sites qui ne
 * limitent pas le débit ; à durcir avant de viser un site qui répond 429.
 */

export interface PoliteFetcherOptions {
  userAgent?: string;
  acceptLanguage?: string;
  minIntervalMs?: number;
  timeoutMs?: number;
}

export interface PoliteFetchRequestOptions {
  readonly headers?: HeadersInit;
}

export interface PoliteTextResponse {
  readonly text: string;
  readonly headers: Headers;
  readonly status: number;
  readonly url: string;
}

export class HttpFetchError extends Error {
  readonly code: string;
  readonly url: string;
  readonly status?: number;

  constructor(
    code: string,
    url: string,
    message: string,
    status?: number,
  ) {
    super(message);
    this.code = code;
    this.url = url;
    this.status = status;
    this.name = "HttpFetchError";
  }
}

/**
 * User-Agent par défaut : identifie la bibliothèque sans se faire passer pour
 * un navigateur.
 *
 * **À surcharger.** Un crawler correct s'identifie et laisse un moyen de le
 * joindre — `userAgent: "acme-bot/1.0 (+https://acme.example/bot)"`. Un
 * opérateur joignable se fait bloquer bien moins souvent qu'un anonyme.
 */
const DEFAULT_UA = "ecommerce-platform-scraper/0.1";

export class PoliteFetcher {
  readonly userAgent: string;
  readonly acceptLanguage: string;
  readonly minIntervalMs: number;
  readonly timeoutMs: number;
  private lastCallByHost: Map<string, number> = new Map();

  constructor(options: PoliteFetcherOptions = {}) {
    this.userAgent = options.userAgent ?? DEFAULT_UA;
    this.acceptLanguage = options.acceptLanguage ?? "zh-TW,zh;q=0.9,en;q=0.5";
    this.minIntervalMs = options.minIntervalMs ?? 2000;
    this.timeoutMs = options.timeoutMs ?? 30000;
  }

  async fetchText(
    url: string,
    options: PoliteFetchRequestOptions = {},
  ): Promise<string> {
    const response = await this.fetchTextResponse(url, options);
    return response.text;
  }

  async fetchTextResponse(
    url: string,
    options: PoliteFetchRequestOptions = {},
  ): Promise<PoliteTextResponse> {
    await this.waitForSlot(url);
    const response = await this.doFetch(url, options);
    return {
      text: await response.text(),
      headers: response.headers,
      status: response.status,
      url: response.url,
    };
  }

  private async doFetch(
    url: string,
    options: PoliteFetchRequestOptions,
  ): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const headers = new Headers({
        "User-Agent": this.userAgent,
        "Accept-Language": this.acceptLanguage,
        "Accept":
          "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      });
      new Headers(options.headers).forEach((value, key) => {
        headers.set(key, value);
      });

      const response = await fetch(url, {
        headers,
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new HttpFetchError(
          "HTTP_STATUS",
          url,
          `HTTP ${response.status} on ${url}`,
          response.status,
        );
      }
      return response;
    } catch (error) {
      if (error instanceof HttpFetchError) throw error;
      if (error instanceof DOMException && error.name === "AbortError") {
        throw new HttpFetchError(
          "FETCH_ABORTED",
          url,
          `Fetch timed out after ${this.timeoutMs}ms: ${url}`,
        );
      }
      throw new HttpFetchError(
        "FETCH_FAILED",
        url,
        error instanceof Error ? error.message : String(error),
      );
    } finally {
      clearTimeout(timer);
    }
  }

  private async waitForSlot(url: string): Promise<void> {
    const host = hostOf(url);
    const last = this.lastCallByHost.get(host) ?? 0;
    const now = Date.now();
    const wait = last + this.minIntervalMs - now;
    if (wait > 0) {
      await sleep(wait);
    }
    this.lastCallByHost.set(host, Date.now());
  }
}

function hostOf(url: string): string {
  return new URL(url).host;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse `robots.txt` and return disallow rules applicable to `User-agent: *`.
 *
 * Ne prétend pas être un parser robots complet : ignore les wildcards
 * inline autres que `*` en fin de pattern, les directives `Crawl-delay`,
 * les sections User-agent spécifiques. Suffisant pour garder en tête les
 * paths à NE PAS crawler et échouer fast-fail si un sitemap nous propose
 * un URL disallow.
 */
export interface RobotsRules {
  disallow: string[];
  allow: string[];
  sitemaps: string[];
}

export function parseRobotsTxt(text: string): RobotsRules {
  const lines = text.split(/\r?\n/);
  const rules: RobotsRules = { disallow: [], allow: [], sitemaps: [] };
  let inWildcard = false;
  for (const line of lines) {
    const trimmed = line.replace(/#.*$/, "").trim();
    if (!trimmed) continue;
    const [rawKey, ...rest] = trimmed.split(":");
    if (!rawKey || rest.length === 0) continue;
    const key = rawKey.trim().toLowerCase();
    const value = rest.join(":").trim();

    if (key === "user-agent") {
      inWildcard = value === "*";
      continue;
    }
    if (key === "sitemap") {
      rules.sitemaps.push(value);
      continue;
    }
    if (!inWildcard) continue;
    if (key === "disallow" && value) rules.disallow.push(value);
    if (key === "allow" && value) rules.allow.push(value);
  }
  return rules;
}

export function isDisallowed(rules: RobotsRules, path: string): boolean {
  const normalized = path.replace(/\*+/g, "");
  let deny = false;
  let longestDeny = 0;
  let longestAllow = 0;
  for (const rule of rules.disallow) {
    if (matchesRule(normalized, rule) && rule.length > longestDeny) {
      deny = true;
      longestDeny = rule.length;
    }
  }
  for (const rule of rules.allow) {
    if (matchesRule(normalized, rule) && rule.length > longestAllow) {
      longestAllow = rule.length;
    }
  }
  return deny && longestDeny > longestAllow;
}

function matchesRule(path: string, rule: string): boolean {
  const literal = rule.replace(/\*$/, "");
  return path.startsWith(literal);
}
