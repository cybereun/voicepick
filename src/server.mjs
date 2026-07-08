import http from "node:http";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { resolveRuntimePaths, loadNativeAudio } from "./native-loader.mjs";
import { StorageService } from "./storage.mjs";
import { IsolatedPipelineService } from "./isolated-pipeline-service.mjs";
import { IsolatedPreviewService } from "./isolated-preview-service.mjs";
import { RecordingController } from "./recording-controller.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const publicDir = join(root, "public");
const port = Number(process.env.VOICEPICK_PORT || 5299);

const clients = new Set();
let runtimePaths;
let storage;
let nativeAudio;
let pipelineService;
let previewService;
let controller;
let startupError = null;

function sendEvent(event) {
  const payload = `data: ${JSON.stringify(event)}\n\n`;
  for (const response of clients) {
    try {
      if (response.destroyed || response.writableEnded) {
        clients.delete(response);
        continue;
      }
      response.write(payload);
    } catch (error) {
      clients.delete(response);
      console.error("[VoicePick] failed to send SSE event:", error);
    }
  }
}

async function init() {
  runtimePaths = await resolveRuntimePaths();
  storage = new StorageService(root);
  await storage.init();
  nativeAudio = await loadNativeAudio(runtimePaths);
  pipelineService = new IsolatedPipelineService(runtimePaths);
  previewService = new IsolatedPreviewService(runtimePaths);
  previewService.warmup({ language: "ko", backend: "cpu" }).catch((error) => {
    console.error("[VoicePick] preview warmup failed:", error.message || error);
  });
  controller = new RecordingController({ storage, nativeAudio, pipelineService, previewService });
  controller.on("event", sendEvent);
  controller.on("error", (error) => sendEvent({ type: "error", message: error.message }));
}

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
  });
  response.end(body);
}

async function bodyJson(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function routeApi(request, response, path) {
  if (path === "/api/events") {
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-store",
      connection: "keep-alive",
    });
    response.write("\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return true;
  }

  (async () => {
    if (path === "/api/status") {
      json(response, 200, {
        ok: !startupError,
        startupError: startupError?.message || null,
        runtimePaths,
        status: controller?.status() || null,
      });
      return;
    }
    if (!controller) throw startupError || new Error("VoicePick is not initialized");
    if (path === "/api/devices") {
      json(response, 200, controller.listDevices());
      return;
    }
    if (path === "/api/recordings") {
      json(response, 200, { recordings: storage.listRecordings() });
      return;
    }
    if (request.method === "GET" && path === "/api/storage/orphans") {
      const orphaned = storage.listOrphanedAudioFiles();
      json(response, 200, {
        orphaned,
        count: orphaned.length,
        totalBytes: orphaned.reduce((sum, file) => sum + file.size, 0),
      });
      return;
    }
    if (request.method === "POST" && path === "/api/storage/orphans/cleanup") {
      const result = storage.deleteOrphanedAudioFiles();
      json(response, 200, { ok: true, result });
      return;
    }
    if (path.startsWith("/api/recordings/") && path.endsWith("/transcript")) {
      const id = path.split("/")[3];
      json(response, 200, {
        recording: storage.getRecording(id),
        transcript: storage.getTranscript(id),
        sourceAudioFiles: storage.listRecordingAudioSources(id),
      });
      return;
    }
    if (request.method === "POST" && path === "/api/recording/start") {
      const config = await bodyJson(request);
      const active = await controller.start(config);
      json(response, 200, { ok: true, active });
      return;
    }
    if (request.method === "POST" && path === "/api/recording/stop") {
      const result = await controller.stop();
      json(response, 200, { ok: true, result });
      return;
    }
    if (request.method === "DELETE" && path.startsWith("/api/recordings/")) {
      const id = path.split("/")[3];
      const deleted = storage.deleteRecording(id);
      json(response, 200, { ok: true, deleted });
      return;
    }
    json(response, 404, { error: "not found" });
  })().catch((error) => {
    console.error(error);
    json(response, 500, { error: error.message || "server error" });
  });
  return true;
}

async function serveStatic(request, response, path) {
  const file = path === "/" ? "index.html" : decodeURIComponent(path.slice(1));
  const target = join(publicDir, file);
  if (!target.startsWith(publicDir) || !existsSync(target)) {
    response.writeHead(404);
    response.end("Not found");
    return;
  }
  const type = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "text/javascript; charset=utf-8",
  }[extname(target)] || "application/octet-stream";
  response.writeHead(200, { "content-type": type, "cache-control": "no-store" });
  response.end(await readFile(target));
}

await init().catch((error) => {
  startupError = error;
  console.error("[VoicePick] startup degraded:", error);
});

process.on("unhandledRejection", (reason) => {
  const error = reason instanceof Error ? reason : new Error(String(reason));
  console.error("[VoicePick] unhandled rejection:", error);
  sendEvent({ type: "error", message: error.message });
});

process.on("uncaughtException", (error) => {
  console.error("[VoicePick] uncaught exception:", error);
  sendEvent({ type: "error", message: error.message });
});

const server = http.createServer((request, response) => {
  const url = new URL(request.url, `http://${request.headers.host}`);
  if (url.pathname.startsWith("/api/")) {
    routeApi(request, response, url.pathname);
    return;
  }
  serveStatic(request, response, url.pathname).catch((error) => {
    console.error(error);
    response.writeHead(500);
    response.end(error.message);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[VoicePick] http://127.0.0.1:${port}`);
  setTimeout(() => {
    (async () => {
      await pipelineService?.load({ language: "ko", diarization: false, backend: "auto" });
    })().catch((error) => {
      console.error("[VoicePick] engine warmup failed:", error);
      sendEvent({ type: "error", message: error.message });
    });
  }, 250);
});

process.once("SIGINT", async () => {
  await controller?.stop().catch(() => undefined);
  await previewService?.close().catch(() => undefined);
  await pipelineService?.close().catch(() => undefined);
  storage?.close();
  server.close(() => process.exit(0));
});




