import {
  StrictMode,
  Suspense,
} from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
} from "react-router-dom";

import App from "./App";
import AdminGate from "./components/AdminGate";
import ErrorBoundary from "./components/ErrorBoundary";
import RouteAnalytics from "./components/RouteAnalytics";
import NotFoundPage from "./pages/NotFoundPage";
import {
  AdminLoginPage,
  AdminPage,
  AdminAnalyticsPage,
  InterviewPage,
  LandingPage,
  LearnPage,
  LearnPathPage,
  LearnTopicPage,
  PracticeHistoryDetailPage,
  PracticePage,
  ProgressPage,
  PySparkTestPage,
  QuestionPage,
  RouteLoadingFallback,
} from "./routes";

import { startAnalytics } from "./lib/analytics";

import "./index.css";

// Anonymous product analytics (task 5.2).
//
// Started once at the app entry point, before render, so the flush timer
// and the lifecycle listeners are installed even for a session that never
// triggers a route change. `startAnalytics` is idempotent, so a dev
// hot-reload or a StrictMode double-mount cannot install them twice and
// double-count. Nothing it does can block or fail the render below.
startAnalytics();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter
      basename={import.meta.env.BASE_URL}
    >
      <RouteAnalytics />
      <ErrorBoundary>
        <Suspense
          fallback={<RouteLoadingFallback />}
        >
          <Routes>
            <Route path="/" element={<App />} />

            <Route
              path="/admin/login"
              element={<AdminLoginPage />}
            />

            <Route
              path="/admin"
              element={
                <AdminGate>
                  <AdminPage />
                </AdminGate>
              }
            />

            <Route
              path="/admin/questions"
              element={
                <AdminGate>
                  <AdminPage />
                </AdminGate>
              }
            />

            <Route
              path="/admin/analytics"
              element={
                <AdminGate>
                  <AdminAnalyticsPage />
                </AdminGate>
              }
            />

            <Route
              path="/practice"
              element={<PracticePage />}
            />

            <Route
              path="/practice/history/:sessionId"
              element={
                <PracticeHistoryDetailPage />
              }
            />

            <Route
              path="/learn"
              element={<LearnPage />}
            />

            <Route
              path="/learn/topic/:topicId"
              element={<LearnTopicPage />}
            />

            <Route
              path="/learn/:pathId"
              element={<LearnPathPage />}
            />

            <Route
              path="/interview"
              element={<InterviewPage />}
            />

            <Route
              path="/sql-practice"
              element={<LandingPage slug="sql-practice" />}
            />

            <Route
              path="/pyspark-practice"
              element={
                <LandingPage slug="pyspark-practice" />
              }
            />

            <Route
              path="/data-engineering-practice"
              element={
                <LandingPage slug="data-engineering-practice" />
              }
            />

            <Route
              path="/sql-interview-prep"
              element={
                <LandingPage slug="sql-interview-prep" />
              }
            />

            <Route
              path="/pyspark-interview-prep"
              element={
                <LandingPage slug="pyspark-interview-prep" />
              }
            />

            <Route
              path="/data-analyst-sql"
              element={
                <LandingPage slug="data-analyst-sql" />
              }
            />

            <Route
              path="/big-data-practice"
              element={
                <LandingPage slug="big-data-practice" />
              }
            />

            <Route
              path="/progress"
              element={<ProgressPage />}
            />

            <Route
              path="/pyspark-test"
              element={<PySparkTestPage />}
            />

            <Route
              path="/admin/preview"
              element={
                <AdminGate>
                  <QuestionPage />
                </AdminGate>
              }
            />

            <Route
              path="/question/:questionId"
              element={<QuestionPage />}
            />

            <Route
              path="*"
              element={<NotFoundPage />}
            />
          </Routes>
        </Suspense>
      </ErrorBoundary>
    </BrowserRouter>
  </StrictMode>,
);
