import { useMemo, useState } from "react";

import {
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  Database,
  Play,
  Sparkles,
} from "lucide-react";

import {
  Link,
  useParams,
} from "react-router-dom";

import Breadcrumbs from "../components/Breadcrumbs";
import QuestionCard from "../components/QuestionCard";
import SEO from "../components/SEO";
import {
  getBookmarkedQuestionIds,
  toggleQuestionBookmark,
} from "../lib/bookmarks";
import {
  getLandingPage,
  type LandingPageDef,
} from "../lib/landingPages";
import { useActiveCatalog } from "../lib/learning";
import {
  breadcrumbJsonLd,
  itemListJsonLd,
  NOT_FOUND_SEO,
  pageSeo,
} from "../lib/seo";
import { getSolvedQuestionIds } from "../lib/progress";
import type { Question } from "../data/questions";

const DIFFICULTY_RANK: Record<string, number> = {
  Easy: 0,
  Medium: 1,
  Hard: 2,
};

function matchesLanding(
  question: Question,
  page: LandingPageDef,
): boolean {
  const { matcher } = page;

  if (
    matcher.questionTypes !== undefined &&
    matcher.questionTypes.length > 0 &&
    !matcher.questionTypes.includes(
      question.questionType,
    )
  ) {
    return false;
  }

  if (
    matcher.categories !== undefined &&
    matcher.categories.length > 0 &&
    !matcher.categories.includes(
      question.category,
    )
  ) {
    return false;
  }

  if (
    matcher.difficulties !== undefined &&
    matcher.difficulties.length > 0 &&
    !matcher.difficulties.includes(
      question.difficulty,
    )
  ) {
    return false;
  }

  return true;
}

function sampleQuestions(
  pool: Question[],
): Question[] {
  const picked: Question[] = [];
  const seen = new Set<string>();

  for (const difficulty of [
    "Easy",
    "Medium",
    "Hard",
  ] as const) {
    for (const question of pool) {
      if (
        picked.length >= 6 ||
        question.difficulty !== difficulty ||
        seen.has(question.id)
      ) {
        continue;
      }

      seen.add(question.id);
      picked.push(question);
    }
  }

  return picked.sort(
    (a, b) =>
      DIFFICULTY_RANK[a.difficulty] -
      DIFFICULTY_RANK[b.difficulty],
  );
}

function executionNote(
  execution: LandingPageDef["execution"],
): string {
  if (execution === "sql") {
    return "SQL questions run on PostgreSQL directly in your browser via PGlite — no setup needed.";
  }

  if (execution === "pyspark") {
    return "PySpark questions run on a real Spark 4.2.0 engine through Spark Connect, right in your browser.";
  }

  return "SQL runs on in-browser PostgreSQL and PySpark runs on a real Spark engine — everything executes for real.";
}

function LandingPage({
  slug: slugProp,
}: {
  slug?: string;
} = {}) {
  const { slug: slugParam } = useParams();
  const slug = slugProp ?? slugParam;
  const catalog = useActiveCatalog();
  const page = getLandingPage(slug);

  const pool = useMemo(
    () =>
      page
        ? catalog.filter((question) =>
            matchesLanding(question, page),
          )
        : [],
    [catalog, page],
  );

  const samples = useMemo(
    () => sampleQuestions(pool),
    [pool],
  );

  const topics = useMemo(() => {
    const names = new Set<string>();

    for (const question of pool) {
      if (question.category.trim() !== "") {
        names.add(question.category.trim());
      }
    }

    return [...names].sort((a, b) =>
      a.localeCompare(b),
    );
  }, [pool]);

  const [solvedIds] = useState<Set<string>>(
    () => getSolvedQuestionIds(),
  );

  const [bookmarkedIds, setBookmarkedIds] =
    useState<Set<string>>(() =>
      getBookmarkedQuestionIds(),
    );

  const handleToggleBookmark = (
    questionId: string,
  ) => {
    toggleQuestionBookmark(questionId);
    setBookmarkedIds(getBookmarkedQuestionIds());
  };

  if (!page) {
    return (
      <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
        <SEO meta={NOT_FOUND_SEO} />

        <div className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center p-8 text-center">
          <h1 className="text-xl font-semibold text-gray-900">
            Page not found
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            This practice topic does not
            exist.
          </p>

          <Link
            to="/"
            className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <ArrowLeft size={16} />
            Back to Questions
          </Link>
        </div>
      </div>
    );
  }

  const meta = pageSeo(
    page.title,
    page.description,
    `/${page.slug}`,
  );

  const crumbs = [
    { name: "Home", path: "/" },
    { name: page.navLabel, path: `/${page.slug}` },
  ];

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <SEO
        meta={meta}
        jsonLd={[
          breadcrumbJsonLd(crumbs),
          itemListJsonLd(
            page.h1,
            page.description,
            `/${page.slug}`,
            samples.map((question) => ({
              name: question.title,
              path: `/question/${question.id}`,
            })),
          ),
        ]}
      />

      <header className="border-b border-gray-200 bg-white">
        <div className="flex h-[72px] items-center px-4 sm:px-8">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={17} />
            Back to Questions
          </Link>

          <div className="mx-4 h-5 w-px bg-gray-200" />

          <span className="flex items-center gap-2 text-sm font-medium text-gray-900">
            {page.execution === "pyspark" ? (
              <Sparkles size={17} />
            ) : (
              <Database size={17} />
            )}
            {page.navLabel}
          </span>
        </div>
      </header>

      <main className="p-4 sm:p-8">
        <div className="mx-auto max-w-[1000px]">
          <Breadcrumbs items={crumbs} />

          <h1 className="mt-4 text-2xl font-semibold text-gray-900 sm:text-3xl">
            {page.h1}
          </h1>

          <p className="mt-2 max-w-3xl text-sm leading-6 text-gray-500 sm:text-base">
            {page.standfirst}
          </p>

          <section
            aria-label="Introduction"
            className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            {page.intro.map((paragraph, index) => (
              <p
                key={index}
                className="mt-3 text-sm leading-6 text-gray-600 first:mt-0"
              >
                {paragraph}
              </p>
            ))}

            <p className="mt-4 flex items-center gap-2 rounded-lg bg-gray-50 px-4 py-3 text-sm font-medium text-gray-900">
              <CheckCircle2
                size={16}
                className="shrink-0 text-emerald-600"
              />
              {pool.length} practice question
              {pool.length === 1 ? "" : "s"}{" "}
              available right now — free, in your
              browser.
            </p>

            <p className="mt-3 text-xs leading-5 text-gray-500">
              {executionNote(page.execution)}
            </p>
          </section>

          {page.sections.map((section) => (
            <section
              key={section.heading}
              aria-label={section.heading}
              className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
            >
              <h2 className="font-semibold text-gray-900">
                {section.heading}
              </h2>

              {section.body.map(
                (paragraph, index) => (
                  <p
                    key={index}
                    className="mt-3 text-sm leading-6 text-gray-600"
                  >
                    {paragraph}
                  </p>
                ),
              )}

              {section.bullets && (
                <ul className="mt-3 list-disc space-y-1.5 pl-5 text-sm leading-6 text-gray-600">
                  {section.bullets.map((bullet) => (
                    <li key={bullet}>
                      {bullet}
                    </li>
                  ))}
                </ul>
              )}
            </section>
          ))}

          <section
            aria-label="Topics covered"
            className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="font-semibold text-gray-900">
              Topics covered
            </h2>

            {topics.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">
                No topics are available in this
                area right now — check back
                after new questions are added.
              </p>
            ) : (
              <ul className="mt-3 flex flex-wrap gap-2">
                {topics.map((topic) => (
                  <li
                    key={topic}
                    className="rounded-md bg-gray-100 px-2.5 py-1 text-xs font-medium text-gray-600"
                  >
                    {topic}
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section
            aria-label="Sample questions"
            className="mt-6"
          >
            <h2 className="font-semibold text-gray-900">
              Sample questions
            </h2>

            {samples.length === 0 ? (
              <p className="mt-3 text-sm text-gray-500">
                Sample questions will appear
                here once this area has
                matching questions.
              </p>
            ) : (
              <div className="mt-3 space-y-4">
                {samples.map((question) => (
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
          </section>

          <section
            aria-label="Keep practicing"
            className="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
          >
            <div className="rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
              <h2 className="font-semibold text-gray-900">
                Learning paths
              </h2>

              <ul className="mt-3 space-y-2">
                {page.learnPaths.map((path) => (
                  <li key={path.id}>
                    <Link
                      to={`/learn/${path.id}`}
                      className="flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900 hover:underline"
                    >
                      {path.label}
                      <ArrowRight size={14} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-xl border border-gray-900 bg-gray-900 p-6 text-white shadow-sm">
              <h2 className="font-semibold">
                Test yourself
              </h2>

              <p className="mt-1 text-sm leading-6 text-gray-300">
                Run a timed mock interview on
                these topics with real
                execution and review.
              </p>

              <Link
                to="/interview"
                className="mt-4 inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-gray-900 hover:bg-gray-100"
              >
                <Play size={16} />
                Open Interview Practice
              </Link>
            </div>
          </section>

          <nav
            aria-label="Related practice areas"
            className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm"
          >
            <h2 className="font-semibold text-gray-900">
              Related practice areas
            </h2>

            <ul className="mt-3 flex flex-wrap gap-2">
              {page.siblings.map((sibling) => (
                <li key={sibling.slug}>
                  <Link
                    to={`/${sibling.slug}`}
                    className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium text-gray-600 hover:bg-gray-50 hover:text-gray-900"
                  >
                    {sibling.label}
                    <ArrowRight size={13} />
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </div>
      </main>
    </div>
  );
}

export default LandingPage;
