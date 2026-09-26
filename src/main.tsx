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
    <BrowserRouter>
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
