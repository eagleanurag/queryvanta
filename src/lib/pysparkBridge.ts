// QueryVanta PySpark browser PoC bridge (main thread).
//
// Runs on the React main thread. The Web Worker (Pyodide + PySpark)
// cannot block on async results, so it writes each grpc-web request
// into a SharedArrayBuffer, parks on Atomics.wait, and posts a
// {type:"pcw_rpc"} nudge. This bridge reads the request, performs the
// real async fetch against the Envoy grpc-web endpoint, writes the
// response back into the SAB, and wakes the worker via Atomics.notify.
//
// SAB layout + state machine ported from pyspark-connect-web's
// bridge.js / sab_channel.py (Apache-2.0). Keep values in sync.

const C_STATE = 0;
const C_LENGTH = 1;
const C_STATUS = 2;
// const C_SEQ = 3;
// const C_GEN = 4;
// const C_CAP = 5;

const S_IDLE = 0;
const S_REQ_READY = 1;
const S_RESP_CHUNK = 2;
const S_RESP_END = 3;
const S_RESP_ERROR = 4;
const S_CHUNK_ACK = 5;
// const S_REALLOC_REQ = 6;

const META_ZONE = 4096;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

type RpcHeader = {
  url: string;
  headers?: Record<string, string>;
  kind?: string;
  timeout?: number | null;
};

class Bridge {
  private ctrl: Int32Array | null = null;
  private data: Uint8Array | null = null;
  private busy = false;

  attach(controlSab: SharedArrayBuffer, dataSab: SharedArrayBuffer) {
    this.ctrl = new Int32Array(controlSab);
    this.data = new Uint8Array(dataSab);
  }

  private get ctrlView(): Int32Array {
    if (!this.ctrl) {
      throw new Error("Bridge not attached");
    }
    return this.ctrl;
  }

  private get dataView(): Uint8Array {
    if (!this.data) {
      throw new Error("Bridge not attached");
    }
    return this.data;
  }

  private payloadCapacity(): number {
    return this.dataView.length - META_ZONE - 4;
  }

  private getU32(off: number): number {
    const d = this.dataView;
    return (
      (d[off] |
        (d[off + 1] << 8) |
        (d[off + 2] << 16) |
        (d[off + 3] << 24)) >>>
      0
    );
  }

  private putU32(off: number, v: number): number {
    const d = this.dataView;
    d[off] = v & 0xff;
    d[off + 1] = (v >>> 8) & 0xff;
    d[off + 2] = (v >>> 16) & 0xff;
    d[off + 3] = (v >>> 24) & 0xff;
    return off + 4;
  }

  private readRequest(): {
    header: RpcHeader;
    body: Uint8Array;
  } {
    let off = 0;
    const headerLen = this.getU32(off);
    off += 4;
    const headerBytes = this.dataView.slice(off, off + headerLen);
    const header = JSON.parse(
      decoder.decode(headerBytes),
    ) as RpcHeader;
    off += headerLen;
    const bodyLen = this.getU32(off);
    off += 4;
    const body = this.dataView.slice(off, off + bodyLen);
    return { header, body };
  }

  private writeWindow(
    state: number,
    status: number,
    meta: Record<string, unknown>,
    payload: Uint8Array | null,
  ) {
    const metaBytes = encoder.encode(JSON.stringify(meta || {}));
    let off = 0;
    off = this.putU32(off, metaBytes.length);
    this.dataView.set(metaBytes, off);
    off += metaBytes.length;
    if (payload && payload.length) {
      this.dataView.set(payload, off);
      off += payload.length;
    }
    Atomics.store(this.ctrlView, C_STATUS, status | 0);
    Atomics.store(this.ctrlView, C_LENGTH, off);
    Atomics.store(this.ctrlView, C_STATE, state);
    Atomics.notify(this.ctrlView, C_STATE);
  }

  private async emitMessage(
    status: number,
    metaBase: Record<string, unknown> | undefined,
    bytes: Uint8Array | null,
  ): Promise<boolean> {
    const cap = this.payloadCapacity();
    const total = bytes ? bytes.length : 0;
    let sent = 0;
    let first = true;
    do {
      const end = Math.min(sent + cap, total);
      const window = bytes ? bytes.subarray(sent, end) : null;
      const more = end < total;
      const meta = Object.assign(
        {},
        first ? metaBase || {} : {},
        { more },
      );
      this.writeWindow(S_RESP_CHUNK, status, meta, window);
      sent = end;
      first = false;
      if (more) {
        const ack = await this.awaitWorker(S_CHUNK_ACK);
        if (ack === S_IDLE || ack === S_REQ_READY) {
          return false;
        }
      }
    } while (sent < total);
    return true;
  }

  private writeError(message: unknown, kind?: string) {
    this.writeWindow(
      S_RESP_ERROR,
      0,
      { message: String(message), kind: kind || "error" },
      null,
    );
  }

  private async awaitWorker(
    expect: number,
  ): Promise<number> {
    while (true) {
      const cur = Atomics.load(this.ctrlView, C_STATE);
      if (
        cur === expect ||
        cur === S_IDLE ||
        cur === S_REQ_READY
      ) {
        return cur;
      }
      const waiter = (
        Atomics as unknown as {
          waitAsync?: (
            view: Int32Array,
            index: number,
            value: number,
          ) => { async: boolean; value: Promise<void> };
        }
      ).waitAsync;
      if (typeof waiter === "function") {
        const r = waiter(this.ctrlView, C_STATE, cur);
        if (r.async) {
          await r.value;
        }
      } else {
        await new Promise((res) => setTimeout(res, 0));
      }
    }
  }

  async handleRpc(): Promise<void> {
    if (this._busyGuard()) {
      console.debug("[pcw bridge] nudge dropped (busy)");
      return;
    }
    if (!this.ctrl) {
      return;
    }
    if (Atomics.load(this.ctrl, C_STATE) !== S_REQ_READY) {
      return;
    }
    this.busy = true;
    let timer: ReturnType<typeof setTimeout> | null =
      null;
    try {
      const { header, body } = this.readRequest();
      console.debug(
        `[pcw bridge] fetch start kind=${header.kind ?? "?"} url=${header.url} body=${body.length}B`,
      );
      const init: RequestInit = {
        method: "POST",
        headers: { ...header.headers },
        body: body as BodyInit,
        mode: "cors",
        credentials: "omit",
      };
      const ctl = new AbortController();
      init.signal = ctl.signal;
      let timedOut = false;
      if (header.timeout != null) {
        timer = setTimeout(() => {
          timedOut = true;
          ctl.abort();
        }, header.timeout * 1000);
      }

      let resp: Response;
      try {
        resp = await fetch(header.url, init);
        console.debug(
          `[pcw bridge] fetch ok kind=${header.kind ?? "?"} status=${resp.status}`,
        );
      } catch (e) {
        const isAbort =
          e instanceof Error && e.name === "AbortError";
        const kind = timedOut
          ? "timeout"
          : isAbort
            ? "abort"
            : "error";
        const msg = timedOut
          ? `fetch timed out after ${header.timeout}s`
          : `fetch failed for ${header.url}: ${
              e instanceof Error ? e.message : String(e)
            }`;
        this.writeError(msg, kind);
        console.debug(`[pcw bridge] fetch failed: ${msg}`);
        return;
      } finally {
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
      }

      const headers: Record<string, string> = {};
      try {
        resp.headers.forEach((v, k) => {
          headers[k] = v;
        });
      } catch {
        /* leave empty */
      }

      if (header.kind === "unary") {
        const buf = new Uint8Array(
          await resp.arrayBuffer(),
        );
        await this.emitMessage(
          resp.status,
          { ok: resp.ok, headers },
          buf,
        );
        return;
      }

      if (!resp.body) {
        this.writeError("empty response body", "error");
        return;
      }
      const reader = resp.body.getReader();
      let first = true;
      while (true) {
        let value: Uint8Array | undefined;
        let done = false;
        try {
          const read = await reader.read();
          value = read.value;
          done = read.done;
        } catch (e) {
          const isAbort =
            e instanceof Error && e.name === "AbortError";
          this.writeError(
            `stream read failed: ${
              e instanceof Error ? e.message : String(e)
            }`,
            timedOut ? "timeout" : isAbort ? "abort" : "error",
          );
          return;
        }
        if (done) {
          break;
        }
        if (!value || value.length === 0) {
          continue;
        }
        const metaBase = first
          ? { ok: resp.ok, headers }
          : {};
        const cont = await this.emitMessage(
          resp.status,
          metaBase,
          value,
        );
        first = false;
        if (!cont) {
          return;
        }
        const ack = await this.awaitWorker(S_CHUNK_ACK);
        if (ack === S_IDLE || ack === S_REQ_READY) {
          return;
        }
      }
      Atomics.store(this.ctrlView, C_LENGTH, 0);
      Atomics.store(this.ctrlView, C_STATE, S_RESP_END);
      Atomics.notify(this.ctrlView, C_STATE);
    } catch (e) {
      try {
        this.writeError(
          e instanceof Error ? e.message : String(e),
          "error",
        );
      } catch {
        /* SAB unusable */
      }
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
      this.busy = false;
      if (
        this.ctrl &&
        Atomics.load(this.ctrl, C_STATE) === S_REQ_READY
      ) {
        void this.handleRpc();
      }
    }
  }

  private _busyGuard(): boolean {
    return this.busy;
  }
}

export function installBridge(worker: Worker): Bridge {
  const bridge = new Bridge();
  worker.addEventListener("message", (ev: MessageEvent) => {
    const msg = (ev.data || {}) as {
      type?: string;
      control?: SharedArrayBuffer;
      data?: SharedArrayBuffer;
    };
    if (
      msg.type === "pcw_sab" &&
      msg.control &&
      msg.data
    ) {
      bridge.attach(msg.control, msg.data);
    } else if (msg.type === "pcw_rpc") {
      void bridge.handleRpc();
    }
  });
  return bridge;
}
