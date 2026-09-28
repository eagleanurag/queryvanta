import { useEffect, useState, type ReactNode } from "react";

import {
  AlertTriangle,
  Loader2,
  LogIn,
  LogOut,
} from "lucide-react";

import { Link } from "react-router-dom";

import {
  fetchSession,
  logout,
  type SessionState,
} from "../lib/adminApi";

/**
 * Gate for administrator-only UI.
 *
 * The gate is a UX convenience only. It hides the admin surface
 * when no server session exists, but authorization is ALWAYS
 * enforced by the API: every protected endpoint independently
 * verifies the HttpOnly session cookie. Removing this component
 * would not grant access to anything.
 */
function AdminGate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionState>({
    status: "unknown",
  });
  const [loggingOut, setLoggingOut] = useState(false);

  const handleLogout = async () => {
    setLoggingOut(true);
    await logout();
    setLoggingOut(false);
    setSession(await fetchSession());
  };

  // The session is fetched once on mount, and re-read after sign-out.
  // State is set inside the async callback, never synchronously in
  // the effect body.
  useEffect(() => {
    let cancelled = false;

    void fetchSession().then((state) => {
      if (!cancelled) {
        setSession(state);
      }
    });

    return () => {
      cancelled = true;
    };
  }, []);

  if (session.status === "unknown" || session.status === "loading") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9] text-[#202124]">
        <div
          role="status"
          className="flex items-center gap-2 text-sm text-gray-500"
        >
          <Loader2
            size={16}
            className="animate-spin"
          />
          Checking administrator session…
        </div>
      </div>
    );
  }

  if (session.status === "unauthenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-[#f6f7f9] p-8 text-[#202124]">
        <div className="w-full max-w-lg rounded-xl border border-gray-200 bg-white p-8 text-center shadow-sm">
          <h1 className="text-xl font-semibold text-gray-900">
            Administrator access required
          </h1>

          <p className="mt-2 text-sm leading-6 text-gray-500">
            {session.reason === "unavailable"
              ? "The QueryVanta API is not available on this deployment, so administrator features cannot be enabled here."
              : "Sign in with GitHub to manage the shared question catalog."}
          </p>

          {session.reason === "unavailable" ? (
            <p className="mt-4 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-left text-sm text-amber-800">
              <AlertTriangle
                size={16}
                className="mt-0.5 shrink-0"
              />
              <span>
                Server-enforced administrator access is
                only available on the Cloudflare Worker
                deployment. This GitHub Pages build has no
                backend, so it cannot safely offer
                question management.
              </span>
            </p>
          ) : (
            <Link
              to="/admin/login"
              className="mt-6 inline-flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-3 text-sm font-medium text-white hover:bg-gray-800"
            >
              <LogIn size={16} />
              Continue with GitHub
            </Link>
          )}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="flex items-center justify-end gap-3 border-b border-gray-200 bg-white px-4 py-2 text-xs">
        <span className="text-gray-500">
          Signed in as{" "}
          <strong className="font-medium text-gray-900">
            {session.admin.login ??
              `GitHub #${session.admin.githubId}`}
          </strong>
        </span>

        <span className="rounded-md bg-gray-900 px-2 py-1 font-medium text-white">
          Admin
        </span>

        <button
          type="button"
          onClick={() => void handleLogout()}
          disabled={loggingOut}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 font-medium text-gray-600 hover:bg-gray-50 disabled:opacity-50"
        >
          {loggingOut ? (
            <Loader2
              size={12}
              className="animate-spin"
            />
          ) : (
            <LogOut size={12} />
          )}
          Sign out
        </button>
      </div>

      {children}
    </>
  );
}

export default AdminGate;
