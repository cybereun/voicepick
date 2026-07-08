import { EventEmitter } from "node:events";
import { basename } from "node:path";
import { NativeAudioMixer } from "./audio-mixer.mjs";
import { WavWriter, ensureUniqueRecordingPath } from "./storage.mjs";
import { applySpeakerFallbacks } from "./speaker-fallback.mjs";
import { LocalAgreement, mergeFinalSegments } from "./transcript-agreement.mjs";

const PREVIEW_INTERVAL_MS = 1800;
const PREVIEW_WINDOW_MS = 4500;
const PREVIEW_MIN_AUDIO_MS = 1600;
const QUALITY_WINDOW_MS = 5000;
const QUALITY_EVENT_INTERVAL_MS = 1000;

function sourceSpeakerLabel(source) {
  return { microphone: "마이크", system: "컴퓨터 소리" }[source] || source;
}

function speakerLabel(speaker) {
  const match = /^SPEAKER_(\d+)$/.exec(speaker || "");
  if (!match) return speaker || "화자 1";
  return `화자 ${Number(match[1]) + 1}`;
}

function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

export function normalizeAudioForRecognition(audio, { targetPeak = 0.75, maxGain = 12 } = {}) {
  if (!(audio instanceof Float32Array) || audio.length === 0) return audio;
  let peak = 0;
  for (let i = 0; i < audio.length; i += 1) peak = Math.max(peak, Math.abs(audio[i]));
  if (peak <= 0 || peak >= targetPeak) return new Float32Array(audio);
  const gain = Math.min(maxGain, targetPeak / peak);
  const output = new Float32Array(audio.length);
  for (let i = 0; i < audio.length; i += 1) {
    output[i] = Math.max(-1, Math.min(1, audio[i] * gain));
  }
  return output;
}

export function analyzeAudioQuality(audio, { speechThreshold = 0.03 } = {}) {
  if (!(audio instanceof Float32Array) || audio.length === 0) {
    return { peak: 0, rms: 0, speechRatio: 0, samples: 0, status: "warming", message: "마이크 확인 중" };
  }
  let peak = 0;
  let sumSquares = 0;
  let speechSamples = 0;
  for (let i = 0; i < audio.length; i += 1) {
    const value = Math.abs(audio[i]);
    peak = Math.max(peak, value);
    sumSquares += value * value;
    if (value >= speechThreshold) speechSamples += 1;
  }
  const rms = Math.sqrt(sumSquares / audio.length);
  const speechRatio = speechSamples / audio.length;
  let status = "good";
  let message = "마이크 입력 정상";
  if (peak >= 0.98) {
    status = "clipping";
    message = "마이크 입력이 너무 큽니다";
  } else if (peak < 0.03 || rms < 0.004) {
    status = "too-quiet";
    message = "마이크 입력이 너무 작습니다";
  } else if (speechRatio < 0.02) {
    status = "no-speech";
    message = "말소리가 거의 감지되지 않습니다";
  } else if (peak < 0.12 || rms < 0.012 || speechRatio < 0.08) {
    status = "weak";
    message = "마이크에 더 가까이 말하세요";
  }
  return { peak, rms, speechRatio, samples: audio.length, status, message };
}

export class RecordingController extends EventEmitter {
  constructor({ storage, nativeAudio, pipelineService, previewService }) {
    super();
    this.storage = storage;
    this.nativeAudio = nativeAudio;
    this.pipelineService = pipelineService;
    this.previewService = previewService;
    this.mixer = null;
    this.writer = null;
    this.sourceWriters = new Map();
    this.sourceWriteChains = new Map();
    this.sourceAudioChunks = new Map();
    this.sourceAudioSamples = new Map();
    this.active = null;
    this.activeToken = null;
    this.startTask = null;
    this.stopTask = null;
    this.previewTimer = null;
    this.previewRunning = false;
    this.startedAt = 0;
    this.writeChain = Promise.resolve();
    this.confirmedSegments = [];
    this.latestPreviewText = "";
    this.committedText = "";
    this.localAgreement = new LocalAgreement({ minStableChars: 8 });
    this.audioChunks = [];
    this.audioSamples = 0;
    this.micQualityChunks = [];
    this.micQualitySamples = 0;
    this.lastMicQualityEventAt = 0;
  }

  status() {
    return {
      recording: Boolean(this.active),
      active: this.active,
      pipeline: this.pipelineService ? {
        status: this.pipelineService.status,
        capabilities: this.pipelineService.getCapabilities?.(),
        gpuDevices: this.pipelineService.getGpuDevices?.(),
        modelStatus: this.pipelineService.checkModels?.({ diarization: this.active?.diarization ?? true }),
      } : null,
    };
  }

  listDevices() {
    const defaultDeviceId = this.nativeAudio.getDefaultInputDevice?.() || null;
    const defaultOutputDeviceId = this.nativeAudio.getDefaultOutputDevice?.() || null;
    const allDevices = this.nativeAudio.listAudioDevices?.() || [];
    const devices = allDevices.filter((device) => device.isInput);
    const outputDevices = allDevices.filter((device) => device.isOutput);
    return {
      defaultDeviceId,
      defaultOutputDeviceId,
      devices,
      outputDevices,
      permissions: {
        microphone: this.nativeAudio.getMicrophonePermissionStatus?.() || "unknown",
        systemAudio: this.nativeAudio.getSystemAudioPermissionStatus?.() || "unknown",
      },
    };
  }

  async start(config) {
    if (this.active) throw new Error("Recording is already active");

    const recording = this.storage.createRecording({
      title: config.title,
      source: config.source || "microphone",
      language: config.language || "ko",
    });
    const audioPath = ensureUniqueRecordingPath(this.storage.recordingsDir, recording.id);
    this.storage.setRecordingAudioPath(recording.id, audioPath);

    this.writer = new WavWriter(audioPath, NativeAudioMixer.sampleRate);
    await this.writer.open();
    await this.openSourceWriters(recording.id, config.source || "microphone");

    this.active = {
      ...recording,
      status: "starting",
      audio_path: audioPath,
      source: config.source || "microphone",
      language: config.language || "ko",
      diarization: config.diarization !== false,
      backend: config.backend || "auto",
      startedAt: Date.now(),
      audioFile: basename(audioPath),
      sourceAudioFiles: this.storage.listRecordingAudioSources(recording.id).map((file) => ({
        ...file,
        audioFile: basename(file.audio_path),
      })),
    };
    this.activeToken = Symbol(recording.id);
    this.startedAt = Date.now();
    this.writeChain = Promise.resolve();
    this.confirmedSegments = [];
    this.latestPreviewText = "";
    this.committedText = "";
    this.localAgreement.reset();
    this.audioChunks = [];
    this.audioSamples = 0;
    this.resetMicQuality();
    this.storage.updateRecordingStatus(recording.id, "starting", 0);

    const token = this.activeToken;
    this.startTask = new Promise((resolve) => setImmediate(resolve))
      .then(() => this.finishStart(config, token))
      .catch((error) => this.failStart(recording.id, token, error));
    this.emit("event", { type: "recording-starting", recording: this.active });
    return this.active;
  }

  async finishStart(config, token) {
    this.mixer = new NativeAudioMixer(this.nativeAudio);
    this.mixer.on("audioChunk", (chunk) => this.handleAudioChunk(chunk));
    this.mixer.on("sourceAudioChunk", ({ source, chunk }) => this.handleSourceAudioEvent(source, chunk));
    this.mixer.on("metadata", (metadata) => this.emit("event", { type: "metadata", metadata }));
    this.mixer.on("sourceLevel", (level) => this.emit("event", { type: "source-level", ...level }));
    this.mixer.on("error", (error) => this.emit("error", error));
    await this.mixer.start({
      source: this.active.source,
      deviceId: config.deviceId || "default",
    });
    if (this.activeToken !== token || !this.active) {
      await this.mixer?.stop().catch(() => undefined);
      this.mixer = null;
      return;
    }

    this.active.status = "recording";
    this.storage.updateRecordingStatus(this.active.id, "recording", Date.now() - this.startedAt);
    this.emit("event", { type: "recording-started", recording: this.active });
    this.startRealtimePreview(token);

    await this.pipelineService.load({
      language: this.active.language,
      diarization: false,
      backend: config.backend || "auto",
    });
    if (this.activeToken !== token || !this.active) return;
    const backlog = this.audioChunks.slice();
    this.pipelineService.createSession({
      onSegments: (segments, allSegments) => this.handlePipelineSegments(segments, allSegments),
      onError: (error) => this.emit("error", error),
    });
    for (const chunk of backlog) this.pipelineService.push(chunk);
    this.emit("event", { type: "pipeline-ready", recordingId: this.active.id });
  }

  async failStart(recordingId, token, error) {
    if (this.activeToken !== token) return;
    this.emit("error", error);
    this.storage.updateRecordingStatus(recordingId, "error", Date.now() - this.startedAt);
    await this.mixer?.stop().catch(() => undefined);
    this.mixer = null;
    await this.writer?.close().catch(() => undefined);
    this.writer = null;
    await this.closeSourceWriters().catch(() => undefined);
    this.sourceWriters = new Map();
    this.sourceWriteChains = new Map();
    this.sourceAudioChunks = new Map();
    this.sourceAudioSamples = new Map();
    this.active = null;
    this.activeToken = null;
  }


  async openSourceWriters(recordingId, source) {
    this.sourceWriters = new Map();
    this.sourceWriteChains = new Map();
    this.sourceAudioChunks = new Map();
    this.sourceAudioSamples = new Map();
    if (source !== "mixed") return;

    for (const audioSource of ["microphone", "system"]) {
      const path = ensureUniqueRecordingPath(this.storage.recordingsDir, `${recordingId}-${audioSource}`);
      const writer = new WavWriter(path, NativeAudioMixer.sampleRate);
      await writer.open();
      this.storage.setRecordingSourceAudioPath(recordingId, audioSource, path);
      this.sourceWriters.set(audioSource, writer);
      this.sourceWriteChains.set(audioSource, Promise.resolve());
      this.sourceAudioChunks.set(audioSource, []);
      this.sourceAudioSamples.set(audioSource, 0);
    }
  }

  async closeSourceWriters() {
    for (const writer of this.sourceWriters.values()) {
      await writer.close().catch((error) => this.emit("error", error));
    }
    this.sourceWriters.clear();
    this.sourceWriteChains.clear();
  }

  async waitForSourceWrites() {
    await Promise.all([...this.sourceWriteChains.values()].map((chain) => chain.catch((error) => this.emit("error", error))));
  }

  resetMicQuality() {
    this.micQualityChunks = [];
    this.micQualitySamples = 0;
    this.lastMicQualityEventAt = 0;
  }
  startRealtimePreview(token) {
    this.stopRealtimePreview();
    this.previewTimer = setInterval(() => {
      this.runRealtimePreview(token).catch((error) => this.emit("error", error));
    }, PREVIEW_INTERVAL_MS);
    setTimeout(() => {
      this.runRealtimePreview(token).catch((error) => this.emit("error", error));
    }, 900);
  }

  stopRealtimePreview() {
    if (this.previewTimer) clearInterval(this.previewTimer);
    this.previewTimer = null;
    this.previewRunning = false;
  }

  async runRealtimePreview(token) {
    if (!this.previewService || this.previewRunning || this.activeToken !== token || !this.active) return;
    const elapsedMs = Date.now() - this.startedAt;
    if (elapsedMs < PREVIEW_MIN_AUDIO_MS || this.audioSamples < NativeAudioMixer.sampleRate * 1.5) return;

    const audio = this.tailAudio(PREVIEW_WINDOW_MS);
    this.previewRunning = true;
    try {
      const text = await this.previewService.transcribe(audio, {
        language: this.active.language,
        backend: "cpu",
        prompt: this.committedText.slice(-180),
      });
      if (this.activeToken !== token || !this.active || !text) return;
      this.applyPreviewText(text);
    } finally {
      this.previewRunning = false;
    }
  }

  applyPreviewText(text) {
    const previewText = normalizeText(text);
    if (!previewText) return;
    const agreement = this.localAgreement.update(previewText, this.committedText);
    const displayText = normalizeText([agreement.stableText, agreement.interimText].filter(Boolean).join(" "));
    if (!displayText || !agreement.changed) return;
    this.latestPreviewText = displayText;
    this.emit("event", {
      type: "segments",
      recordingId: this.active.id,
      finalSegments: this.withSpeakerLabels(this.confirmedSegments),
      previewAgreement: agreement,
      interimSegments: this.withSpeakerLabels([{
        speaker: "",
        startMs: Math.max(0, Date.now() - this.startedAt - PREVIEW_WINDOW_MS),
        endMs: Date.now() - this.startedAt,
        text: displayText,
        stableText: agreement.stableText,
        interimText: agreement.interimText,
      }]),
      segments: this.withSpeakerLabels(this.confirmedSegments),
    });
  }
  handlePipelineSegments(_newSegments, allSegments) {
    if (!this.active) return;
    const segments = Array.isArray(allSegments) ? allSegments : _newSegments;
    if (!segments || segments.length === 0) return;
    this.confirmedSegments = mergeFinalSegments(segments);
    this.committedText = segments.map((segment) => segment.text).join(" ").trim();
    this.latestPreviewText = "";
    this.storage.upsertSegments(this.active.id, this.confirmedSegments, { replace: true });
    this.emit("event", {
      type: "segments",
      recordingId: this.active.id,
      finalSegments: this.withSpeakerLabels(this.confirmedSegments),
      interimSegments: [],
      segments: this.withSpeakerLabels(this.confirmedSegments),
    });
  }

  handleAudioChunk(chunk) {
    if (!this.active || !this.writer) return;
    this.writeChain = this.writeChain.then(() => this.writer?.writeFloat32(chunk)).catch((error) => this.emit("error", error));
    this.audioChunks.push(new Float32Array(chunk));
    this.audioSamples += chunk.length;
    this.pipelineService.push(chunk);
    this.emit("event", {
      type: "level",
      level: this.level(chunk),
      elapsedMs: Date.now() - this.startedAt,
    });
  }

  handleSourceAudioEvent(source, chunk) {
    if (source === "microphone") this.handleMicrophoneQualityChunk(chunk);
    this.handleSourceAudioChunk(source, chunk);
  }

  handleMicrophoneQualityChunk(chunk) {
    if (!this.active) return;
    if (!Array.isArray(this.micQualityChunks)) this.resetMicQuality();
    const copy = new Float32Array(chunk);
    this.micQualityChunks.push(copy);
    this.micQualitySamples += copy.length;
    const maxSamples = Math.round((QUALITY_WINDOW_MS / 1000) * NativeAudioMixer.sampleRate);
    while (this.micQualitySamples > maxSamples && this.micQualityChunks.length > 1) {
      const removed = this.micQualityChunks.shift();
      this.micQualitySamples -= removed.length;
    }
    const now = Date.now();
    if (now - this.lastMicQualityEventAt < QUALITY_EVENT_INTERVAL_MS) return;
    this.lastMicQualityEventAt = now;
    const audio = new Float32Array(this.micQualitySamples);
    let offset = 0;
    for (const part of this.micQualityChunks) {
      audio.set(part, offset);
      offset += part.length;
    }
    const quality = analyzeAudioQuality(audio);
    this.emit("event", {
      type: "microphone-quality",
      recordingId: this.active.id,
      elapsedMs: now - this.startedAt,
      ...quality,
    });
  }
  handleSourceAudioChunk(source, chunk) {
    if (!this.active || !this.sourceWriters.has(source)) return;
    const copy = new Float32Array(chunk);
    const writer = this.sourceWriters.get(source);
    const chain = (this.sourceWriteChains.get(source) || Promise.resolve())
      .then(() => writer.writeFloat32(copy))
      .catch((error) => this.emit("error", error));
    this.sourceWriteChains.set(source, chain);
    this.sourceAudioChunks.get(source)?.push(copy);
    this.sourceAudioSamples.set(source, (this.sourceAudioSamples.get(source) || 0) + copy.length);
  }
  level(chunk) {
    let peak = 0;
    for (let i = 0; i < chunk.length; i += 1) peak = Math.max(peak, Math.abs(chunk[i]));
    return peak;
  }

  withSpeakerLabels(segments) {
    return segments.map((segment) => ({ ...segment, speakerLabel: speakerLabel(segment.speaker) }));
  }


  tailAudio(windowMs) {
    const wanted = Math.max(1, Math.round((windowMs / 1000) * NativeAudioMixer.sampleRate));
    const available = Math.min(wanted, this.audioSamples);
    const audio = new Float32Array(available);
    let writeOffset = available;
    let remaining = available;
    for (let i = this.audioChunks.length - 1; i >= 0 && remaining > 0; i -= 1) {
      const chunk = this.audioChunks[i];
      const take = Math.min(chunk.length, remaining);
      writeOffset -= take;
      audio.set(chunk.subarray(chunk.length - take), writeOffset);
      remaining -= take;
    }
    return audio;
  }
  concatAudio() {
    const audio = new Float32Array(this.audioSamples);
    let offset = 0;
    for (const chunk of this.audioChunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    return audio;
  }

  concatSourceAudio(source) {
    const chunks = this.sourceAudioChunks.get(source) || [];
    const total = this.sourceAudioSamples.get(source) || 0;
    const audio = new Float32Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      audio.set(chunk, offset);
      offset += chunk.length;
    }
    return audio;
  }

  async transcribeSeparatedSources(recording) {
    if (recording.source !== "mixed") return [];
    const segments = [];
    const speakerMap = new Map();
    let nextSpeakerIndex = 0;
    const mapSpeaker = (source, speaker) => {
      if (!recording.diarization || !speaker || speaker === "UNKNOWN") return sourceSpeakerLabel(source);
      const key = `${source}:${speaker}`;
      if (!speakerMap.has(key)) {
        speakerMap.set(key, `SPEAKER_${String(nextSpeakerIndex).padStart(2, "0")}`);
        nextSpeakerIndex += 1;
      }
      return speakerMap.get(key);
    };
    for (const source of ["microphone", "system"]) {
      const samples = this.sourceAudioSamples.get(source) || 0;
      if (samples < NativeAudioMixer.sampleRate * 2) continue;
      try {
        this.emit("event", {
          type: "finalizing",
          recordingId: recording.id,
          message: `${sourceSpeakerLabel(source)} 화자 분석 중`,
        });
        const sourceSegments = await this.pipelineService.transcribeOffline(normalizeAudioForRecognition(this.concatSourceAudio(source)), {
          language: recording.language,
          diarization: recording.diarization,
          backend: recording.backend || "auto",
        });
        for (const segment of sourceSegments) {
          segments.push({
            ...segment,
            source,
            sourceSpeaker: segment.speaker || "",
            speaker: mapSpeaker(source, segment.speaker),
          });
        }
      } catch (error) {
        this.emit("error", error);
      }
    }
    return segments.sort((a, b) => (a.startMs ?? a.start_ms ?? 0) - (b.startMs ?? b.start_ms ?? 0));
  }
  async stop() {
    if (this.stopTask) return this.stopTask;
    if (!this.active) return null;
    this.stopTask = this.stopActive().finally(() => {
      this.stopTask = null;
    this.previewTimer = null;
    this.previewRunning = false;
    });
    return this.stopTask;
  }

  async stopActive() {
    const recording = this.active;
    this.activeToken = null;
    this.active.status = "stopping";
    this.storage.updateRecordingStatus(recording.id, "stopping", Date.now() - this.startedAt);

    await this.mixer?.stop();
    this.mixer = null;
    await this.writeChain;
    await this.waitForSourceWrites();
    await this.closeSourceWriters();

    let finalSegments = this.confirmedSegments;
    try {
      if (this.pipelineService.session) {
        const finalized = await this.pipelineService.finalize();
        if (finalized.length > 0) finalSegments = finalized;
      }
    } catch (error) {
      this.emit("error", error);
      await this.pipelineService.session?.close().catch(() => undefined);
      this.pipelineService.session = null;
      this.pipelineService.status = "ready";
    }
    const separatedSegments = await this.transcribeSeparatedSources(recording);
    if (separatedSegments.length > 0) {
      finalSegments = separatedSegments;
    } else if (recording.diarization && this.audioSamples >= NativeAudioMixer.sampleRate * 4) {
      try {
        this.emit("event", {
          type: "finalizing",
          recordingId: recording.id,
          message: "화자 분리 정리 중",
        });
        const diarized = await this.pipelineService.transcribeOffline(normalizeAudioForRecognition(this.concatAudio()), {
          language: recording.language,
          diarization: true,
          backend: recording.backend || "auto",
        });
        if (diarized.length > 0) {
          finalSegments = applySpeakerFallbacks(diarized);
        }
      } catch (error) {
        this.emit("error", error);
      }
    }

    const fallbackText = normalizeText(this.committedText || this.latestPreviewText);
    if (finalSegments.length === 0 && fallbackText) {
      finalSegments = [{ speaker: "", startMs: 0, endMs: Date.now() - this.startedAt, text: fallbackText }];
    }
    if (finalSegments.length === 0 && this.audioSamples >= NativeAudioMixer.sampleRate * 2) {
      try {
        this.emit("event", {
          type: "finalizing",
          recordingId: recording.id,
          message: "최종 전사 정리 중",
        });
        finalSegments = await this.pipelineService.transcribeOffline(normalizeAudioForRecognition(this.concatAudio()), {
          language: recording.language,
          diarization: false,
          backend: recording.backend || "auto",
        });
      } catch (error) {
        this.emit("error", error);
      }
    }
    finalSegments = mergeFinalSegments(finalSegments);
    this.storage.upsertSegments(recording.id, finalSegments, { replace: true });
    await this.writer?.close();
    const durationMs = Math.max(this.writer?.durationMs || 0, Date.now() - this.startedAt);
    this.writer = null;
    this.storage.updateRecordingStatus(recording.id, "completed", durationMs);
    this.active = null;
    this.emit("event", {
      type: "recording-stopped",
      recordingId: recording.id,
      durationMs,
      segments: this.withSpeakerLabels(finalSegments),
    });
    return { recordingId: recording.id, durationMs, segments: finalSegments };
  }
}



































