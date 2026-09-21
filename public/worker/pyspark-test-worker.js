/* QueryVanta PySpark browser PoC worker.
 *
 * Runs inside a Web Worker (module). Boots same-origin Pyodide
 * (/pyodide/, required under COOP/COEP), micropip-installs the
 * vendored wheels (/wheels/), and executes Python snippets posted
 * by the main thread, returning captured stdout.
 *
 * The blocking Spark Connect transport (SharedArrayBuffer +
 * Atomics handshake) is serviced on the MAIN thread by the bridge
 * (src/lib/pysparkBridge.ts): the worker posts {type:"pcw_rpc"}
 * nudges; Python parks on Atomics.wait until the bridge writes the
 * Envoy grpc-web response back. Protocol adapted from
 * pyspark-connect-web's worker_bootstrap.js (Apache-2.0).
 */

"use strict";

const CONTROL_SLOTS = 8;
const DATA_BYTES = 16 * 1024 * 1024;

const PYODIDE_INDEX_URL =
  new URL("/pyodide/", self.location.origin).href;

const PYODIDE_PKGS = [
  "micropip",
  "pyarrow",
  "pandas",
  "numpy",
  "zstandard",
];

const origin = self.location.origin;
const WHEEL_URLS = [
  `${origin}/wheels/protobuf-7.36.2-py3-none-any.whl`,
  `${origin}/wheels/googleapis_common_protos-1.75.3-py3-none-any.whl`,
  `${origin}/wheels/pyspark_connect_web-0.2.0-py3-none-any.whl`,
];

// Slim Spark Connect client (pure Python, no JVM/py4j). Installed with
// deps:false because its grpcio base dependency has no Pyodide wheel;
// pyspark-connect-web stubs grpc at runtime instead.
const PYSPARK_CLIENT_WHEEL = `${origin}/wheels/pyspark_client-4.2.0-py2.py3-none-any.whl`;

function status(stage, message) {
  self.postMessage({ type: "pcw_status", stage, message });
}

function assertIsolated() {
  if (
    typeof SharedArrayBuffer === "undefined" ||
    self.crossOriginIsolated !== true
  ) {
    throw new Error(
      "Not cross-origin isolated: SharedArrayBuffer is unavailable. " +
        "Serve the page with COOP: same-origin and COEP: credentialless."
    );
  }
}

let pyodide = null;
let controlSab = null;
let dataSab = null;

async function boot() {
  assertIsolated();

  controlSab = new SharedArrayBuffer(CONTROL_SLOTS * 4);
  dataSab = new SharedArrayBuffer(DATA_BYTES);
  self.postMessage({ type: "pcw_sab", control: controlSab, data: dataSab });

  status("python", "Loading Pyodide runtime ...");
  const { loadPyodide } = await import(
    PYODIDE_INDEX_URL + "pyodide.mjs"
  );
  pyodide = await loadPyodide({ indexURL: PYODIDE_INDEX_URL });

  status("packages", "Loading pandas / pyarrow / numpy ...");
  await pyodide.loadPackage(PYODIDE_PKGS);

  status("wheels", "Installing PySpark Connect client ...");
  const micropip = pyodide.pyimport("micropip");
  for (const url of WHEEL_URLS) {
    await micropip.install(url);
  }
  await micropip.install.callKwargs(PYSPARK_CLIENT_WHEEL, {
    deps: false,
  });

  self.__pcw_control_sab = controlSab;
  self.__pcw_data_sab = dataSab;
  self.__pcw_register_sab = function (c, d) {
    self.__pcw_control_sab = c;
    self.__pcw_data_sab = d;
    self.postMessage({ type: "pcw_sab", control: c, data: d });
  };

  self.postMessage({ type: "pcw_ready" });
}

self.addEventListener("message", async (ev) => {
  const msg = ev.data || {};
  if (msg.type === "pcw_boot") {
    try {
      await boot();
    } catch (e) {
      self.postMessage({
        type: "pcw_error",
        message: String((e && e.message) || e),
      });
    }
  } else if (msg.type === "pcw_run") {
    let out = "";
    try {
      pyodide.setStdout({
        batched: (s) => {
          out += s;
        },
      });
      await pyodide.runPythonAsync(msg.code);
      self.postMessage({ type: "pcw_result", id: msg.id, result: out });
    } catch (e) {
      self.postMessage({
        type: "pcw_run_error",
        id: msg.id,
        message: String((e && e.message) || e),
      });
    } finally {
      try {
        pyodide.setStdout({});
      } catch (_) {
        /* ignore */
      }
    }
  }
});
