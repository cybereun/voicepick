import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CHILD_PATH = join(here, "preview-child.mjs");

function encodeAudio(audio) {
  const buffer = Buffer.alloc(audio.length * Float32Array.BYTES_PER_ELEMENT);
  for (let i = 0; i < audio.length; i += 1) {
    buffer.writeFloatLE(audio[i], i * Float32Array.BYTES_PER_ELEMENT);
  }
  return buffer.toString("base64");
}

export class IsolatedPreviewService {
  constructor(runtimePaths) {
    this.paths = runtimePaths;
    this.child = null;
    this.nextId = 1;
    this.pendingRequests = new Map();
    this.busy = false;
    this.status = "idle";
    this.closing = false;
    this.lastError = null;
    this.expectedExit = false;
  }

  async transcribe(audio, config = {}) {
    if (!(audio instanceof Float32Array) || audio.length < 16000) return "";
    if (this.warmupPromise) await this.warmupPromise.catch(() => undefined);
    if (this.busy) return "";
    this.busy = true;
    this.status = "working";
    try {
      const result = await this.request("preview", {
        audio: encodeAudio(audio),
        config,
      }, { timeoutMs: 45000 });
      this.status = "ready";
      return result.text || "";
    } catch (error) {
      if (!this.closing) this.handleError(error);
      return "";
    } finally {
      this.busy = false;
      if (this.status === "working") this.status = "ready";
    }
  }

  warmup(config = {}) {
    this.ensureChild();
    if (this.warmupPromise) return this.warmupPromise;
    this.status = "loading";
    this.warmupPromise = this.request("warmup", { config }, { timeoutMs: 60000 })
      .then(() => {
        this.status = "ready";
      })
      .catch((error) => {
        this.handleError(error);
      })
      .finally(() => {
        this.warmupPromise = null;
      });
    return this.warmupPromise;
  }

  async close() {
    this.closing = true;
    this.expectedExit = true;
    const child = this.child;
    if (child?.connected) {
      await this.request("close", {}, { timeoutMs: 5000 }).catch(() => undefined);
    }
    if (this.child === child && child && child.exitCode === null && !child.killed) child.kill();
    this.child = null;
    this.status = "idle";
    setTimeout(() => {
      if (!this.child) {
        this.closing = false;
        this.expectedExit = false;
      }
    }, 1000);
  }
  async request(type, payload = {}, { timeoutMs = 30000 } = {}) {
    const child = this.ensureChild();
    const id = this.nextId;
    this.nextId += 1;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`${type} timed out`));
      }, timeoutMs);
      this.pendingRequests.set(id, { resolve, reject, timer });
      child.send({ id, type, ...payload }, (error) => {
        if (!error) return;
        clearTimeout(timer);
        this.pendingRequests.delete(id);
        reject(error);
      });
    });
  }

  ensureChild() {
    if (this.child?.connected) return this.child;
    this.child = fork(CHILD_PATH, [], {
      cwd: this.paths.appRoot,
      stdio: ["pipe", "pipe", "pipe", "ipc"],
      env: { ...process.env, VOICEPICK_PREVIEW_CHILD: "1" },
    });
    this.child.on("message", (message) => this.handleMessage(message));
    this.child.on("exit", (code, signal) => this.handleExit(code, signal));
    this.child.stdout?.on("data", (data) => process.stdout.write(`[VoicePick preview] ${data}`));
    this.child.stderr?.on("data", (data) => process.stderr.write(`[VoicePick preview] ${data}`));
    this.status = "ready";
    return this.child;
  }

  handleMessage(message) {
    const pending = this.pendingRequests.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || "preview child request failed"));
  }

  handleExit(code, signal) {
    const reason = signal || (code ?? "unknown");
    const error = new Error(`Preview engine exited (${reason})`);
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
    this.child = null;
    this.busy = false;
    this.status = "ready";
    const expected = this.closing || this.expectedExit || code === 0;
    if (!expected) this.handleError(error);
  }

  handleError(error) {
    this.lastError = error;
    console.error("[VoicePick] preview error:", error.message || error);
  }
}






