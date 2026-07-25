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
  /**
   * Next instant each host may be called. Reserved *before* awaiting, so
   * concurrent callers queue instead of all reading the same free slot and
   * firing together.
   */
  private nextFreeByHost: Map<string, number> = new Map();

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

  /**
   * Claim the next slot for this host.
   *
   * The reservation is written synchronously, before any `await`. That
   * ordering is the whole mechanism: a version that read the last call time,
   * slept, then recorded the new one let every caller that arrived during the
   * sleep compute the same deadline and fire simultaneously — so
   * `Promise.all` over a host's sub-sitemaps ignored the limit entirely.
   */
  private async waitForSlot(url: string): Promise<void> {
    const host = hostOf(url);
    const now = Date.now();
    const slot = Math.max(now, this.nextFreeByHost.get(host) ?? 0);

    this.nextFreeByHost.set(host, slot + this.minIntervalMs);

    if (slot > now) await sleep(slot - now);
  }
}

function hostOf(url: string): string {
  return new URL(url).host;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Parse `robots.txt` and return the rules that apply to `User-agent: *`.
 *
 * Handles grouped agent records: consecutive `User-agent` lines form one group
 * sharing the rules that follow (RFC 9309 §2.2.1), so a group naming `*`
 * alongside a named bot still yields its rules. A previous version reset the
 * match on every agent line, which silently dropped those rules.
 *
 * **Fails closed on what it cannot express.** `Crawl-delay` is ignored, and a
 * pattern using an inner `*` or a terminal `$` is kept as an
 * `unsupported` entry rather than being reduced to a prefix — reducing
 * `Disallow: /*.json$` to the prefix `/` would either block everything or,
 * as it previously did, silently allow `/cart.json`. `isDisallowed` treats an
 * unsupported pattern as disallowing, because answering "allowed" for a path
 * the site forbade is the one error this function must not make.
 */
export interface RobotsRules {
  disallow: string[];
  allow: string[];
  sitemaps: string[];
  /** Disallow patterns too expressive for prefix matching. Treated as blocking. */
  unsupported: string[];
}

/** A pattern this parser cannot reduce to a prefix without changing its meaning. */
function isUnsupportedPattern(value: string): boolean {
  return value.slice(0, -1).includes("*") || value.endsWith("$");
}

export function parseRobotsTxt(text: string): RobotsRules {
  const rules: RobotsRules = {
    disallow: [],
    allow: [],
    sitemaps: [],
    unsupported: [],
  };

  // A run of consecutive `User-agent` lines opens one group. The group stays
  // open until a rule line is seen; the next agent line after that starts a
  // new group.
  let inWildcardGroup = false;
  let collectingAgents = false;

  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.replace(/#.*$/u, "").trim();
    if (!trimmed) continue;

    const separator = trimmed.indexOf(":");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim().toLowerCase();
    const value = trimmed.slice(separator + 1).trim();

    if (key === "user-agent") {
      if (!collectingAgents) {
        inWildcardGroup = false;
        collectingAgents = true;
      }
      if (value === "*") inWildcardGroup = true;
      continue;
    }

    // `Sitemap` is a non-group directive: it applies whatever the current
    // agent group is.
    if (key === "sitemap") {
      if (value) rules.sitemaps.push(value);
      continue;
    }

    collectingAgents = false;
    if (!inWildcardGroup || !value) continue;

    if (key === "disallow") {
      (isUnsupportedPattern(value) ? rules.unsupported : rules.disallow)
        .push(value);
    }
    if (key === "allow" && !isUnsupportedPattern(value)) {
      rules.allow.push(value);
    }
  }

  return rules;
}

/**
 * Whether `path` is disallowed. Longest matching rule wins, `Allow` breaking
 * ties in the crawler's favour, as the specification prescribes.
 *
 * Any `unsupported` pattern whose literal prefix matches is treated as
 * disallowing: the parser could not express the rule faithfully, so this errs
 * towards not fetching.
 */
export function isDisallowed(rules: RobotsRules, path: string): boolean {
  let longestDeny = 0;
  let longestAllow = 0;
  let deny = false;

  for (const rule of [...rules.disallow, ...rules.unsupported]) {
    if (matchesRule(path, rule) && rule.length > longestDeny) {
      deny = true;
      longestDeny = rule.length;
    }
  }
  for (const rule of rules.allow) {
    if (matchesRule(path, rule) && rule.length > longestAllow) {
      longestAllow = rule.length;
    }
  }

  return deny && longestDeny > longestAllow;
}

/**
 * Prefix match, with a trailing `*` meaning "and anything after". The path is
 * never rewritten — an earlier version stripped `*` from the *path*, which
 * matched rules the site never wrote.
 */
function matchesRule(path: string, rule: string): boolean {
  const literal = rule.endsWith("*") ? rule.slice(0, -1) : rule;
  return path.startsWith(literal.split("*")[0]);
}
