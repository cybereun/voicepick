import { access } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(here, "..");
const workspaceRoot = resolve(appRoot, "..");

const candidates = {
  altResources: [
    process.env.VOICEPICK_ALT_RESOURCES,
    join(workspaceRoot, "current", "resources"),
    join(appRoot, "current", "resources"),
    "C:\\Users\\j.u.Eun\\AppData\\Local\\Alt\\current\\resources",
  ].filter(Boolean),
  whisperModels: [
    process.env.VOICEPICK_WHISPER_MODEL,
    join(workspaceRoot, "models", "whisper", "ggml-large-v3-turbo-q5_0.bin"),
    join(appRoot, "models", "whisper", "ggml-large-v3-turbo-q5_0.bin"),
    "H:\\App-2026\\live-recorder\\whisper-cpp\\ggml-large-v3-turbo-q5_0.bin",
    "H:\\App-2026\\live-recorder\\whisper-cpp\\ggml-base.bin",
  ].filter(Boolean),
  previewModels: [
    process.env.VOICEPICK_PREVIEW_MODEL,
    join(workspaceRoot, "models", "whisper", "ggml-base.bin"),
    join(appRoot, "models", "whisper", "ggml-base.bin"),
    "H:/App-2026/live-recorder/whisper-cpp/ggml-base.bin",
    process.env.VOICEPICK_WHISPER_MODEL,
    "H:/App-2026/live-recorder/whisper-cpp/ggml-large-v3-turbo-q5_0.bin",
  ].filter(Boolean),
};
async function firstExisting(paths) {
  for (const item of paths) {
    try {
      await access(item);
      return item;
    } catch {}
  }
  return null;
}

export async function resolveRuntimePaths() {
  const altResources = await firstExisting(candidates.altResources);
  const nodeModules = altResources ? join(altResources, "app.asar.unpacked", "node_modules") : null;
  const whisperModelPath = await firstExisting(candidates.whisperModels);
  const previewModelPath = await firstExisting(candidates.previewModels);
  const diarizationDir = altResources ? join(altResources, "diarization") : null;
  const vadModelPath = altResources ? join(altResources, "vad", "ggml-silero-v6.2.0.bin") : null;
  const ffmpegPath = nodeModules ? join(nodeModules, "ffmpeg-static", "ffmpeg.exe") : null;
  const openvinoEncoderXml = whisperModelPath
    ? join(dirname(whisperModelPath), "ggml-large-v3-turbo-encoder-openvino.xml")
    : null;
  const openvinoEncoderBin = whisperModelPath
    ? join(dirname(whisperModelPath), "ggml-large-v3-turbo-encoder-openvino.bin")
    : null;

  return {
    appRoot,
    workspaceRoot,
    altResources,
    nodeModules,
    whisperModelPath,
    previewModelPath,
    diarizationDir,
    vadModelPath: vadModelPath && existsSync(vadModelPath) ? vadModelPath : null,
    ffmpegPath: ffmpegPath && existsSync(ffmpegPath) ? ffmpegPath : null,
    models: {
      segModelPath: diarizationDir ? join(diarizationDir, "segmentation.gguf") : null,
      embModelPath: diarizationDir ? join(diarizationDir, "embedding.gguf") : null,
      pldaPath: diarizationDir ? join(diarizationDir, "plda.gguf") : null,
      embOpenvinoPath: diarizationDir ? join(diarizationDir, "embedding-openvino.xml") : null,
      openvinoEncoderXml: openvinoEncoderXml && existsSync(openvinoEncoderXml) && existsSync(openvinoEncoderBin) ? openvinoEncoderXml : null,
    },
  };
}

export async function loadNativeAudio(paths) {
  if (!paths.nodeModules) throw new Error("Alt native module folder was not found");
  const entry = join(paths.nodeModules, "native-audio-node", "dist", "index.js");
  await access(entry);
  return import(pathToFileURL(entry).href);
}

export function loadPyannote(paths) {
  if (!paths.nodeModules) throw new Error("Alt native module folder was not found");
  return require(join(paths.nodeModules, "pyannote-cpp-node"));
}

export function fileExists(path) {
  return Boolean(path && existsSync(path));
}



