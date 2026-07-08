import { EventEmitter } from "node:events";

const SAMPLE_RATE = 16000;
const CHUNK_SIZE = 512;
const CHUNK_DURATION_MS = 32;
const DEFAULT_MIC_GAIN = Number(process.env.VOICEPICK_MIC_GAIN || 8);

class CircularAudioBuffer {
  constructor(size) {
    this.buffer = new Float32Array(size);
    this.writePos = 0;
    this.readPos = 0;
    this.available = 0;
  }

  write(samples) {
    for (let i = 0; i < samples.length; i += 1) {
      this.buffer[this.writePos] = samples[i];
      this.writePos = (this.writePos + 1) % this.buffer.length;
      if (this.available < this.buffer.length) this.available += 1;
      else this.readPos = (this.readPos + 1) % this.buffer.length;
    }
  }

  read(count) {
    if (this.available < count) return null;
    const result = new Float32Array(count);
    for (let i = 0; i < count; i += 1) {
      result[i] = this.buffer[this.readPos];
      this.readPos = (this.readPos + 1) % this.buffer.length;
      this.available -= 1;
    }
    return result;
  }

  getAvailable() {
    return this.available;
  }

  clear() {
    this.writePos = 0;
    this.readPos = 0;
    this.available = 0;
  }
}

export function applyGain(samples, gain = 1) {
  const multiplier = Number.isFinite(gain) && gain > 0 ? gain : 1;
  const output = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i += 1) {
    output[i] = Math.max(-1, Math.min(1, samples[i] * multiplier));
  }
  return output;
}

function readNativeFloat32Audio(buffer, metadata) {
  if (!metadata?.isFloat) {
    throw new Error(`Unsupported native audio format: ${metadata?.encoding || "unknown"}`);
  }
  if (metadata.sampleRate !== SAMPLE_RATE) {
    throw new Error(`Native recorder returned ${metadata.sampleRate}Hz, expected ${SAMPLE_RATE}Hz`);
  }
  const channels = metadata.channelsPerFrame || 1;
  const values = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / Float32Array.BYTES_PER_ELEMENT);
  if (channels === 1) return new Float32Array(values);
  const mono = new Float32Array(Math.floor(values.length / channels));
  for (let i = 0; i < mono.length; i += 1) {
    let sum = 0;
    for (let ch = 0; ch < channels; ch += 1) sum += values[i * channels + ch] || 0;
    mono[i] = sum / channels;
  }
  return mono;
}

export class NativeAudioMixer extends EventEmitter {
  constructor(nativeAudio) {
    super();
    this.nativeAudio = nativeAudio;
    this.micRecorder = null;
    this.systemRecorder = null;
    this.micMeta = null;
    this.systemMeta = null;
    this.micBuffer = new CircularAudioBuffer(SAMPLE_RATE);
    this.systemBuffer = new CircularAudioBuffer(SAMPLE_RATE);
    this.mixTimer = null;
    this.config = null;
    this.running = false;
  }

  static sampleRate = SAMPLE_RATE;

  listInputs() {
    return this.nativeAudio.listAudioDevices().filter((device) => device.isInput);
  }

  async start(config) {
    if (this.running) throw new Error("Recorder is already running");
    this.config = config;
    this.micBuffer.clear();
    this.systemBuffer.clear();
    const includeMic = config.source === "microphone" || config.source === "mixed";
    const includeSystem = config.source === "system" || config.source === "mixed";
    if (!includeMic && !includeSystem) throw new Error("No audio source selected");

    if (includeMic) await this.startMicrophone(config.deviceId);
    if (includeSystem) await this.startSystemAudio();
    this.mixTimer = setInterval(() => this.mix(), 10);
    this.running = true;
    this.emit("start");
  }

  async startMicrophone(deviceId) {
    await this.nativeAudio.ensureMicrophonePermission?.();
    this.micRecorder = new this.nativeAudio.MicrophoneRecorder({
      sampleRate: SAMPLE_RATE,
      chunkDurationMs: CHUNK_DURATION_MS,
      stereo: false,
      gain: 1,
      emitSilence: true,
      ...(deviceId && deviceId !== "default" ? { deviceId } : {}),
    });
    this.micRecorder.on("metadata", (meta) => {
      this.micMeta = meta;
      this.emit("metadata", { source: "microphone", meta });
    });
    this.micRecorder.on("data", (chunk) => {
      if (!this.micMeta) return;
      const samples = applyGain(readNativeFloat32Audio(chunk.data, this.micMeta), DEFAULT_MIC_GAIN);
      this.micBuffer.write(samples);
      this.emit("sourceLevel", {
        source: "microphone",
        level: this.peak(samples),
        available: this.micBuffer.getAvailable(),
      });
    });
    this.micRecorder.on("error", (error) => this.emit("error", error));
    await this.micRecorder.start();
  }

  async startSystemAudio() {
    await this.nativeAudio.ensureSystemAudioPermission?.();
    this.systemRecorder = new this.nativeAudio.SystemAudioRecorder({
      sampleRate: SAMPLE_RATE,
      chunkDurationMs: CHUNK_DURATION_MS,
      stereo: false,
      mute: false,
    });
    this.systemRecorder.on("metadata", (meta) => {
      this.systemMeta = meta;
      this.emit("metadata", { source: "system", meta });
    });
    this.systemRecorder.on("data", (chunk) => {
      if (!this.systemMeta) return;
      const samples = readNativeFloat32Audio(chunk.data, this.systemMeta);
      this.systemBuffer.write(samples);
      this.emit("sourceLevel", {
        source: "system",
        level: this.peak(samples),
        available: this.systemBuffer.getAvailable(),
      });
    });
    this.systemRecorder.on("error", (error) => this.emit("error", error));
    await this.systemRecorder.start();
  }

  mix() {
    const includeMic = this.config.source === "microphone" || this.config.source === "mixed";
    const includeSystem = this.config.source === "system" || this.config.source === "mixed";
    while (true) {
      let output = null;
      if (includeMic && includeSystem) {
        if (this.micBuffer.getAvailable() >= CHUNK_SIZE && this.systemBuffer.getAvailable() >= CHUNK_SIZE) {
          const mic = this.micBuffer.read(CHUNK_SIZE);
          const system = this.systemBuffer.read(CHUNK_SIZE);
          this.emit("sourceAudioChunk", { source: "microphone", chunk: mic });
          this.emit("sourceAudioChunk", { source: "system", chunk: system });
          output = this.mixChunks(mic, system);
        } else if (this.micBuffer.getAvailable() >= CHUNK_SIZE) {
          const mic = this.micBuffer.read(CHUNK_SIZE);
          this.emit("sourceAudioChunk", { source: "microphone", chunk: mic });
          output = mic;
        } else if (this.systemBuffer.getAvailable() >= CHUNK_SIZE) {
          const system = this.systemBuffer.read(CHUNK_SIZE);
          this.emit("sourceAudioChunk", { source: "system", chunk: system });
          output = system;
        } else {
          break;
        }
      } else if (includeMic) {
        output = this.micBuffer.read(CHUNK_SIZE);
        if (output) this.emit("sourceAudioChunk", { source: "microphone", chunk: output });
      } else if (includeSystem) {
        output = this.systemBuffer.read(CHUNK_SIZE);
        if (output) this.emit("sourceAudioChunk", { source: "system", chunk: output });
      }
      if (!output) break;
      this.emit("audioChunk", output);
    }
  }

  mixChunks(a, b) {
    const output = new Float32Array(CHUNK_SIZE);
    for (let i = 0; i < CHUNK_SIZE; i += 1) {
      output[i] = Math.max(-1, Math.min(1, (a?.[i] || 0) + (b?.[i] || 0)));
    }
    return output;
  }

  peak(samples) {
    let peak = 0;
    for (let i = 0; i < samples.length; i += 1) {
      peak = Math.max(peak, Math.abs(samples[i]));
    }
    return peak;
  }

  async stop() {
    if (this.mixTimer) clearInterval(this.mixTimer);
    this.mixTimer = null;
    await this.micRecorder?.stop().catch(() => undefined);
    await this.systemRecorder?.stop().catch(() => undefined);
    this.micRecorder?.removeAllListeners();
    this.systemRecorder?.removeAllListeners();
    this.micRecorder = null;
    this.systemRecorder = null;
    this.micMeta = null;
    this.systemMeta = null;
    this.running = false;
    this.emit("stop");
  }
}









