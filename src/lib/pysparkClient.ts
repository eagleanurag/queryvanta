import { installBridge } from "./pysparkBridge";

export type PysparkBootStage =
  | "python"
  | "packages"
  | "wheels";

export type PysparkRunResult =
  | { ok: true; stdout: string }
  | { ok: false; error: string };

const WORKER_URL = "/worker/pyspark-test-worker.js";

const SPARK_REMOTE =
  "sc://localhost:8081/;transport=grpcweb";

// Runs before any user code, on every execution. Pyodide's
// runPythonAsync behaves like `python -c` (__main__ has no
// __spec__ and no __file__), which makes pyspark's
// check_dependencies() take its doctest-skip branch and abort,
// so we pretend to run from a file. install() is idempotent and
// getOrCreate() returns the cached session, making executions
// stateless from the caller's point of view.
const SETUP_LINES = [
  "import sys",
  "import importlib.machinery",
  "_main = sys.modules['__main__']",
  "if getattr(_main, '__spec__', None) is None and not hasattr(_main, '__file__'):",
  "    _main.__spec__ = importlib.machinery.ModuleSpec('__main__', loader=None)",
  "import pyspark_connect_web as pcw",
  "pcw.install()",
  // Backport of the upstream reattach-pool fix (present on upstream
  // main, missing from the pinned 0.2.0 wheel): Pyodide cannot start
  // OS threads, so ReleaseExecute cleanup must be a no-op future. In
  // pyspark-client 4.2.0 the pool lives behind the
  // _release_thread_pool property backed by the
  // _release_thread_pool_instance class slot, so pre-seeding that
  // slot avoids any thread creation. Without this, .collect() dies
  // with "can't start new thread" even when transport works.
  "from concurrent.futures import Future",
  "import pyspark.sql.connect.client.reattach as _reattach",
  "class _NoopPool:",
  "    def submit(self, fn, *a, **k):",
  "        _f = Future(); _f.set_result(None); return _f",
  "    def shutdown(self, *a, **k):",
  "        pass",
  "_reattach.ExecutePlanResponseReattachableIterator._release_thread_pool_instance = _NoopPool()",
  "from pyspark.sql import SparkSession",
  `spark = SparkSession.builder.remote("${SPARK_REMOTE}").getOrCreate()`,
];

export function buildPysparkSnippet(
  userCode: string,
): string {
  return [...SETUP_LINES, userCode].join("\n");
}

type WorkerMessage = {
  type?: string;
  id?: number;
  stage?: string;
  message?: string;
  result?: string;
  control?: SharedArrayBuffer;
  data?: SharedArrayBuffer;
};

type PendingEntry = {
  resolve: (value: string) => void;
  reject: (reason: Error) => void;
};

/**
 * Reusable real-PySpark execution client.
 *
 * Boots a Pyodide Web Worker once (vendored Pyodide +
 * pyspark-client 4.2.0 + pyspark-connect-web 0.2.0), services the
 * SharedArrayBuffer blocking transport on the main thread via the
 * Envoy grpc-web proxy, and executes arbitrary snippets against
 * real Spark 4.2.0, returning captured stdout.
 *
 * No mocks: every run executes on the Spark cluster.
 */
export class PysparkClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, PendingEntry>();
  private ready: Promise<void> | null = null;
  private disposed = false;
  private onStage:
    | ((
        stage: PysparkBootStage,
        message: string,
      ) => void)
    | undefined;

  constructor(
    onStage?: (
      stage: PysparkBootStage,
      message: string,
    ) => void,
  ) {
    this.onStage = onStage;
  }

  boot(): Promise<void> {
    if (this.ready) {
      return this.ready;
    }

    this.ready = new Promise<void>((resolve, reject) => {
      if (typeof SharedArrayBuffer === "undefined") {
        reject(
          new Error(
            "SharedArrayBuffer is unavailable in this browser.",
          ),
        );
        return;
      }

      if (window.crossOriginIsolated !== true) {
        reject(
          new Error(
            "Page is not cross-origin isolated (need COOP: same-origin and COEP: credentialless).",
          ),
        );
        return;
      }

      const worker = new Worker(WORKER_URL, {
        type: "module",
      });
      this.worker = worker;
      installBridge(worker);

      worker.addEventListener("error", (ev: ErrorEvent) => {
        if (!this.disposed) {
          reject(
            new Error(
              `Web Worker failed to start: ${ev.message || "unknown worker error"}`,
            ),
          );
        }
      });

      const onMessage = (ev: MessageEvent) => {
        const msg = (ev.data || {}) as WorkerMessage;

        if (msg.type === "pcw_ready") {
          worker.removeEventListener(
            "message",
            onMessage,
          );
          resolve();
        } else if (msg.type === "pcw_error") {
          worker.removeEventListener(
            "message",
            onMessage,
          );
          reject(
            new Error(
              msg.message ?? "Worker failed to boot",
            ),
          );
        } else if (msg.type === "pcw_status") {
          if (
            msg.stage === "python" ||
            msg.stage === "packages" ||
            msg.stage === "wheels"
          ) {
            this.onStage?.(
              msg.stage,
              msg.message ?? "",
            );
          }
        }
      };
      worker.addEventListener("message", onMessage);

      worker.addEventListener(
        "message",
        (ev: MessageEvent) => {
          const msg = (ev.data || {}) as WorkerMessage;

          if (
            msg.type === "pcw_result" &&
            msg.id !== undefined &&
            this.pending.has(msg.id)
          ) {
            this.pending
              .get(msg.id)
              ?.resolve(msg.result ?? "");
            this.pending.delete(msg.id);
          } else if (
            msg.type === "pcw_run_error" &&
            msg.id !== undefined &&
            this.pending.has(msg.id)
          ) {
            this.pending
              .get(msg.id)
              ?.reject(
                new Error(
                  msg.message ?? "Python run failed",
                ),
              );
            this.pending.delete(msg.id);
          }
        },
      );

      worker.postMessage({ type: "pcw_boot" });
    });

    return this.ready;
  }

  async run(code: string): Promise<string> {
    await this.boot();

    if (this.disposed || !this.worker) {
      throw new Error("PySpark client is disposed.");
    }

    const worker = this.worker;
    const id = ++this.seq;

    return new Promise<string>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      worker.postMessage({ type: "pcw_run", id, code });
    });
  }

  /**
   * Execute user code against real Spark and return a structured
   * result. The setup prelude (install + session) is prepended so
   * each call is self-contained.
   */
  async execute(
    userCode: string,
  ): Promise<PysparkRunResult> {
    try {
      const stdout = await this.run(
        buildPysparkSnippet(userCode),
      );
      return { ok: true, stdout };
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  dispose(): void {
    this.disposed = true;

    for (const [, entry] of this.pending) {
      entry.reject(
        new Error("PySpark client is disposed."),
      );
    }
    this.pending.clear();

    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
  }
}
