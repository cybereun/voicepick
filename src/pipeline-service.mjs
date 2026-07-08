import { existsSync } from "node:fs";

const PUSH_BATCH_SIZE = 4096;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isBusyError(error) {
  return /busy with another operation/i.test(error?.message || "");
}

function cleanText(text) {
  return String(text || "")
    .replace(/\s+([.,!?;:'")\]}])/g, "$1")
    .replace(/([[({])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function hasMeaningfulText(text) {
  return /[\p{L}\p{N}]/u.test(text || "");
}

function isHallucinatedText(text) {
  const cleaned = cleanText(text);
  if (!cleaned) return true;
  const lower = cleaned.toLowerCase().replace(/[.!?]+$/g, "").trim();
  const exact = new Set([
    "감사합니다",
    "시청해 주셔서 감사합니다",
    "시청해주셔서 감사합니다",
    "구독과 좋아요",
    "thank you",
    "thanks",
    "thank you for watching",
    "thanks for watching",
  ]);
  if (exact.has(cleaned) || exact.has(lower)) return true;
  return [
    /^\[[^\]]*(music|applause|silence)[^\]]*\]$/i,
    /^\([^)]*(music|sing|applause|silence)[^)]*\)$/i,
  ].some((pattern) => pattern.test(cleaned));
}

function isUsableText(text) {
  return hasMeaningfulText(text) && !isHallucinatedText(text);
}

function toSegment(segment) {
  const startMs = Math.round((segment.start || 0) * 1000);
  const endMs = Math.round(((segment.start || 0) + (segment.duration || 0)) * 1000);
  return {
    speaker: segment.speaker || "",
    startMs,
    endMs,
    text: cleanText(segment.text),
  };
}

export class PipelineService {
  constructor(pyannote, runtimePaths) {
    this.pyannote = pyannote;
    this.paths = runtimePaths;
    this.pipeline = null;
    this.loadingPromise = null;
    this.loadedKey = null;
    this.previewContext = null;
    this.previewLoadingPromise = null;
    this.previewBusy = false;
    this.session = null;
    this.status = "idle";
    this.pending = [];
    this.pendingSamples = 0;
    this.pushChain = Promise.resolve();
    this.finalizePromise = null;
    this.segments = [];
    this.transcriptionOnly = false;
    this.lastError = null;
  }

  getCapabilities() {
    try {
      return this.pyannote.getCapabilities();
    } catch {
      return null;
    }
  }

  getGpuDevices() {
    try {
      return this.pyannote.getGpuDevices();
    } catch {
      return [];
    }
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

  async loadPreview({ backend = "auto" } = {}) {
    if (this.previewContext) return;
    if (this.previewLoadingPromise) return this.previewLoadingPromise;
    this.previewLoadingPromise = (async () => {
      const model = this.paths.previewModelPath || this.paths.whisperModelPath;
      if (!model || !existsSync(model)) throw new Error("Preview Whisper model was not found");
      const devices = this.getGpuDevices();
      const discrete = devices.find((device) => device.type === "gpu" && !/intel/i.test(`${device.name} ${device.description}`));
      const contextOptions = {
        model,
        use_gpu: backend !== "cpu",
        gpu_device: discrete?.index ?? 0,
        no_prints: true,
      };
      this.previewContext = new this.pyannote.WhisperContext(contextOptions);
    })();
    try {
      return await this.previewLoadingPromise;
    } finally {
      this.previewLoadingPromise = null;
    }
  }

  async transcribePreview(audio, { language = "ko", backend = "auto", prompt = "" } = {}) {
    if (!(audio instanceof Float32Array) || audio.length < 8000) return "";
    if (this.previewBusy) return "";
    if (this.rms(audio) < 0.006) return "";
    this.previewBusy = true;
    try {
      await this.loadPreview({ backend });
      let latest = "";
      const result = await this.pyannote.transcribeAsync(this.previewContext, {
        pcmf32: audio,
        language,
        n_threads: Math.max(2, Math.min(6, Number(process.env.VOICEPICK_PREVIEW_THREADS || 4))),
        no_context: true,
        no_timestamps: true,
        temperature: 0,
        beam_size: 1,
        best_of: 1,
        no_fallback: true,
        suppress_blank: true,
        suppress_nst: false,
        no_speech_thold: 0.6,

        prompt,
        on_new_segment: (segment) => {
          latest = cleanText(segment?.text || latest);
        },
      });
      const text = cleanText(latest || result?.segments?.map((segment) => segment.text).join(" ") || "");
      return this.filterPreviewText(text);
    } catch (error) {
      this.lastError = error;
      console.error("[VoicePick] preview transcription failed:", error);
      return "";
    } finally {
      this.previewBusy = false;
    }
  }

  rms(audio) {
    let sum = 0;
    for (let i = 0; i < audio.length; i += 1) sum += audio[i] * audio[i];
    return Math.sqrt(sum / audio.length);
  }

  filterPreviewText(text) {
    const cleaned = cleanText(text);
    return isUsableText(cleaned) ? cleaned : "";
  }

  async load({ language = "ko", diarization = true, backend = "auto" } = {}) {
    const loadKey = JSON.stringify({ language, diarization, backend });
    if (this.pipeline && this.loadedKey === loadKey) return;
    if (this.loadingPromise) return this.loadingPromise;

    this.loadingPromise = (async () => {
      if (this.pipeline) await this.close();
      const modelStatus = this.checkModels({ diarization });
      const missing = Object.entries(modelStatus).filter(([, ok]) => !ok).map(([key]) => key);
      if (missing.length) throw new Error(`Missing pipeline models: ${missing.join(", ")}`);
      this.status = "loading";
      this.transcriptionOnly = !diarization;
      const config = {
        segModelPath: this.paths.models.segModelPath,
        whisperModelPath: this.paths.whisperModelPath,
        vadModelPath: this.paths.vadModelPath,
        transcriptionOnly: !diarization,
        agcEnabled: true,
        language,
        noPrints: true,
        backend: this.resolveBackend(backend),
      };
      if (diarization) {
        config.embModelPath = this.paths.models.embModelPath;
        config.pldaPath = this.paths.models.pldaPath;
      }
      this.pipeline = await this.pyannote.Pipeline.load(config);
      this.loadedKey = loadKey;
      this.status = "ready";
    })();

    try {
      return await this.loadingPromise;
    } finally {
      this.loadingPromise = null;
    }
  }

  resolveBackend(preference = "auto") {
    if (preference === "openvino" && this.paths.models.openvinoEncoderXml && this.paths.models.embOpenvinoPath) {
      return {
        type: "openvino-hybrid",
        whisperEncoderPath: this.paths.models.openvinoEncoderXml,
        embPath: this.paths.models.embOpenvinoPath,
      };
    }
    if (preference === "vulkan") return { type: "vulkan" };
    const devices = this.getGpuDevices();
    const discrete = devices.find((device) => device.type === "gpu" && !/intel/i.test(`${device.name} ${device.description}`));
    if (discrete) return { type: "vulkan", gpuDevice: discrete.index };
    const intel = devices.find((device) => device.type === "gpu" && /intel/i.test(`${device.name} ${device.description}`));
    if (preference === "auto" && intel && this.paths.models.openvinoEncoderXml && this.paths.models.embOpenvinoPath) {
      return {
        type: "openvino-hybrid",
        gpuDevice: intel.index,
        whisperEncoderPath: this.paths.models.openvinoEncoderXml,
        embPath: this.paths.models.embOpenvinoPath,
      };
    }
    return { type: "vulkan", ...(intel ? { gpuDevice: intel.index } : {}) };
  }

  createSession({ onSegments, onAudio, onError } = {}) {
    if (!this.pipeline) throw new Error("Pipeline is not loaded");
    this.session = this.pipeline.createSession();
    this.segments = [];
    this.pending = [];
    this.pendingSamples = 0;
    this.session.on("segments", (segments) => {
      const mapped = segments.map(toSegment).filter((segment) => segment.text && isUsableText(segment.text));
      if (this.transcriptionOnly) {
        this.segments.push(...mapped);
        onSegments?.(mapped, this.segments);
      } else {
        this.segments = mapped;
        onSegments?.(this.segments, this.segments);
      }
    });
    this.session.on("audio", (audio) => onAudio?.(audio));
    this.session.on("error", (error) => onError?.(error));
  }

  async transcribeOffline(audio, { language = "ko", diarization = true, backend = "auto", onSegment } = {}) {
    if (!(audio instanceof Float32Array) || audio.length === 0) return [];
    await this.load({ language, diarization, backend });
    this.status = "finalizing";
    const result = await this.pipeline.transcribeOffline(
      audio,
      undefined,
      onSegment
        ? (start, end, text) => onSegment({
            speaker: "",
            startMs: Math.round((start || 0) * 1000),
            endMs: Math.round((end || start || 0) * 1000),
            text: cleanText(text),
          })
        : undefined,
    );
    this.segments = result.segments.map(toSegment).filter((segment) => segment.text && isUsableText(segment.text));
    this.status = "ready";
    return this.segments;
  }

  push(audio) {
    if (!this.session) return;
    this.pending.push(audio);
    this.pendingSamples += audio.length;
    if (this.pendingSamples < PUSH_BATCH_SIZE) return;
    const batch = this.takePending();
    const session = this.session;
    this.pushChain = this.pushChain.then(() => this.runSessionOperation(() => session.push(batch), "push")).catch((error) => {
      this.status = "error";
      this.lastError = error;
      console.error("[VoicePick] streaming push failed:", error);
      return null;
    });
  }

  async runSessionOperation(operation, label, { attempts = 80, delayMs = 75 } = {}) {
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (!isBusyError(error)) throw error;
        await sleep(delayMs);
      }
    }
    throw new Error(`${label} timed out because the session stayed busy: ${lastError?.message || "unknown error"}`);
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

  async finalize() {
    if (this.finalizePromise) return this.finalizePromise;
    if (!this.session) return this.segments;

    this.finalizePromise = this.finalizeActiveSession().finally(() => {
      this.finalizePromise = null;
    });
    return this.finalizePromise;
  }

  async finalizeActiveSession() {
    const session = this.session;
    this.status = "finalizing";
    if (this.pendingSamples > 0) {
      const tail = this.takePending();
      this.pushChain = this.pushChain
        .then(() => this.runSessionOperation(() => session.push(tail), "push-tail"))
        .catch((error) => {
          this.lastError = error;
          console.error("[VoicePick] streaming tail push failed:", error);
          return null;
        });
    }
    await this.pushChain;
    const result = await this.runSessionOperation(() => session.finalize(), "finalize", { attempts: 160, delayMs: 100 });
    this.segments = result.segments.map(toSegment).filter((segment) => segment.text && isUsableText(segment.text));
    await session.close();
    if (this.session === session) this.session = null;
    this.status = "ready";
    return this.segments;
  }

  async close() {
    await this.session?.close().catch(() => undefined);
    this.session = null;
    this.finalizePromise = null;
    this.lastError = null;
    this.pipeline?.close();
    this.pipeline = null;
    this.previewContext?.free?.();
    this.previewContext = null;
    this.loadedKey = null;
    this.status = "idle";
  }
}





