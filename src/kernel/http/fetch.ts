/**
 * Rate-limited HTTP client, for walking sitemaps and product pages.
 *
 * Guarantees a minimum interval between two calls to the **same host** — the
 * limit that matters, since the server on the other end is what we are being
 * gentle with. Failures carry a discriminable code (`HTTP_STATUS`,
 * `FETCH_ABORTED`, `FETCH_FAILED`) so the caller can choose between retrying
 * and giving up without picking a message apart.
 *
 * **Accepted limits**: fixed pacing, with neither jitter nor exponential
 * backoff, and the `Retry-After` header is not honored. Good enough for sites
 * that do not throttle; harden it before aiming at a site that answers 429.
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
 * Default User-Agent: identifies the library without pretending to be a
 * browser.
 *
 * **Override it.** A well-behaved crawler identifies itself and leaves a way to
 * get in touch — `userAgent: "acme-bot/1.0 (+https://acme.example/bot)"`. A
 * reachable operator gets blocked far less often than an anonymous one.
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
 * Makes no claim to be a complete robots parser: it ignores inline wildcards
 * other than a trailing `*`, `Crawl-delay` directives, and agent-specific
 * User-agent sections. Enough to keep track of the paths we must NOT crawl,
 * and to fail fast when a sitemap hands us a disallowed URL.
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
