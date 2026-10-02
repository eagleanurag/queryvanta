/**
 * Anonymous product analytics client (task 5.2).
 *
 * Implements the client half of the 5.1 design, section 6.3. The server
 * half - the allow-lists, the aggregation and the storage shape - is in
 * `server/analytics.ts` and is the authority for what is valid. This module
 * deliberately does NOT duplicate those allow-lists: a second copy would
 * drift, and a client that filtered on a stale list would silently start
 * sending values the server rejects. Callers pass what they know; the
 * server decides what is allowed.
 *
 * NOTHING HERE MAY AFFECT THE LEARNER
 * ------------------------------------
 * Every failure path is swallowed. A blocked request, a 404 from a
 * deployment with no Worker, a malformed response, a network error and an
 * exception inside a listener all resolve to "do nothing". There is no
 * retry, because retrying a non-critical signal amplifies load for no
 * benefit and risks double counting, and there is no surfaced error state,
 * because a product analytics failure is not the user's problem.
 *
 * ASK WHETHER THERE IS A BACKEND BEFORE POSTING
 * ---------------------------------------------
 * The GitHub Pages deployment is static and serves no `/api/*`. An
 * unconditional POST therefore fails on every flush there, and a failed
 * request is not silent: the browser logs a console error for it, so the
 * collector was filling every visitor's console and failing the
 * repository's own `expectNoAppErrors` browser gate.
 *
 * Rather than invent a second liveness check, this asks `probeApi()`
 * from `./adminApi` - the function that already answers "is a backend
 * deployed here?". Its `no_backend` result is the established signal:
 * `readEnvelope` treats a non-JSON response as "no backend", which is
 * exactly what a static host returns.
 *
 * THE PROBE CANNOT BE THE FIRST THING THAT HAPPENS
 * -----------------------------------------------
 * A probe is itself a request to `/api/health`, and a request to a path
 * a static host does not serve is NOT silent: the browser logs a
 * console error for it. So probing to discover "there is no API" costs
 * exactly the console error this module exists to stop. Measuring it on
 * the dev server: `GET api/health` returns 404 to a `fetch` (Vite only
 * applies its SPA fallback to requests that accept HTML), so the probe
 * would trade one analytics 404 for one probe 404.
 *
 * The answer is therefore read from the build target instead, which is
 * a fact already available with no request at all:
 * `config/deploy-targets.ts` records `hasApi` per target and the build
 * forwards it as `VITE_QV_API_AVAILABLE`. On a Pages build the collector
 * never probes and never posts, so a static deployment issues ZERO
 * `/api/*` requests and its console stays clean.
 *
 * `hasApi: true` is not treated as proof of health. On a Worker build
 * the collector still confirms the API once at runtime through
 * `probeApi()`, which is also what catches a misconfigured deployment.
 *
 * The runtime answer is resolved AT MOST ONCE per page load, on the
 * first event, and every concurrent caller shares that one in-flight
 * request. There is no probe per event, no retry, and no re-probing
 * after a negative answer: a deployment's backend does not appear while
 * a tab is open.
 *
 * THE SENDER IS THE ONLY NETWORK CALLER
 * -------------------------------------
 * Nothing here reads the DOM, inspects a question, touches a session cookie
 * or constructs a URL from user input. The event and its allow-listed
 * properties are the entire payload, which is what makes the 5.1 privacy
 * position achievable from the client side rather than merely enforced on
 * the server.
 */

import { probeApi } from "./adminApi";

/** A single queued event, in the wire shape the ingest endpoint accepts. */
type QueuedEvent = {
  /** UTC date, YYYY-MM-DD. */
  d: string;
  /** Event name from the server allow-list. */
  e: string;
  /** Allow-listed properties only. */
  p: Record<string, string>;
};

/**
 * Hard cap on queued events.
 *
 * The queue lives in memory for the lifetime of the tab, so without a bound
 * a long-lived session could grow it without limit. Beyond the cap the
 * OLDEST events are dropped, not the newest: recent events are the ones
 * most likely to still be in the learner's mind, and the oldest are the
 * ones whose loss matters least.
 */
const MAX_QUEUE = 200;

/**
 * Flush interval.
 *
 * Long enough that a typical session of a few events produces a single
 * request, short enough that a tab closed abruptly still reports most of
 * what happened.
 */
const FLUSH_INTERVAL_MS = 15_000;

/** Event types the product reports. */
export type AnalyticsEvent =
  | { name: "question_viewed"; engine: string; difficulty: string; categoryBucket: string }
  | { name: "question_submitted"; engine: string; difficulty: string; outcome: string }
  | { name: "practice_started"; engine: string }
  | { name: "practice_completed"; engine: string; outcome: string }
  | { name: "interview_started"; engine: string }
  | { name: "page_viewed"; pageKind: string };

const INGEST_PATH = "api/analytics/events";

/**
 * Server-authoritative maximum events per request. Exceeding it would earn
 * a 413, so the client splits at exactly this boundary rather than
 * discovering the limit by being rejected.
 */
const MAX_EVENTS_PER_REQUEST = 25;

let queue: QueuedEvent[] = [];
let timer: number | null = null;
let started = false;

/**
 * Whether the build expects an API to exist.
 *
 * `undefined` means the build did not say, in which case the collector
 * falls back to probing once at runtime rather than assuming either way.
 */
function buildExpectsApi(): boolean | undefined {
  const raw = import.meta.env.VITE_QV_API_AVAILABLE;

  if (raw === "true") {
    return true;
  }

  if (raw === "false") {
    return false;
  }

  return undefined;
}

/**
 * The build-time starting point.
 *
 * A build that says "no API here" starts already suppressed, which is
 * what keeps a static deployment at zero `/api/*` requests. A build that
 * says "an API should be here" starts UNDETERMINED rather than
 * confirmed, so the runtime probe still runs exactly once and can catch
 * a misconfigured or half-deployed origin.
 */
const INITIAL_AVAILABILITY: boolean | null =
  buildExpectsApi() === false ? false : null;

/**
 * Whether a backend exists on this origin.
 *
 * `null` means "not determined yet". It is a tri-state rather than a
 * boolean so that a negative answer can suppress permanently while an
 * unanswered question still allows exactly one probe.
 */
let apiAvailable: boolean | null = INITIAL_AVAILABILITY;

/**
 * The single in-flight probe.
 *
 * Held so that N events queued before the probe resolves share one
 * request instead of producing N. It is deliberately never cleared: a
 * deployment that has no backend does not grow one while the tab is
 * open, so re-probing could only ever re-confirm `false`.
 */
let probeInFlight: Promise<boolean> | null = null;

/**
 * Resolve API availability once, and cache the answer.
 *
 * Safe to call concurrently and repeatedly. Callers that arrive after the
 * answer is known get it synchronously-equivalent; callers that arrive
 * during the probe share its promise. Any throw - including a thrown
 * `probeApi()` - is treated as "no backend", because a probe that cannot
 * complete is not evidence that a backend exists.
 */
function ensureApiAvailability(): Promise<boolean> {
  if (apiAvailable !== null) {
    return Promise.resolve(apiAvailable);
  }

  if (probeInFlight === null) {
    probeInFlight = (async () => {
      try {
        apiAvailable = await probeApi();
      } catch {
        apiAvailable = false;
      }

      return apiAvailable;
    })();
  }

  return probeInFlight;
}

/** Drop the queue and stop, because there is nowhere to send it. */
function suppress(): void {
  queue = [];
}

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isBrowser(): boolean {
  return typeof document !== "undefined";
}

/** URL of the ingest endpoint, relative to the deployment base. */
function ingestUrl(): string {
  const base = import.meta.env.BASE_URL ?? "/";

  return new URL(
    `${base}${INGEST_PATH}`,
    window.location.origin,
  ).toString();
}

/**
 * Queue one event.
 *
 * Returns immediately and never throws. A caller on the critical path of a
 * question render or a navigation must not be able to fail because of
 * analytics, so every step is guarded.
 */
export function trackEvent(event: AnalyticsEvent): void {
  try {
    if (!isBrowser()) {
      return;
    }

    // Established as unavailable: do not even queue. Queueing would grow
    // a buffer that can never be sent, and the caller gets the same
    // observable behaviour either way.
    if (apiAvailable === false) {
      return;
    }

    const { name, ...rest } = event;

    const properties: Record<string, string> = {};

    for (const [key, value] of Object.entries(rest)) {
      // `categoryBucket` and `pageKind` are ergonomic client-side names;
      // the wire names are the server's property keys.
      const wireKey = propertyWireName(key);

      if (wireKey !== null && typeof value === "string") {
        properties[wireKey] = value;
      }
    }

    queue.push({
      d: todayUtc(),
      e: name,
      p: properties,
    });

    if (queue.length > MAX_QUEUE) {
      queue = queue.slice(queue.length - MAX_QUEUE);
    }

    // Ask once, on the first event, so the answer is normally already
    // cached by the time the flush interval or a page teardown arrives.
    if (apiAvailable === null) {
      void ensureApiAvailability();
    }

    // A tab that is being hidden is the most likely moment to lose the
    // queue, so flush then rather than waiting for the interval.
    if (document.visibilityState === "hidden") {
      void flush();
    }
  } catch {
    // Analytics must never break a product interaction.
  }
}

function propertyWireName(key: string): string | null {
  switch (key) {
    case "engine":
    case "difficulty":
    case "outcome":
      return key;

    case "categoryBucket":
      return "category_bucket";

    case "pageKind":
      return "page_kind";

    default:
      // An unmapped property is dropped rather than forwarded. Forwarding
      // an unknown key would be a privacy bug, not a convenience: the
      // server rejects it, but the attempt to send it should not happen.
      return null;
  }
}

/**
 * Coarse topic bucket for a question category.
 *
 * The raw `category` is free-form text with no canonical enumeration in
 * this repository, and an administrator can create any string, so it is
 * never sent. This maps it to one of the four buckets the server
 * allow-lists, which is what keeps the stored cardinality bounded
 * regardless of what a category happens to say.
 *
 * Matching is substring-based and case-insensitive, and the fallback is
 * always a real bucket, so this function can never return a value the
 * server would reject.
 */
export function bucketCategory(category: string): string {
  const value = category.toLowerCase();

  if (
    value.includes("pyspark") ||
    value.includes("spark") ||
    value.includes("python")
  ) {
    return "pyspark-family";
  }

  if (
    value.includes("model") ||
    value.includes("schema") ||
    value.includes("design")
  ) {
    return "modeling";
  }

  if (
    value.includes("sql") ||
    value.includes("join") ||
    value.includes("cte") ||
    value.includes("window") ||
    value.includes("filter") ||
    value.includes("aggregat") ||
    value.includes("subquer") ||
    value.includes("date") ||
    value.includes("ranking") ||
    value.includes("duplicate") ||
    value.includes("null") ||
    value.includes("quality") ||
    value.includes("cleaning")
  ) {
    return "sql-family";
  }

  return "other";
}

/** Take up to one request's worth of events off the queue. */
function takeBatch(): QueuedEvent[] {
  if (queue.length === 0) {
    return [];
  }

  const batch = queue.slice(0, MAX_EVENTS_PER_REQUEST);
  queue = queue.slice(batch.length);

  return batch;
}

/**
 * Send one batch.
 *
 * `useBeacon` selects `navigator.sendBeacon`, which is the only transport
 * guaranteed to complete when the page is being torn down. It cannot set
 * headers, which is fine: the ingest endpoint's same-origin check reads
 * `Sec-Fetch-Site`, a forbidden header the browser sets itself.
 */
async function sendBatch(
  batch: QueuedEvent[],
  useBeacon: boolean,
): Promise<void> {
  const body = JSON.stringify({ events: batch });

  if (useBeacon && typeof navigator !== "undefined") {
    const blob = new Blob([body], {
      type: "application/json",
    });

    if (navigator.sendBeacon?.(ingestUrl(), blob)) {
      return;
    }

    // sendBeacon returns false when the payload is refused (for example
    // during unload). Fall through to the keepalive fetch.
  }

  await fetch(ingestUrl(), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
    keepalive: true,
    // No retry, and no retry-after: a failed analytics batch is dropped.
  });
}

/**
 * Flush everything queued.
 *
 * Loops so a backlog larger than one request is drained over successive
 * round trips rather than being silently truncated. Stops early on the
 * first failure, because the events that were dropped stay dropped and
 * retrying would be the thing this design rules out.
 */
export async function flush(): Promise<void> {
  try {
    if (!isBrowser() || queue.length === 0) {
      return;
    }

    // Already known: there is nowhere to send this.
    if (apiAvailable === false) {
      suppress();
      return;
    }

    // Not known yet. This path is asynchronous, so it can wait for the
    // single shared probe rather than posting into a 404. That is what
    // keeps a static deployment down to one request instead of one per
    // flush interval.
    if (apiAvailable === null) {
      await ensureApiAvailability();

      if (apiAvailable === false) {
        suppress();
        return;
      }
    }

    while (queue.length > 0) {
      const batch = takeBatch();

      if (batch.length === 0) {
        return;
      }

      try {
        const response = await sendBatch(batch, false);

        // A 4xx means the payload will never be accepted, so the batch is
        // gone either way. A 5xx or a network failure is dropped too:
        // analytics is not worth a correctness guarantee.
        void response;
      } catch {
        return;
      }
    }
  } catch {
    // Never propagate.
  }
}

/** Flush using a beacon, for the page-teardown path. Synchronous. */
function flushOnUnload(): void {
  try {
    if (!isBrowser()) {
      return;
    }

    // Unlike `flush`, this path cannot await a probe, so it must not post
    // blind. Both a known-negative answer and an unanswered question drop
    // the batch: the page is being torn down either way, and this module's
    // own rule is that a non-critical signal is dropped rather than
    // retried. In practice the probe has already resolved, because it is
    // fired on the first event and a teardown needs a user gesture.
    if (apiAvailable !== true) {
      suppress();
      return;
    }

    const batch = takeBatch();

    if (batch.length === 0) {
      return;
    }

    void sendBatch(batch, true);
  } catch {
    // Never propagate.
  }
}

/**
 * Install the flush timer and lifecycle listeners.
 *
 * Idempotent, so a hot reload or a second caller cannot double-install and
 * double-count. Returns a teardown function; the app does not need to use
 * it, but it keeps the module testable and lets StrictMode's double-mount
 * be handled cleanly.
 */
export function startAnalytics(): () => void {
  if (!isBrowser() || started) {
    return () => undefined;
  }

  started = true;

  const onVisibilityChange = (): void => {
    if (document.visibilityState === "hidden") {
      flushOnUnload();
    }
  };

  const onPageHide = (): void => {
    flushOnUnload();
  };

  timer = window.setInterval(() => {
    void flush();
  }, FLUSH_INTERVAL_MS);

  document.addEventListener(
    "visibilitychange",
    onVisibilityChange,
  );
  window.addEventListener("pagehide", onPageHide);

  return () => {
    started = false;

    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }

    document.removeEventListener(
      "visibilitychange",
      onVisibilityChange,
    );
    window.removeEventListener("pagehide", onPageHide);

    flushOnUnload();
  };
}

/** Test seam: how many events are waiting to be sent. */
export function pendingEventCount(): number {
  return queue.length;
}

/** Test seam: drop everything queued. */
export function resetAnalyticsQueue(): void {
  queue = [];
}

/**
 * Test seam: the cached API-availability answer.
 *
 * `null` means no probe has completed yet.
 */
export function apiAvailability(): boolean | null {
  return apiAvailable;
}

/**
 * Test seam: forget the probe so a later test can determine
 * availability again.
 *
 * Without this the answer is cached for the lifetime of the module,
 * which is the production behaviour and would make a second test in the
 * same page load inherit the first one's verdict. It restores the
 * build-time starting point rather than `null`, so a Pages build stays
 * suppressed even after a reset.
 */
export function resetApiAvailability(): void {
  apiAvailable = INITIAL_AVAILABILITY;
  probeInFlight = null;
}
