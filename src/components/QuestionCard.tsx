import {
  CheckCircle2,
  Star,
} from "lucide-react";

import { Link } from "react-router-dom";

import type { Question } from "../data/questions";

type QuestionCardProps = {
  question: Question;
  isSolved: boolean;
};

function QuestionCard({
  question,
  isSolved,
}: QuestionCardProps) {
  return (
    <Link
      to={`/question/${question.id}`}
      className="block rounded-lg border border-gray-100 p-5 transition hover:border-gray-200 hover:bg-gray-50 hover:shadow-sm"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          {/* Difficulty + type + category + solved */}
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={`rounded-md px-2 py-1 text-xs font-medium ${
                question.difficulty === "Easy"
                  ? "bg-emerald-50 text-emerald-600"
                  : question.difficulty === "Medium"
                    ? "bg-amber-50 text-amber-600"
                    : "bg-red-50 text-red-500"
              }`}
            >
              {question.difficulty}
            </span>

            <span className="rounded-md bg-blue-50 px-2 py-1 text-xs font-medium text-blue-600">
              {question.questionType}
            </span>

            <span className="text-xs text-gray-400">
              {question.category}
            </span>

            {isSolved && (
              <span className="inline-flex items-center gap-1 rounded-md bg-emerald-50 px-2 py-1 text-xs font-medium text-emerald-600">
                <CheckCircle2 size={12} />
                Solved
              </span>
            )}
          </div>

          {/* Title */}
          <h3 className="mt-3 text-[15px] font-semibold text-gray-900">
            {question.title}
          </h3>

          {/* Description */}
          <p className="mt-1 max-w-2xl text-sm leading-6 text-gray-500">
            {question.description}
          </p>
        </div>

        {/* Bookmark */}
        <span className="shrink-0 rounded-lg p-2 text-gray-400">
          <Star size={18} />
        </span>
      </div>

      {/* Tags */}
      <div className="mt-4 flex flex-wrap gap-2">
        {question.languages.map((language) => (
          <span
            key={language}
            className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500"
          >
            {language}
          </span>
        ))}

        {question.tags.map((tag) => (
          <span
            key={tag}
            className="rounded-md bg-gray-100 px-2 py-1 text-xs text-gray-500"
          >
            {tag}
          </span>
        ))}

        {question.companies.map((company) => (
          <span
            key={company}
            className="rounded-md bg-purple-50 px-2 py-1 text-xs text-purple-600"
          >
            {company}
          </span>
        ))}
      </div>
    </Link>
  );
}

export default QuestionCard;