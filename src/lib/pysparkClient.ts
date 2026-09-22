import { installBridge } from "./pysparkBridge";

export type PysparkBootStage =
  | "python"
  | "packages"
  | "wheels";

export type PysparkRunResult =
  | { ok: true; stdout: string }
  | { ok: false; error: string };

// A single PySpark run must always settle: the worker answers every
// request in the healthy case, but a wedged transport, a silently
// crashed worker, or a Spark-side stall would otherwise leave the
// promise (and the UI) hanging forever with no diagnostics.
export const PYSPARK_RUN_TIMEOUT_MS = 120_000;

export type PysparkClientOptions = {
  timeoutMs?: number;
};

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

export const PYSPARK_RESULT_MARKER = "__QV_RESULT__";

// Appended after the learner's code by runValidation(). Reads the
// well-defined `result` variable: when it is a Spark DataFrame it is
// collected and converted to JSON-safe records; otherwise the payload
// reports has_result: false. Exactly one marker line is printed, so
// the marker can be separated from user stdout afterwards. The
// marker itself is an internal transport detail, never the primary
// result shown to the learner.
const RESULT_COLLECTOR_LINES = [
  "import json as _qv_json",
  "import datetime as _qv_dt",
  "import decimal as _qv_dec",
  "def _qv_norm(_qv_v):",
  "    if _qv_v is None or isinstance(_qv_v, (bool, int, float, str)):",
  "        return _qv_v",
  "    if isinstance(_qv_v, _qv_dec.Decimal):",
  "        return float(_qv_v)",
  "    if isinstance(_qv_v, (_qv_dt.date, _qv_dt.datetime)):",
  "        return _qv_v.isoformat()",
  "    return str(_qv_v)",
  "try:",
  "    _qv_candidate = result",
  "except NameError:",
  "    _qv_candidate = None",
  'if _qv_candidate is not None and hasattr(_qv_candidate, "collect"):',
  "    _qv_collected = _qv_candidate.collect()",
  '    _qv_payload = {"has_result": True, "records": [{_qv_k: _qv_norm(_qv_v) for _qv_k, _qv_v in _qv_r.asDict().items()} for _qv_r in _qv_collected]}',
  "else:",
  '    _qv_payload = {"has_result": False, "records": []}',
  'print("__QV_RESULT__" + _qv_json.dumps(_qv_payload, default=str))',
];

export type PysparkValidationOutcome =
  | {
      ok: true;
      userStdout: string;
      hasResult: boolean;
      records: Record<string, unknown>[];
    }
  | { ok: false; error: string };

function isRecord(
  value: unknown,
): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function parsePysparkResult(stdout: string): {
  userStdout: string;
  hasResult: boolean;
  records: Record<string, unknown>[];
} {
  // NOTE: Pyodide's batched stdout does not guarantee a newline
  // between consecutive prints, so the marker may be glued to user
  // output (e.g. `2__QV_RESULT__{...}`). Search for the marker
  // anywhere and treat everything after it as the payload: the
  // collector print is always the final statement we append.
  const markerIndex = stdout.lastIndexOf(
    PYSPARK_RESULT_MARKER,
  );

  if (markerIndex === -1) {
    throw new Error(
      "Could not parse the collected Spark result.",
    );
  }

  let payload: {
    has_result?: unknown;
    records?: unknown;
  };

  try {
    payload = JSON.parse(
      stdout.slice(
        markerIndex + PYSPARK_RESULT_MARKER.length,
      ),
    ) as { has_result?: unknown; records?: unknown };
  } catch {
    throw new Error(
      "Could not parse the collected Spark result.",
    );
  }

  if (
    !payload ||
    typeof payload.has_result !== "boolean" ||
    !Array.isArray(payload.records) ||
    !payload.records.every(isRecord)
  ) {
    throw new Error(
      "Could not parse the collected Spark result.",
    );
  }

  return {
    userStdout: stdout.slice(0, markerIndex).trim(),
    hasResult: payload.has_result,
    records: payload.records,
  };
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
  private generation = 0;
  private onStage:
    | ((
        stage: PysparkBootStage,
        message: string,
      ) => void)
    | undefined;
  private readonly timeoutMs: number;

  constructor(
    onStage?: (
      stage: PysparkBootStage,
      message: string,
    ) => void,
    options?: PysparkClientOptions,
  ) {
    this.onStage = onStage;
    this.timeoutMs =
      options?.timeoutMs ?? PYSPARK_RUN_TIMEOUT_MS;
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

  private failPendingAndTeardown(error: Error): void {
    for (const [, entry] of this.pending) {
      entry.reject(error);
    }
    this.pending.clear();

    this.worker?.terminate();
    this.worker = null;
    this.ready = null;
    this.generation += 1;
  }

  async run(code: string): Promise<string> {
    // The timeout covers the whole run, including worker boot:
    // a boot that never resolves (silent worker death mid-boot)
    // must reject exactly like a stalled execution, and the
    // teardown below leaves boot() safe to retry (ready is reset,
    // so the next run boots a fresh worker).
    let timer: ReturnType<typeof setTimeout> | undefined;

    const timeoutPromise = new Promise<never>(
      (_resolve, reject) => {
        timer = setTimeout(() => {
          this.failPendingAndTeardown(
            new Error(
              `PySpark execution timed out after ${this.timeoutMs / 1000} seconds.`,
            ),
          );
          reject(
            new Error(
              `PySpark execution timed out after ${this.timeoutMs / 1000} seconds.`,
            ),
          );
        }, this.timeoutMs);
      },
    );

    try {
      return await Promise.race([
        this.runInner(code),
        timeoutPromise,
      ]);
    } finally {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    }
  }

  private async runInner(code: string): Promise<string> {
    const generation = this.generation;

    await this.boot();

    if (
      generation !== this.generation ||
      this.disposed ||
      !this.worker
    ) {
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

  /**
   * Execute user code, collect the well-defined `result`
   * DataFrame, and return both the user stdout and the
   * normalized records. Execution failures surface as
   * `{ ok: false }`; a missing/non-DataFrame `result` is a
   * successful run with `hasResult: false` (for the caller to
   * grade as incorrect, never as an execution error).
   */
  async runValidation(
    userCode: string,
  ): Promise<PysparkValidationOutcome> {
    let stdout: string;

    try {
      stdout = await this.run(
        buildPysparkSnippet(
          `${userCode}\n${RESULT_COLLECTOR_LINES.join("\n")}`,
        ),
      );
    } catch (e) {
      return {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }

    try {
      const parsed = parsePysparkResult(stdout);
      return { ok: true, ...parsed };
    } catch (e) {
      const reason =
        e instanceof Error ? e.message : String(e);
      const preview =
        stdout.trim() === ""
          ? "(empty)"
          : stdout.slice(0, 500);
      return {
        ok: false,
        error: `${reason} Raw output: ${preview}`,
      };
    }
  }

  dispose(): void {
    this.disposed = true;
    this.failPendingAndTeardown(
      new Error("PySpark client is disposed."),
    );
  }
}
