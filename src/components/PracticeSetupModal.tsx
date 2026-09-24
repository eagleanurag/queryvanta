import { useEffect, useRef, useState } from "react";

import { Play, X } from "lucide-react";

export const PRACTICE_SIZE_OPTIONS = [
  5, 10, 20,
] as const;

type PracticeSetupModalProps = {
  availableCount: number;
  onStart: (size: number) => void;
  onClose: () => void;
};

function defaultSize(
  availableCount: number,
): number {
  if (availableCount >= 10) {
    return 10;
  }

  return availableCount;
}

function PracticeSetupModal({
  availableCount,
  onStart,
  onClose,
}: PracticeSetupModalProps) {
  const [selectedSize, setSelectedSize] =
    useState<number>(() =>
      defaultSize(availableCount),
    );

  const dialogRef =
    useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    dialogRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    window.addEventListener(
      "keydown",
      handleKeyDown,
    );

    return () => {
      window.removeEventListener(
        "keydown",
        handleKeyDown,
      );
    };
  }, [onClose]);

  const effectiveSize =
    selectedSize >= availableCount
      ? availableCount
      : selectedSize;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-gray-900/40 p-4"
      onClick={onClose}
      role="presentation"
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Practice session setup"
        tabIndex={-1}
        onClick={(event) =>
          event.stopPropagation()
        }
        className="w-full max-w-md rounded-xl border border-gray-200 bg-white p-6 shadow-lg outline-none"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              Practice Session
            </h2>

            <p className="mt-1 text-sm text-gray-500">
              {availableCount}{" "}
              {availableCount === 1
                ? "question"
                : "questions"}{" "}
              available in the current filtered
              set
            </p>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close practice setup"
            className="rounded-lg p-2 text-gray-400 transition hover:bg-gray-100 hover:text-gray-600"
          >
            <X size={18} />
          </button>
        </div>

        <div className="mt-5">
          <p
            id="practice-size-label"
            className="text-sm font-medium text-gray-700"
          >
            Session size
          </p>

          <div
            role="group"
            aria-labelledby="practice-size-label"
            className="mt-2 grid grid-cols-2 gap-2"
          >
            {PRACTICE_SIZE_OPTIONS.map(
              (option) => {
                const disabled =
                  option > availableCount;

                return (
                  <button
                    key={option}
                    type="button"
                    disabled={disabled}
                    onClick={() =>
                      setSelectedSize(option)
                    }
                    aria-pressed={
                      selectedSize === option
                    }
                    className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition ${
                      selectedSize === option
                        ? "border-gray-900 bg-gray-900 text-white"
                        : "border-gray-200 text-gray-600 hover:bg-gray-50 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-white"
                    }`}
                  >
                    {option} Questions
                  </button>
                );
              },
            )}

            <button
              type="button"
              onClick={() =>
                setSelectedSize(availableCount)
              }
              aria-pressed={
                selectedSize >= availableCount
              }
              className={`rounded-lg border px-4 py-2.5 text-sm font-medium transition ${
                selectedSize >= availableCount
                  ? "border-gray-900 bg-gray-900 text-white"
                  : "border-gray-200 text-gray-600 hover:bg-gray-50"
              }`}
            >
              All Available ({availableCount})
            </button>
          </div>
        </div>

        <div className="mt-6 flex items-center justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50"
          >
            Cancel
          </button>

          <button
            type="button"
            onClick={() =>
              onStart(effectiveSize)
            }
            className="flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800"
          >
            <Play size={16} />
            Start Practice ({effectiveSize})
          </button>
        </div>
      </div>
    </div>
  );
}

export default PracticeSetupModal;
