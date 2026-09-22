import { useCallback, useEffect, useRef, useState } from "react";

import {
  ArrowLeft,
  CheckCircle2,
  FlaskConical,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";

import { Link } from "react-router-dom";

import {
  buildPysparkSnippet,
  PysparkClient,
} from "../lib/pysparkClient";
import type { PysparkBootStage } from "../lib/pysparkClient";

type Stage =
  | "idle"
  | "starting"
  | "python"
  | "packages"
  | "connecting"
  | "executing"
  | "success"
  | "error";

const STAGE_LABEL: Record<Stage, string> = {
  idle: "Idle",
  starting: "Starting worker",
  python: "Initializing Python",
  packages: "Loading PySpark",
  connecting: "Connecting to Spark",
  executing: "Executing test",
  success: "Success",
  error: "Error",
};

const TEST_BODY = [
  "import json",
  "rows = spark.range(5).collect()",
  'print(json.dumps({"connected": True, "rows": [r[0] for r in rows]}))',
].join("\n");

const TEST_SNIPPET = buildPysparkSnippet(TEST_BODY);

function PySparkTestPage() {
  const [stage, setStage] = useState<Stage>("idle");
  const [detail, setDetail] = useState("");
  const [rows, setRows] = useState<number[] | null>(
    null,
  );
  const [error, setError] = useState("");

  const workerRef = useRef<PysparkClient | null>(
    null,
  );
  const runRef = useRef<
    ((code: string) => Promise<string>) | null
  >(null);

  const fail = useCallback((message: string) => {
    setStage("error");
    setError(message);
    setDetail("");
  }, []);

  const runTest = useCallback(async () => {
    const run = runRef.current;

    if (!run) {
      fail("Worker is not ready yet.");
      return;
    }

    setStage("connecting");
    setDetail(
      "Creating SparkSession against sc://localhost:8081/;transport=grpcweb ...",
    );
    setRows(null);
    setError("");

    try {
      const stdout = await run(TEST_SNIPPET);

      setStage("executing");
      setDetail("Parsing Spark result ...");

      const parsed = JSON.parse(stdout) as {
        connected?: boolean;
        rows?: number[];
      };

      if (
        parsed.connected !== true ||
        !Array.isArray(parsed.rows)
      ) {
        throw new Error(
          `Unexpected test output: ${stdout}`,
        );
      }

      setRows(parsed.rows);
      setStage("success");
      setDetail("");
    } catch (e) {
      fail(e instanceof Error ? e.message : String(e));
    }
  }, [fail]);

  useEffect(() => {
    let disposed = false;

    const stageDetail: Record<PysparkBootStage, string> =
      {
        python: "Loading Pyodide runtime ...",
        packages: "Loading pandas / pyarrow / numpy ...",
        wheels: "Installing PySpark Connect client ...",
      };

    const client = new PysparkClient(
      (bootStage, message) => {
        if (disposed) {
          return;
        }

        setStage("packages");

        if (bootStage === "python") {
          setStage("python");
        }

        setDetail(
          message || stageDetail[bootStage],
        );
      },
    );
    workerRef.current = client;

    runRef.current = (code: string) =>
      client.run(code);

    const boot = async () => {
      setStage("starting");
      setDetail("Starting Web Worker ...");
      setRows(null);
      setError("");

      await client.boot();

      if (!disposed) {
        await runTest();
      }
    };

    boot().catch((e: unknown) => {
      if (!disposed) {
        fail(e instanceof Error ? e.message : String(e));
      }
    });

    return () => {
      disposed = true;
      runRef.current = null;
      client.dispose();
      workerRef.current = null;
    };
  }, [fail, runTest]);

  return (
    <div className="min-h-screen bg-[#f6f7f9] text-[#202124]">
      <header className="border-b border-gray-200 bg-white">
        <div className="flex h-[72px] items-center px-8">
          <Link
            to="/"
            className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-900"
          >
            <ArrowLeft size={17} />
            Back to Questions
          </Link>

          <div className="mx-4 h-5 w-px bg-gray-200" />

          <span className="text-sm font-medium text-gray-900">
            PySpark Browser Test
          </span>
        </div>
      </header>

      <main className="p-8">
        <div className="mx-auto max-w-[800px]">
          <div className="flex items-center gap-3">
            <span className="flex h-9 w-9 items-center justify-center rounded-full bg-gray-900 text-white">
              <FlaskConical size={17} />
            </span>

            <div>
              <h1 className="text-2xl font-semibold text-gray-900">
                PySpark Browser Proof-of-Concept
              </h1>

              <p className="mt-1 text-sm text-gray-500">
                Browser → Pyodide → pyspark-connect-web
                → Envoy grpc-web → Spark Connect →
                real Spark execution.
              </p>
            </div>
          </div>

          <section className="mt-6 rounded-xl border border-gray-200 bg-white p-6 shadow-sm">
            <div className="flex flex-wrap items-center gap-3">
              <span
                id="pyspark-test-status"
                className={`inline-flex items-center gap-2 rounded-md px-2.5 py-1 text-xs font-medium ${
                  stage === "success"
                    ? "bg-emerald-50 text-emerald-600"
                    : stage === "error"
                      ? "bg-red-50 text-red-600"
                      : "bg-gray-100 text-gray-600"
                }`}
              >
                {(stage === "starting" ||
                  stage === "python" ||
                  stage === "packages" ||
                  stage === "connecting" ||
                  stage === "executing") && (
                  <Loader2
                    size={13}
                    className="animate-spin"
                  />
                )}
                {stage === "success" && (
                  <CheckCircle2 size={13} />
                )}
                {stage === "error" && (
                  <XCircle size={13} />
                )}
                {STAGE_LABEL[stage]}
              </span>

              {detail && (
                <span className="text-xs text-gray-500">
                  {detail}
                </span>
              )}

              <button
                type="button"
                onClick={() => void runTest()}
                disabled={
                  stage !== "success" &&
                  stage !== "error"
                }
                className="ml-auto flex items-center gap-2 rounded-lg bg-gray-900 px-4 py-2 text-xs font-medium text-white hover:bg-gray-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Play size={14} />
                Re-run test
              </button>
            </div>

            {stage === "success" && rows !== null && (
              <div
                id="pyspark-test-result"
                className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 p-4"
              >
                <p className="text-sm font-semibold text-emerald-700">
                  Spark Connect: Connected
                </p>

                <p className="mt-2 font-mono text-sm text-emerald-700">
                  Result: [{rows.join(", ")}]
                </p>
              </div>
            )}

            {stage === "error" && (
              <div
                id="pyspark-test-error"
                className="mt-4 rounded-lg border border-red-200 bg-red-50 p-4"
              >
                <p className="text-xs font-semibold text-red-700">
                  Test failed
                </p>

                <pre className="mt-2 whitespace-pre-wrap font-mono text-xs leading-5 text-red-600">
                  {error}
                </pre>
              </div>
            )}
          </section>

          <p className="mt-4 text-xs text-gray-400">
            Isolated proof-of-concept. Real rows come
            from Spark 4.2.0 via Envoy on :8081 — no
            mocks, no simulation.
          </p>
        </div>
      </main>
    </div>
  );
}

export default PySparkTestPage;
