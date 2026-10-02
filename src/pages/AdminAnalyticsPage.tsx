import { useEffect, useState } from "react";

import {
  ArrowLeft,
  BarChart3,
  Download,
  Loader2,
} from "lucide-react";

import { Link } from "react-router-dom";

import {
  listAdminAnalytics,
  type AdminAnalytics,
  type AdminAnalyticsCount,
} from "../lib/adminApi";
import SEO from "../components/SEO";

/* -------------------------------------------------------------------------- */
/* shared styles, matching src/pages/AdminPage.tsx                            */
/* -------------------------------------------------------------------------- */

const inputClassName =
  "w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm text-gray-700 outline-none placeholder:text-gray-400 focus:border-gray-400";

const labelClassName =
  "mb-1.5 block text-sm font-medium text-gray-700";

const cardClassName =
  "rounded-xl border border-gray-200 bg-white p-5 shadow-sm";

/* -------------------------------------------------------------------------- */
/* presentation helpers                                                        */
/* -------------------------------------------------------------------------- */

/**
 * Events offered in the filter, with readable labels.
 *
 * These are the server's six allow-listed event names. The page mirrors
 * them for a readable dropdown, but the SERVER remains the authority: an
 * unrecognised name is ignored by the endpoint rather than trusted, so
 * this list cannot widen what can be queried.
 */
const EVENT_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "All events" },
  { value: "page_viewed", label: "Page viewed" },
  { value: "question_viewed", label: "Question viewed" },
  { value: "question_submitted", label: "Question submitted" },
  { value: "practice_started", label: "Practice started" },
  {
    value: "practice_completed",
    label: "Practice completed",
  },
  { value: "interview_started", label: "Interview started" },
];

const EVENT_LABELS: Record<string, string> =
  Object.fromEntries(
    EVENT_OPTIONS.filter((option) => option.value !== "").map(
      (option) => [option.value, option.label],
    ),
  );

const PROPERTY_LABELS: Record<string, string> = {
  engine: "Engine",
  difficulty: "Difficulty",
  outcome: "Outcome",
  category_bucket: "Topic",
  page_kind: "Page",
};

/** Property name for the wire key, or the raw key if it is unfamiliar. */
function propertyLabel(key: string): string {
  if (key === "") {
    return "Total";
  }

  return PROPERTY_LABELS[key] ?? key;
}

function eventLabel(name: string): string {
  return EVENT_LABELS[name] ?? name;
}

/** `YYYY-MM-DD` for today in UTC, matching the server's own date basis. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoDaysAgo(days: number): string {
  return new Date(
    Date.now() - days * 86_400_000,
  )
    .toISOString()
    .slice(0, 10);
}

/* -------------------------------------------------------------------------- */
/* data shaping                                                                */
/* -------------------------------------------------------------------------- */

/** One event, its total, and its dimension breakdown. */
type EventSummary = {
  eventName: string;
  total: number;
  byProperty: { label: string; value: string; count: number }[];
};

/**
 * Fold flat counters into per-event summaries.
 *
 * A row with an empty prop_key is the event's daily total, so summing only
 * those avoids double counting the dimension rows. An empty result is a
 * legitimate state, not an error: 5.2 ships collection before 5.3 ships
 * this page, and a fresh deployment genuinely has no events yet.
 */
function summarise(
  rows: AdminAnalyticsCount[],
): EventSummary[] {
  const byEvent = new Map<
    string,
    { total: number; byProperty: Map<string, number> }
  >();

  for (const row of rows) {
    const entry = byEvent.get(row.eventName) ?? {
      total: 0,
      byProperty: new Map<string, number>(),
    };

    if (row.propKey === "") {
      entry.total += row.count;
    } else {
      const dimension = `${row.propKey}=${row.propValue}`;
      entry.byProperty.set(
        dimension,
        (entry.byProperty.get(dimension) ?? 0) + row.count,
      );
    }

    byEvent.set(row.eventName, entry);
  }

  return [...byEvent.entries()]
    .map(([eventName, entry]) => ({
      eventName,
      total: entry.total,
      byProperty: [...entry.byProperty.entries()]
        .map(([dimension, count]) => {
          const [key = "", value = ""] =
            dimension.split("=");

          return {
            label: propertyLabel(key),
            value,
            count,
          };
        })
        .sort(
          (a, b) =>
            b.count - a.count ||
            a.label.localeCompare(b.label) ||
            a.value.localeCompare(b.value),
        ),
    }))
    .sort((a, b) => b.total - a.total);
}

type LoadState =
  | { kind: "idle" }
  | { kind: "loading" }
  | { kind: "loaded"; data: AdminAnalytics }
  | { kind: "error"; message: string };

/* -------------------------------------------------------------------------- */

function AdminAnalyticsPage() {
  const [from, setFrom] = useState(() =>
    isoDaysAgo(29),
  );
  const [to, setTo] = useState(() => todayUtc());
  const [event, setEvent] = useState("");

  /**
   * Bumped by the Refresh button.
   *
   * The fetch lives in exactly one place, the effect below, which depends
   * on this token as well as the filters. Having a second, separate
   * request path for the button would be two code paths to keep correct
   * and would make the button's behaviour diverge the moment either
   * changed.
   */
  const [reloadToken, setReloadToken] = useState(0);

  /**
   * Starts as `loading`, because the first paint IS a load.
   *
   * The loading state is set from the event handlers that change a filter
   * or request a refresh, never synchronously in the effect body: setting
   * it there would cause a cascading render on every filter change, and
   * the repository already carries baselined instances of that pattern
   * elsewhere. This page does not add another.
   */
  const [state, setState] = useState<LoadState>({
    kind: "loading",
  });

  // Load on mount, on every filter change, and on an explicit refresh.
  // State is only set from inside the async callback.
  useEffect(() => {
    let cancelled = false;

    void (async () => {
      const result = await listAdminAnalytics({
        from,
        to,
        event: event === "" ? null : event,
      });

      if (cancelled) {
        return;
      }

      if (!result.ok) {
        // An explicit error state. The page never presents an empty
        // result as if it were a genuine absence of data, because those
        // two states mean very different things to an operator.
        setState({
          kind: "error",
          message: result.message,
        });

        return;
      }

      setState({ kind: "loaded", data: result.data });
    })();

    return () => {
      cancelled = true;
    };
  }, [from, to, event, reloadToken]);

  /**
   * Apply a filter change and show the spinner immediately.
   *
   * Batching the state update with the event means the visible transition
   * happens in the same render as the change, instead of a second render
   * triggered from inside the effect.
   */
  const changeFilter = (
    apply: () => void,
  ): void => {
    setState({ kind: "loading" });
    apply();
  };

  const summaries =
    state.kind === "loaded"
      ? summarise(state.data.rows)
      : [];

  // A clamped request is surfaced rather than hidden. The server decides
  // the real window, so the inputs are not necessarily the window shown.
  const clamped =
    state.kind === "loaded" &&
    (state.data.from !== from || state.data.to !== to);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <SEO
        meta={{
          title: "Analytics | QueryVanta Admin",
          description:
            "Aggregated anonymous product usage for QueryVanta.",
          canonicalPath: "/admin/analytics",
          robots: "noindex,nofollow",
        }}
      />

      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 px-4 py-5 sm:px-8">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-semibold text-gray-900">
              <BarChart3 size={20} />
              Analytics
            </h1>

            <p className="mt-1 text-sm text-gray-500">
              Anonymous, aggregate-only usage. No
              visitor is identified and no
              individual event is stored.
            </p>
          </div>

          <Link
            to="/admin/questions"
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            <ArrowLeft size={15} />
            Catalog
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-5 px-4 py-6 sm:px-8">
        {/* Filters. Every control is explicitly labelled: an unlabelled
            select is a known accessibility gap in this repository and
            this page must not add another instance of it. The layout
            wraps at narrow widths so the row is usable at a mobile
            viewport. */}
        <section
          className={cardClassName}
          aria-label="Analytics filters"
        >
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label
                htmlFor="analytics-from"
                className={labelClassName}
              >
                From
              </label>

              <input
                id="analytics-from"
                type="date"
                value={from}
                max={to}
                onChange={(changeEvent) =>
                  changeFilter(() =>
                    setFrom(changeEvent.target.value),
                  )
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="analytics-to"
                className={labelClassName}
              >
                To
              </label>

              <input
                id="analytics-to"
                type="date"
                value={to}
                min={from}
                max={todayUtc()}
                onChange={(changeEvent) =>
                  changeFilter(() =>
                    setTo(changeEvent.target.value),
                  )
                }
                className={inputClassName}
              />
            </div>

            <div>
              <label
                htmlFor="analytics-event"
                className={labelClassName}
              >
                Event
              </label>

              <select
                id="analytics-event"
                value={event}
                onChange={(changeEvent) =>
                  changeFilter(() =>
                    setEvent(changeEvent.target.value),
                  )
                }
                className={`${inputClassName} cursor-pointer`}
              >
                {EVENT_OPTIONS.map((option) => (
                  <option
                    key={option.value}
                    value={option.value}
                  >
                    {option.label}
                  </option>
                ))}
              </select>
            </div>

            <div className="flex items-end">
              <button
                type="button"
                onClick={() =>
                  changeFilter(() =>
                    setReloadToken((token) => token + 1),
                  )
                }
                disabled={state.kind === "loading"}
                className="inline-flex w-full items-center justify-center gap-1.5 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50 lg:w-auto"
              >
                {state.kind === "loading" ? (
                  <Loader2
                    size={15}
                    className="animate-spin"
                  />
                ) : (
                  <Download size={15} />
                )}
                Refresh
              </button>
            </div>
          </div>

          <p className="mt-3 text-xs text-gray-500">
            The server caps a single request at 90
            days and never returns data older than the
            retention window.
          </p>
        </section>

        {state.kind === "loading" && (
          <div
            role="status"
            className="flex items-center gap-2 rounded-xl border border-gray-200 bg-white px-5 py-4 text-sm text-gray-500"
          >
            <Loader2
              size={16}
              className="animate-spin"
            />
            Loading analytics
          </div>
        )}

        {state.kind === "error" && (
          <div
            role="alert"
            className="rounded-xl border border-amber-200 bg-amber-50 px-5 py-4 text-sm text-amber-800"
          >
            <p className="font-medium">
              Analytics could not be loaded.
            </p>

            <p className="mt-1">{state.message}</p>
          </div>
        )}

        {state.kind === "loaded" && (
          <>
            {clamped && (
              <p className="rounded-lg border border-gray-200 bg-white px-4 py-3 text-xs text-gray-600">
                The requested range was outside the
                permitted window. Showing{" "}
                <strong className="font-medium text-gray-900">
                  {state.data.from} to {state.data.to}
                </strong>
                .
              </p>
            )}

            {summaries.length === 0 ? (
              <div
                className={`${cardClassName} text-sm leading-6 text-gray-500`}
              >
                <p className="font-medium text-gray-800">
                  No analytics in this range yet.
                </p>

                <p className="mt-1">
                  This is expected on a new
                  deployment. Usage appears here
                  once visitors start using the
                  practice features, and it is stored
                  only as daily totals.
                </p>
              </div>
            ) : (
              <section
                aria-label="Analytics by event"
                className="space-y-4"
              >
                {summaries.map((summary) => (
                  <article
                    key={summary.eventName}
                    className={cardClassName}
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <h2 className="text-sm font-semibold text-gray-900">
                        {eventLabel(summary.eventName)}
                      </h2>

                      <span className="text-sm font-medium text-gray-700">
                        {summary.total.toLocaleString()}
                      </span>
                    </div>

                    {summary.byProperty.length === 0 ? (
                      <p className="mt-2 text-xs text-gray-500">
                        No dimensions recorded for this
                        event.
                      </p>
                    ) : (
                      <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-3 lg:grid-cols-4">
                        {summary.byProperty.map(
                          (dimension) => (
                            <div
                              key={`${dimension.label}:${dimension.value}`}
                              className="rounded-lg bg-gray-50 px-3 py-2"
                            >
                              <dt className="truncate text-[11px] text-gray-500">
                                {dimension.label}
                              </dt>

                              <dd className="mt-0.5 flex items-baseline justify-between gap-2">
                                <span className="truncate text-xs font-medium text-gray-800">
                                  {dimension.value === ""
                                    ? "(none)"
                                    : dimension.value}
                                </span>

                                <span className="shrink-0 text-xs text-gray-600">
                                  {dimension.count.toLocaleString()}
                                </span>
                              </dd>
                            </div>
                          ),
                        )}
                      </dl>
                    )}
                  </article>
                ))}
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}

// Default export to match the lazy() route contract in `src/routes.tsx`.
export default AdminAnalyticsPage;
