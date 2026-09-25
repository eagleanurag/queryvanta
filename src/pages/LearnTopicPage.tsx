import {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  ArrowLeft,
  Play,
} from "lucide-react";

import {
  Link,
  useNavigate,
  useParams,
} from "react-router-dom";

import {
  getSolvedQuestionIds,
  PROGRESS_EVENT,
} from "../lib/progress";
import {
  BOOKMARKS_EVENT,
  getBookmarkedQuestionIds,
  toggleQuestionBookmark,
} from "../lib/bookmarks";
import {
  getTopic,
  launchPracticeSession,
  selectSessionQuestionIds,
  useActiveCatalog,
} from "../lib/learning";
import PracticeSetupModal from "../components/PracticeSetupModal";
import QuestionCard from "../components/QuestionCard";

function LearnTopicPage() {
  const { topicId } = useParams();
  const navigate = useNavigate();
  const catalog = useActiveCatalog();

  const [solvedIds, setSolvedIds] = useState<Set<string>>(
    () => getSolvedQuestionIds(),
  );
  const [bookmarkedIds, setBookmarkedIds] = useState<
    Set<string>
  >(() => getBookmarkedQuestionIds());
  const [setupOpen, setSetupOpen] = useState(false);

  useEffect(() => {
    const syncState = () => {
      setSolvedIds(getSolvedQuestionIds());
      setBookmarkedIds(getBookmarkedQuestionIds());
    };

    window.addEventListener(
      PROGRESS_EVENT,
      syncState,
    );
    window.addEventListener(
      BOOKMARKS_EVENT,
      syncState,
    );
    window.addEventListener(
      "storage",
      syncState,
    );

    return () => {
      window.removeEventListener(
        PROGRESS_EVENT,
        syncState,
      );
      window.removeEventListener(
        BOOKMARKS_EVENT,
        syncState,
      );
      window.removeEventListener(
        "storage",
        syncState,
      );
    };
  }, []);

  const topic = useMemo(
    () => getTopic(catalog, solvedIds, topicId),
    [catalog, solvedIds, topicId],
  );

  const handleToggleBookmark = (
    questionId: string,
  ) => {
    toggleQuestionBookmark(questionId);
    setBookmarkedIds(getBookmarkedQuestionIds());
  };

  const startTopicPractice = (
    size: number,
    mode: "sequential" | "random",
  ) => {
    if (!topic || topic.questions.length === 0) {
      return;
    }

    const selectedIds = selectSessionQuestionIds(
      topic.questions.map(
        (question) => question.id,
      ),
      size,
      mode,
    );

    const launched = launchPracticeSession(navigate, {
      questionIds: selectedIds,
      launchSearch: "",
      availableCount: topic.questions.length,
      mode,
      origin: "learning",
      originLabel: `Topic · ${topic.name}`,
      originPath: `/learn/topic/${topic.id}`,
    });

    if (launched) {
      setSetupOpen(false);
    }
  };

  if (!topic) {
    return (
      <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
        <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">
            Topic not found
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            This topic has no questions in the
            current catalog.
          </p>

          <Link
            to="/learn"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <ArrowLeft size={16} />
            Back to Learn
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex h-[72px] items-center px-8">
          <Link
            to="/learn"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={17} />
            Back to Learn
          </Link>

          <div className="mx-4 h-5 w-px bg-gray-200" />

          <span className="text-sm font-medium text-gray-900">
            Topic
          </span>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-[1000px]">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                {topic.name}
              </h1>

              <p className="mt-1 text-sm text-gray-500">
                {topic.completed} of{" "}
                {topic.total} completed ·{" "}
                {topic.rate}% · Easy{" "}
                {topic.byDifficulty.Easy} ·
                Medium{" "}
                {topic.byDifficulty.Medium} ·
                Hard {topic.byDifficulty.Hard}
              </p>
            </div>

            <button
              type="button"
              disabled={topic.questions.length === 0}
              onClick={() => setSetupOpen(true)}
              className="flex shrink-0 items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-gray-900"
            >
              <Play size={16} />
              Start Practice
            </button>
          </div>

          {topic.questions.length === 0 ? (
            <p className="mt-6 text-sm text-gray-500">
              No questions in this topic right
              now.
            </p>
          ) : (
            <div className="mt-6 space-y-4">
              {topic.questions.map((question) => (
                <QuestionCard
                  key={question.id}
                  question={question}
                  isSolved={solvedIds.has(
                    question.id,
                  )}
                  isBookmarked={bookmarkedIds.has(
                    question.id,
                  )}
                  onToggleBookmark={
                    handleToggleBookmark
                  }
                  discoverySearch=""
                />
              ))}
            </div>
          )}
        </div>
      </main>

      {setupOpen && topic.questions.length > 0 && (
        <PracticeSetupModal
          availableCount={topic.questions.length}
          onClose={() => setSetupOpen(false)}
          onStart={startTopicPractice}
        />
      )}
    </div>
  );
}

export default LearnTopicPage;
