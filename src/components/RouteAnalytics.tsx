/**
 * Route-view reporting for anonymous product analytics (task 5.2).
 *
 * Lives in its own module rather than in the app entry point for one
 * concrete reason: `react-refresh` only supports fast refresh for a file
 * that exports components and nothing else, so keeping this component
 * beside the `createRoot` call in `main.tsx` breaks hot reload for the
 * whole entry point.
 */

import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";

import { trackEvent } from "../lib/analytics";

/**
 * Route class for a pathname.
 *
 * A CLASS, not a URL, and one of the eight values the server allow-lists.
 * Sending the raw path instead would make the stored cardinality a function
 * of how many pages, question ids and filter combinations exist, which is
 * exactly the unbounded-dimension failure the aggregation design exists to
 * prevent.
 *
 * Admin routes are deliberately NOT reported: administration is a single
 * operator, not product usage, and mixing it into "which pages earn their
 * keep" would be a category error.
 *
 * Module-local rather than exported: this file exports only a component, so
 * that React Fast Refresh keeps working for it.
 */
function pageKindFor(pathname: string): string {
  if (pathname.startsWith("/admin")) {
    return "other";
  }

  if (pathname === "/") {
    return "discover";
  }

  if (pathname.startsWith("/practice")) {
    return "practice";
  }

  if (pathname.startsWith("/learn")) {
    return "learn";
  }

  if (pathname.startsWith("/interview")) {
    return "interview";
  }

  if (pathname.startsWith("/progress")) {
    return "progress";
  }

  if (pathname.startsWith("/question")) {
    return "question";
  }

  // The generated landing pages are the only remaining public routes.
  return "landing";
}

/**
 * Reports one `page_viewed` per navigation.
 *
 * The ref guard matters: React 18 StrictMode mounts effects twice in
 * development, and without it every page view would be counted twice in dev
 * and never in production, which is the worst possible shape for a metric -
 * the number would look right in the one environment nobody checks.
 */
export default function RouteAnalytics() {
  const location = useLocation();
  const lastPathname = useRef<string | null>(null);

  useEffect(() => {
    if (lastPathname.current === location.pathname) {
      return;
    }

    lastPathname.current = location.pathname;

    trackEvent({
      name: "page_viewed",
      pageKind: pageKindFor(location.pathname),
    });
  }, [location.pathname]);

  return null;
}
