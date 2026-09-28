import { useEffect, useState } from "react";

import { AlertTriangle, LogIn, ShieldCheck } from "lucide-react";

import { Link, useSearchParams } from "react-router-dom";

import SEO from "../components/SEO";
import { fetchSession, loginUrl } from "../lib/adminApi";
import { ADMIN_SEO } from "../lib/seo";

const ERROR_MESSAGES: Record<string, string> = {
  "not-authorized":
    "That GitHub account is not registered as a QueryVanta administrator.",
  provider:
    "GitHub did not authorize the sign-in request.",
  authentication:
    "The sign-in could not be verified. Please try again.",
};

function AdminLoginPage() {
  const [searchParams] = useSearchParams();
  const [backendAvailable, setBackendAvailable] =
    useState<boolean | null>(null);

  const errorCode = searchParams.get("error");

  useEffect(() => {
    // If a valid session already exists, go straight through.
    let cancelled = false;

    void fetchSession().then((state) => {
      if (cancelled) {
        return;
      }

      if (state.status === "authenticated") {
        window.location.replace(
          "/admin/questions",
        );

        return;
      }

      if (
        state.status === "unauthenticated" &&
        state.reason === "unavailable"
      ) {
        setBackendAvailable(false);
      } else {
        setBackendAvailable(true);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <SEO meta={ADMIN_SEO} />

      <header className="border-b border-gray-200 bg-white">
        <div className="flex h-[72px] items-center px-8">
          <Link
            to="/"
            className="text-sm text-gray-500 hover:text-gray-900"
          >
            Back to Questions
          </Link>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-lg">
          <section className="rounded-xl border border-gray-200 bg-white p-8 shadow-sm">
            <span className="inline-flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-500">
              <ShieldCheck size={24} />
            </span>

            <h1 className="mt-4 text-xl font-semibold text-gray-900">
              Administrator sign-in
            </h1>

            <p className="mt-2 text-sm leading-6 text-gray-500">
              Question Management is restricted to
              registered administrators. Sign in with
              GitHub to continue. Access is granted by
              immutable GitHub account id, and every
              change is recorded in an audit log.
            </p>

            {errorCode !== null && (
              <div
                role="alert"
                className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
              >
                <AlertTriangle
                  size={16}
                  className="mt-0.5 shrink-0"
                />
                <span>
                  {ERROR_MESSAGES[errorCode] ??
                    "Sign-in failed. Please try again."}
                </span>
              </div>
            )}

            {backendAvailable === false && (
              <div
                role="status"
                className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
              >
                <AlertTriangle
                  size={16}
                  className="mt-0.5 shrink-0"
                />
                <span>
                  The QueryVanta API is not available on
                  this deployment. Server-enforced
                  administrator sign-in requires the
                  Cloudflare Worker deployment.
                </span>
              </div>
            )}

            <a
              href={loginUrl()}
              className="mt-6 flex w-full items-center justify-center gap-2 rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800"
            >
              <LogIn size={16} />
              Continue with GitHub
            </a>

            <p className="mt-4 text-xs leading-5 text-gray-400">
              QueryVanta requests only the minimum
              permission needed to read your GitHub
              account identity. It never reads your
              repositories, email address or
              organisations, and it never stores a
              GitHub password or access token in the
              browser.
            </p>
          </section>
        </div>
      </main>
    </div>
  );
}

export default AdminLoginPage;
