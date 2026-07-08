import { resolveRuntimePaths, loadPyannote } from "./native-loader.mjs";
import { PipelineService } from "./pipeline-service.mjs";

let service = null;

function decodeAudio(base64) {
  const buffer = Buffer.from(base64, "base64");
  const audio = new Float32Array(buffer.length / Float32Array.BYTES_PER_ELEMENT);
  for (let i = 0; i < audio.length; i += 1) {
    audio[i] = buffer.readFloatLE(i * Float32Array.BYTES_PER_ELEMENT);
  }
  return audio;
}

function send(message) {
  if (process.connected) process.send(message);
}

async function getService() {
  if (service) return service;
  const paths = await resolveRuntimePaths();
  const pyannote = loadPyannote(paths);
  service = new PipelineService(pyannote, paths);
  return service;
}

async function handle(message) {
  const current = await getService();
  switch (message.type) {
    case "warmup":
      await current.loadPreview(message.config || {});
      return { warmed: true };
    case "preview":
      return {
        text: await current.transcribePreview(decodeAudio(message.audio), message.config),
      };
    case "close":
      await current.close();
      return { closed: true };
    default:
      throw new Error(`Unknown preview command: ${message.type}`);
  }
}

process.on("message", (message) => {
  handle(message)
    .then((result) => send({ id: message.id, ok: true, result }))
    .catch((error) => send({ id: message.id, ok: false, error: error.message || String(error) }));
});

process.on("disconnect", async () => {
  await service?.close().catch(() => undefined);
  process.exit(0);
});


