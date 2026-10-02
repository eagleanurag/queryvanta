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
 * THE SENDER IS THE ONLY NETWORK CALLER
 * -------------------------------------
 * Nothing here reads the DOM, inspects a question, touches a session cookie
 * or constructs a URL from user input. The event and its allow-listed
 * properties are the entire payload, which is what makes the 5.1 privacy
 * position achievable from the client side rather than merely enforced on
 * the server.
 */

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
