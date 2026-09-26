import { ArrowLeft, Compass } from "lucide-react";

import { Link } from "react-router-dom";

function NotFoundPage() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9] p-8 text-[#202124]">
      <div className="w-full max-w-xl rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
        <span className="mx-auto inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
          <Compass size={24} />
        </span>

        <h1 className="mt-4 text-xl font-semibold text-gray-900">
          Page not found
        </h1>

        <p className="mt-2 text-sm leading-6 text-gray-500">
          This address does not match any
          QueryVanta page. Check the URL, or
          head back to Questions — your
          filters, progress and history are
          kept.
        </p>

        <div className="mt-6 flex flex-col items-center justify-center gap-2 sm:flex-row">
          <Link
            to="/"
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-sm font-medium text-white hover:bg-gray-800 sm:w-auto"
          >
            <ArrowLeft size={16} />
            Back to Questions
          </Link>

          <Link
            to="/learn"
            className="flex w-full items-center justify-center gap-2 rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-600 hover:bg-gray-50 sm:w-auto"
          >
            Go to Learn
          </Link>
        </div>
      </div>
    </div>
  );
}

export default NotFoundPage;
