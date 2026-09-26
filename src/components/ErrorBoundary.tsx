import { Component } from "react";

import type {
  ErrorInfo,
  ReactNode,
} from "react";

import { AlertTriangle, Home, RotateCcw } from "lucide-react";

type ErrorBoundaryProps = {
  children: ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
};

class ErrorBoundary extends Component<
  ErrorBoundaryProps,
  ErrorBoundaryState
> {
  state: ErrorBoundaryState = {
    hasError: false,
  };

  static getDerivedStateFromError(): ErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(
    error: Error,
    info: ErrorInfo,
  ): void {
    // Keep full diagnostics in the dev console;
    // the UI below stays concise and non-sensitive.
    console.error(
      "QueryVanta caught a rendering error:",
      error,
      info.componentStack,
    );
  }

  private handleRetry = () => {
    this.setState({ hasError: false });
  };

  private handleReload = () => {
    window.location.reload();
  };

  render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9] p-8 text-[#202124]">
        <div className="w-full max-w-xl rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-amber-50 text-amber-600">
            <AlertTriangle size={24} />
          </span>

          <h1 className="mt-4 text-xl font-semibold text-gray-900">
            Something went wrong
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            QueryVanta hit an unexpected error
            while rendering this page. Your
            saved questions, progress,
            bookmarks and history are stored
            locally and are unaffected. Try
            again, or go back to a safe page.
          </p>

          <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
            <button
              type="button"
              onClick={this.handleRetry}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 sm:w-auto"
            >
              <RotateCcw size={16} />
              Try again
            </button>

            <button
              type="button"
              onClick={this.handleReload}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto"
            >
              Reload page
            </button>

            <a
              href="/"
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto"
            >
              <Home size={16} />
              Back to Questions
            </a>
          </div>
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;
