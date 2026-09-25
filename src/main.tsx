import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import {
  BrowserRouter,
  Route,
  Routes,
} from "react-router-dom";

import App from "./App";
import AdminPage from "./pages/AdminPage";
import PracticeHistoryDetailPage from "./pages/PracticeHistoryDetailPage";
import PracticePage from "./pages/PracticePage";
import ProgressPage from "./pages/ProgressPage";
import PySparkTestPage from "./pages/PySparkTestPage";
import QuestionPage from "./pages/QuestionPage";

import "./index.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<App />} />

        <Route path="/admin" element={<AdminPage />} />

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
          element={<PracticeHistoryDetailPage />}
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
      </Routes>
    </BrowserRouter>
  </StrictMode>,
);