import { StrictMode, Suspense } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
} from "react-router-dom";

import App from "./App";
import ErrorBoundary from "./components/ErrorBoundary";
import NotFoundPage from "./pages/NotFoundPage";
import {
  AdminPage,
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

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter
      basename={import.meta.env.BASE_URL}
    >
      <ErrorBoundary>
        <Suspense
          fallback={<RouteLoadingFallback />}
        >
          <Routes>
            <Route path="/" element={<App />} />

            <Route
              path="/admin"
              element={<AdminPage />}
            />

            <Route
              path="/admin/questions"
              element={<AdminPage />}
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
              element={<QuestionPage />}
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
