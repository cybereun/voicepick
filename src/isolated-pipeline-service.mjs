import { existsSync } from "node:fs";
import { fork } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const CHILD_PATH = join(here, "transcription-child.mjs");
const PUSH_BATCH_SIZE = 4096;

function encodeAudio(audio) {
  const buffer = Buffer.alloc(audio.length * Float32Array.BYTES_PER_ELEMENT);
  for (let i = 0; i < audio.length; i += 1) {
    buffer.writeFloatLE(audio[i], i * Float32Array.BYTES_PER_ELEMENT);
  }
  return buffer.toString("base64");
}

export class IsolatedPipelineService {
  constructor(runtimePaths) {
    this.paths = runtimePaths;
    this.child = null;
    this.nextId = 1;
    this.pendingRequests = new Map();
    this.status = "idle";
    this.session = null;
    this.segments = [];
    this.pending = [];
    this.pendingSamples = 0;
    this.pushChain = Promise.resolve();
    this.finalizePromise = null;
    this.callbacks = {};
    this.sessionReady = Promise.resolve();
    this.lastError = null;
  }

  getCapabilities() {
    return {
      whisper: true,
      vad: Boolean(this.paths.vadModelPath),
      gpuDiscovery: true,
      pipeline: true,
      diarization: true,
      platform: "win32-x64",
      supportedBackendTypes: ["vulkan", "openvino-hybrid"],
      isolated: true,
    };
  }

  getGpuDevices() {
    return [];
  }

  checkModels({ diarization = true } = {}) {
    const models = this.paths.models;
    const required = [
      ["whisperModelPath", this.paths.whisperModelPath],
      ["segModelPath", models.segModelPath],
      ["vadModelPath", this.paths.vadModelPath],
    ];
    if (diarization) {
      required.push(["embModelPath", models.embModelPath], ["pldaPath", models.pldaPath]);
    }
    return Object.fromEntries(required.map(([key, value]) => [key, Boolean(value && existsSync(value))]));
  }

  async load(config = {}) {
    this.status = "loading";
    await this.request("load", { config }, { timeoutMs: 60000 });
    this.status = "ready";
  }

  createSession(callbacks = {}) {
    this.callbacks = callbacks;
    this.segments = [];
    this.pending = [];
    this.pendingSamples = 0;
    this.session = { isolated: true };
    this.sessionReady = this.request("createSession", {}, { timeoutMs: 30000 }).catch((error) => {
      this.handleChildError(error);
      throw error;
    });
  }

  push(audio) {
    if (!this.session) return;
    this.pending.push(new Float32Array(audio));
    this.pendingSamples += audio.length;
    if (this.pendingSamples < PUSH_BATCH_SIZE) return;
    const batch = this.takePending();
    this.pushChain = this.pushChain
      .then(() => this.sessionReady)
      .then(() => this.request("push", { audio: encodeAudio(batch) }, { timeoutMs: 30000 }))
      .catch((error) => {
        this.handleChildError(error);
        return null;
      });
  }

  async finalize() {
    if (this.finalizePromise) return this.finalizePromise;
    this.finalizePromise = this.finalizeActiveSession().finally(() => {
      this.finalizePromise = null;
    });
    return this.finalizePromise;
  }

  async finalizeActiveSession() {
    if (!this.session) return this.segments;
    this.status = "finalizing";
    if (this.pendingSamples > 0) {
      const tail = this.takePending();
      this.pushChain = this.pushChain
        .then(() => this.sessionReady)
        .then(() => this.request("push", { audio: encodeAudio(tail) }, { timeoutMs: 30000 }));
    }
    await this.sessionReady.catch((error) => this.handleChildError(error));
    await this.pushChain.catch((error) => this.handleChildError(error));
    const response = await this.request("finalize", {}, { timeoutMs: 120000 });
    this.segments = response.segments || [];
    this.session = null;
    this.status = "ready";
    return this.segments;
  }

  async transcribeOffline(audio, config = {}) {
    if (!(audio instanceof Float32Array) || audio.length === 0) return [];
    this.status = "finalizing";
    const response = await this.request("transcribeOffline", {
      audio: encodeAudio(audio),
      config,
    }, { timeoutMs: 180000 });
    this.status = "ready";
    return response.segments || [];
  }

  async close() {
    if (this.child?.connected) {
      await this.request("close", {}, { timeoutMs: 10000 }).catch(() => undefined);
    }
    this.child?.kill();
    this.child = null;
    this.session = null;
    this.sessionReady = Promise.resolve();
    this.status = "idle";
  }

  takePending() {
    const out = new Float32Array(this.pendingSamples);
    let offset = 0;
    for (const chunk of this.pending) {
      out.set(chunk, offset);
      offset += chunk.length;
    }
    this.pending = [];
    this.pendingSamples = 0;
    return out;
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
      env: { ...process.env, VOICEPICK_TRANSCRIPTION_CHILD: "1" },
    });
    this.child.on("message", (message) => this.handleMessage(message));
    this.child.on("exit", (code, signal) => this.handleExit(code, signal));
    this.child.stdout?.on("data", (data) => process.stdout.write(`[VoicePick engine] ${data}`));
    this.child.stderr?.on("data", (data) => process.stderr.write(`[VoicePick engine] ${data}`));
    return this.child;
  }

  handleMessage(message) {
    if (message.event === "segments") {
      const segments = message.segments || [];
      const allSegments = message.allSegments || segments;
      this.segments = allSegments;
      this.callbacks.onSegments?.(segments, allSegments);
      return;
    }
    if (message.event === "error") {
      this.handleChildError(new Error(message.message || "transcription child error"));
      return;
    }
    const pending = this.pendingRequests.get(message.id);
    if (!pending) return;
    clearTimeout(pending.timer);
    this.pendingRequests.delete(message.id);
    if (message.ok) pending.resolve(message.result);
    else pending.reject(new Error(message.error || "transcription child request failed"));
  }

  handleExit(code, signal) {
    const reason = signal || (code ?? "unknown");
    const error = new Error(`Transcription engine exited (${reason})`);
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pendingRequests.delete(id);
    }
    this.child = null;
    this.session = null;
    this.sessionReady = Promise.resolve();
    this.status = "ready";
    this.handleChildError(error);
  }

  handleChildError(error) {
    this.lastError = error;
    this.callbacks.onError?.(error);
  }
}
