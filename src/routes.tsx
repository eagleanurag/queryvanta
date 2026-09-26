import { lazy } from "react";

// Route-level code splitting: the Questions home
// stays in the initial bundle while heavier pages
// (notably the PGlite and PySpark execution paths
// pulled in by QuestionPage/AdminPage) load on
// demand. Kept in this module (components only) so
// fast-refresh linting stays happy.

export const AdminPage = lazy(
  () => import("./pages/AdminPage"),
);

export const InterviewPage = lazy(
  () => import("./pages/InterviewPage"),
);

export const LearnPage = lazy(
  () => import("./pages/LearnPage"),
);

export const LearnPathPage = lazy(
  () => import("./pages/LearnPathPage"),
);

export const LearnTopicPage = lazy(
  () => import("./pages/LearnTopicPage"),
);

export const LandingPage = lazy(
  () => import("./pages/LandingPage"),
);

export const PracticeHistoryDetailPage = lazy(
  () =>
    import("./pages/PracticeHistoryDetailPage"),
);

export const PracticePage = lazy(
  () => import("./pages/PracticePage"),
);

export const ProgressPage = lazy(
  () => import("./pages/ProgressPage"),
);

export const PySparkTestPage = lazy(
  () => import("./pages/PySparkTestPage"),
);

export const QuestionPage = lazy(
  () => import("./pages/QuestionPage"),
);

export function RouteLoadingFallback() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9] p-8">
      <p
        role="status"
        className="text-sm text-gray-500"
      >
        Loading page…
      </p>
    </div>
  );
}
