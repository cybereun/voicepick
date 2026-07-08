# VoicePick

VoicePick is a new native-first recorder app built from the Alt local analysis.

It does not modify the existing `live-recorder` app. It uses a new data folder under `VoicePick\data`.

## Run

```powershell
cd H:\App-2026\Alt\VoicePick
npm start
```

Open:

```text
http://127.0.0.1:5299
```

## Applied Architecture

- Native microphone/system audio adapter through `native-audio-node` when available.
- 16 kHz mono Float32 PCM flow.
- Microphone/system/mixed recording modes.
- Real-time WAV writing to `data\storage\recordings`.
- SQLite database through Node 24 `node:sqlite`.
- `pyannote-cpp-node` streaming pipeline adapter.
- Speaker-labelled segment model when diarization models and Whisper model are present.

## Model Discovery

VoicePick auto-detects:

- Alt resources from `H:\App-2026\Alt\current\resources`
- Whisper large-v3 turbo from `H:\App-2026\live-recorder\whisper-cpp`

You can override paths:

```powershell
$env:VOICEPICK_ALT_RESOURCES="H:\App-2026\Alt\current\resources"
$env:VOICEPICK_WHISPER_MODEL="H:\App-2026\live-recorder\whisper-cpp\ggml-large-v3-turbo-q5_0.bin"
npm start
```

## Current Scope

This first VoicePick version is a functional native backend and local UI. Electron packaging is intentionally separate, because the current machine does not expose a global Electron CLI. The server design is ready to be wrapped by Electron/Tauri later.
