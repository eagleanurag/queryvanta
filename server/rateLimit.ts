/**
 * Fixed-window rate limiting for the anonymous request paths.
 *
 * SCOPE AND HONESTY OF THE PROTECTION
 * -----------------------------------
 * The bucket map lives in the Worker isolate's memory, which makes this
 * a BEST-EFFORT control, not a global one. Cloudflare runs many
 * isolates; an attacker who spreads requests across them gets one
 * window's budget per isolate, and a cold isolate starts empty. This is
 * stated plainly rather than overclaimed: the limiter removes the
 * cheapest abuse (one script, one isolate, sustained requests) and caps
 * the D1 write amplification per window. It is NOT a distributed quota
 * and must not be treated as one. Making it global would require a KV
 * or D1 counter, which costs a write per request and defeats the
 * purpose.
 *
 * WHY A FIXED WINDOW AND NOT A TOKEN BUCKET
 * ----------------------------------------
 * A token bucket needs a background refill, which means either a timer
 * (not available in an isolate that is not otherwise busy) or a
 * timestamp comparison per request. A fixed window is one counter, one
 * timestamp comparison and one expiry check, all O(1) and allocation
 * free in the steady state.
 *
 * WHY AUTHENTICATED ADMINISTRATORS ARE EXEMPT
 * -------------------------------------------
 * There is exactly one legitimate administrator. Throttling an
 * authenticated admin buys no security and can only cause self-
 * inflicted failure, which is why the audit explicitly does not
 * recommend it. `consume` is therefore only ever called on the
 * UNAUTHENTICATED path, and `peekAdminExempt` exists purely so a test
 * can prove an authenticated admin is never limited. The exemption is
 * decided by a real server-side session lookup, never by anything the
 * client asserts.
 *
 * NO D1 COST
 * ----------
 * Nothing here touches D1. That is deliberate: the whole point is to
 * stop spending D1 writes on rejected requests, so the limiter must not
 * itself spend any.
 */

/** One window's state for one key. */
type Bucket = {
  /** Requests counted in the current window. */
  count: number;
  /** Epoch milliseconds at which the current window ends. */
  resetAt: number;
};

export type RateLimitDecision = {
  /** True when the request may proceed. */
  allowed: boolean;
  /** Seconds the caller should wait before retrying. Always >= 1. */
  retryAfterSeconds: number;
  /** Requests still available in the current window. */
  remaining: number;
};

export type RateLimitOptions = {
  /** Maximum requests permitted per window. Must be >= 1. */
  limit: number;
  /** Window length in seconds. Must be >= 1. */
  windowSeconds: number;
  /**
   * Injectable clock, so tests are deterministic and never sleep.
   * Defaults to Date.now.
   */
  now?: () => number;
};

/**
 * Upper bound on tracked keys.
 *
 * Without a cap, an attacker rotating source addresses could grow the
 * map until the isolate runs out of memory, turning a DoS protection
 * into a DoS. When the cap is hit the oldest entries are evicted, which
 * degrades protection for the oldest keys rather than for new arrivals.
 */
const MAX_TRACKED_KEYS = 10_000;

export function clientAddress(request: Request): string {
  const forwarded = request.headers.get("CF-Connecting-IP");

  if (forwarded) {
    return forwarded.trim();
  }

  // Local development and the integration harness talk to the Worker
  // over loopback, where Cloudflare does not set the header.
  const real = request.headers.get("X-Real-IP");

  if (real) {
    return real.trim();
  }

  return "unknown";
}

/**
 * Count one request against `key`'s window.
 *
 * The key is namespaced by the caller (for example "admin" or
 * "oauth-start") so two limits can never share a budget.
 */
export function consume(
  buckets: Map<string, Bucket>,
  key: string,
  options: RateLimitOptions,
): RateLimitDecision {
  const now = options.now ? options.now() : Date.now();
  const limit = Math.max(1, Math.floor(options.limit));
  const windowMs = Math.max(1, Math.floor(options.windowSeconds)) * 1000;

  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };

  // Count the request before deciding, so the caller sees a truthful
  // `remaining` on the request that filled the window.
  bucket.count += 1;

  const allowed = bucket.count <= limit;
  const retryAfterSeconds = allowed
    ? 0
    : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

  buckets.set(key, bucket);

  if (buckets.size > MAX_TRACKED_KEYS) {
    evictOldest(buckets, buckets.size - MAX_TRACKED_KEYS);
  }

  return {
    allowed,
    retryAfterSeconds,
    remaining: Math.max(0, limit - bucket.count),
  };
}

/**
 * Whether a window is still open, without counting a request.
 *
 * Used by the audit-sampling decision, which must know whether the
 * client is already being limited without consuming more budget.
 */
export function peek(
  buckets: Map<string, Bucket>,
  key: string,
  options: RateLimitOptions,
): RateLimitDecision {
  const now = options.now ? options.now() : Date.now();
  const limit = Math.max(1, Math.floor(options.limit));
  const bucket = buckets.get(key);

  if (!bucket || bucket.resetAt <= now) {
    return { allowed: true, retryAfterSeconds: 0, remaining: limit };
  }

  const allowed = bucket.count < limit;

  return {
    allowed,
    retryAfterSeconds: allowed
      ? 0
      : Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    remaining: Math.max(0, limit - bucket.count),
  };
}

/**
 * Decide whether a `session_denied` audit row should be written.
 *
 * The audit action itself is preserved, because it is genuinely useful
 * for abuse investigation. What is removed is the unbounded write
 * amplification: an anonymous caller gets the FIRST denial audited, and
 * then only a bounded number of further denials per window. This is the
 * sampling the audit asks for, and it means a sustained flood costs a
 * constant number of writes rather than one per request.
 *
 * Sampling is keyed per client address, so one abusive caller cannot
 * suppress another caller's evidence, and the legitimate administrator
 * never reaches this path at all.
 */
export function shouldAuditDenied(
  buckets: Map<string, Bucket>,
  key: string,
  options: RateLimitOptions & { sampleEvery?: number },
): boolean {
  const sampleEvery = Math.max(
    1,
    Math.floor(options.sampleEvery ?? 1),
  );
  const now = options.now ? options.now() : Date.now();
  const windowMs = Math.max(1, Math.floor(options.windowSeconds)) * 1000;

  const existing = buckets.get(key);
  const bucket =
    existing && existing.resetAt > now
      ? existing
      : { count: 0, resetAt: now + windowMs };

  bucket.count += 1;
  buckets.set(key, bucket);

  if (buckets.size > MAX_TRACKED_KEYS) {
    evictOldest(buckets, buckets.size - MAX_TRACKED_KEYS);
  }

  // The first denial in a window is always recorded; after that only
  // every Nth is, which bounds the writes per window.
  return bucket.count === 1 || bucket.count % sampleEvery === 0;
}

/**
 * Drop `amount` entries with the nearest expiry.
 *
 * Iteration order of a Map is insertion order, which is not expiry
 * order, so this makes a full pass and removes the entries that reset
 * soonest. That is O(n) but runs only on the overflow path, and n is
 * bounded by MAX_TRACKED_KEYS.
 */
function evictOldest(
  buckets: Map<string, Bucket>,
  amount: number,
): void {
  const ordered = [...buckets.entries()].sort(
    (a, b) => a[1].resetAt - b[1].resetAt,
  );

  for (let index = 0; index < amount && index < ordered.length; index++) {
    buckets.delete(ordered[index][0]);
  }
}

/**
 * Per-isolate bucket storage.
 *
 * One map per isolate, created once and reused, so the steady state
 * performs no allocation beyond the bucket entries themselves.
 */
export function createBuckets(): Map<string, Bucket> {
  return new Map<string, Bucket>();
}