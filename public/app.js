const state = {
  recording: false,
  busy: false,
  activeId: null,
  recordings: [],
  transcript: [],
  interim: [],
  previewAgreement: null,
  latestLevel: 0,
  sourceLevels: { microphone: 0, system: 0 },
  microphoneQuality: null,
  defaultOutputName: "",
  eventSource: null,
};

const els = {
  statusPill: document.querySelector("#statusPill"),
  statusText: document.querySelector("#statusText"),
  recordButton: document.querySelector("#recordButton"),
  recordButtonText: document.querySelector("#recordButtonText"),
  titleInput: document.querySelector("#titleInput"),
  sourceSelect: document.querySelector("#sourceSelect"),
  deviceSelect: document.querySelector("#deviceSelect"),
  languageSelect: document.querySelector("#languageSelect"),
  backendSelect: document.querySelector("#backendSelect"),
  diarizationToggle: document.querySelector("#diarizationToggle"),
  meterCanvas: document.querySelector("#meterCanvas"),
  levelText: document.querySelector("#levelText"),
  sourceLevelText: document.querySelector("#sourceLevelText"),
  micQualityPanel: document.querySelector("#micQualityPanel"),
  micQualityText: document.querySelector("#micQualityText"),
  micQualityStats: document.querySelector("#micQualityStats"),
  engineText: document.querySelector("#engineText"),
  recordings: document.querySelector("#recordings"),
  activeTitle: document.querySelector("#activeTitle"),
  activeMeta: document.querySelector("#activeMeta"),
  liveText: document.querySelector("#liveText"),
  segments: document.querySelector("#segments"),
  refreshButton: document.querySelector("#refreshButton"),
  cleanupButton: document.querySelector("#cleanupButton"),
  copyButton: document.querySelector("#copyButton"),
  deleteButton: document.querySelector("#deleteButton"),
};

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: {
      "content-type": "application/json",
      ...(options.headers || {}),
    },
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || "요청 실패");
  return json;
}

function setStatus(text, recording = false) {
  els.statusText.textContent = text;
  els.statusPill.classList.toggle("is-recording", recording);
}

function setBusy(busy) {
  state.busy = busy;
  els.recordButton.disabled = busy;
}

function formatTime(ms = 0) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function formatBytes(bytes = 0) {
  const value = Math.max(0, Number(bytes) || 0);
  if (value >= 1024 * 1024 * 1024) return `${(value / 1024 / 1024 / 1024).toFixed(2)}GB`;
  if (value >= 1024 * 1024) return `${(value / 1024 / 1024).toFixed(1)}MB`;
  if (value >= 1024) return `${(value / 1024).toFixed(1)}KB`;
  return `${value}B`;
}

function sourceLabel(source) {
  return { microphone: "마이크", system: "컴퓨터 소리", mixed: "마이크+컴퓨터" }[source] || source;
}

function speakerLabel(speaker) {
  const match = /^SPEAKER_(\d+)$/.exec(speaker || "");
  return match ? `화자 ${Number(match[1]) + 1}` : speaker || "화자 1";
}

function renderRecordings() {
  els.recordings.replaceChildren();
  if (state.recordings.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "저장된 녹음이 없습니다";
    els.recordings.append(empty);
    return;
  }

  for (const recording of state.recordings) {
    const button = document.createElement("button");
    button.className = "recording-item";
    button.classList.toggle("is-active", recording.id === state.activeId);
    button.type = "button";
    button.innerHTML = `
      <span class="recording-title"></span>
      <span class="recording-meta"></span>
    `;
    button.querySelector(".recording-title").textContent = recording.title;
    button.querySelector(".recording-meta").textContent =
      `${formatTime(recording.duration_ms)} · ${sourceLabel(recording.source)} · ${recording.line_count || 0}줄`;
    button.addEventListener("click", () => selectRecording(recording.id));
    els.recordings.append(button);
  }
}

function groupSegments(segments) {
  const groups = [];
  for (const segment of segments) {
    const speaker = segment.speakerLabel || segment.speaker || "화자 1";
    const last = groups[groups.length - 1];
    if (last && last.speaker === speaker) {
      last.segments.push(segment);
      last.endMs = segment.endMs ?? segment.end_ms ?? last.endMs;
    } else {
      groups.push({
        speaker,
        startMs: segment.startMs ?? segment.start_ms ?? 0,
        endMs: segment.endMs ?? segment.end_ms ?? 0,
        segments: [segment],
      });
    }
  }
  return groups;
}

function renderTranscript() {
  const active = state.recordings.find((item) => item.id === state.activeId);
  els.activeTitle.textContent = active?.title || "새 녹음";
  els.activeMeta.textContent = active
    ? `${formatTime(active.duration_ms)} · ${sourceLabel(active.source)} · ${active.status}`
    : "대기";
  els.segments.replaceChildren();

  const segments = state.transcript.map((entry) => ({
    speaker: entry.speaker || "",
    speakerLabel: entry.speakerLabel || speakerLabel(entry.speaker),
    startMs: entry.startMs ?? entry.start_ms,
    endMs: entry.endMs ?? entry.end_ms,
    text: entry.text,
  }));

  if (segments.length === 0) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "아직 기록된 문장이 없습니다";
    els.segments.append(empty);
    return;
  }

  for (const group of groupSegments(segments)) {
    const block = document.createElement("article");
    block.className = "speaker-block";
    const index = Number((group.speaker.match(/\d+/) || ["1"])[0]);
    block.innerHTML = `
      <div class="speaker-badge">${index}</div>
      <div>
        <div class="speaker-head"><strong></strong><span></span></div>
        <p></p>
      </div>
    `;
    block.querySelector("strong").textContent = group.speaker;
    block.querySelector("span").textContent = formatTime(group.startMs);
    block.querySelector("p").textContent = group.segments.map((segment) => segment.text).join(" ");
    els.segments.append(block);
  }
  els.segments.scrollTop = els.segments.scrollHeight;
}

async function refreshStatus() {
  const result = await api("/api/status");
  if (!result.ok) {
    setStatus("초기화 오류", false);
    els.engineText.textContent = result.startupError || "초기화 실패";
    return;
  }

  const active = result.status?.active;
  state.recording = Boolean(result.status?.recording);
  const isStopping = active?.status === "stopping";
  const isStarting = active?.status === "starting";

  setStatus(isStopping ? "정리 중" : state.recording ? "녹음 중" : "대기", state.recording && !isStopping);
  els.recordButton.classList.toggle("is-recording", state.recording);
  els.recordButtonText.textContent = isStarting ? "준비 중" : isStopping ? "정리 중" : state.recording ? "녹음 중지" : "녹음 시작";
  els.recordButton.disabled = state.busy || isStopping;
  if (els.cleanupButton) els.cleanupButton.disabled = state.busy || state.recording;

  const modelStatus = result.status?.pipeline?.modelStatus || {};
  const missing = Object.entries(modelStatus).filter(([, ok]) => !ok).map(([key]) => key);
  const backendText = result.status?.pipeline?.capabilities?.supportedBackendTypes?.join(", ") || "backend 확인";
  const isolated = result.status?.pipeline?.capabilities?.isolated ? " · 격리 엔진" : "";
  const outputText = state.defaultOutputName ? ` · 컴퓨터 소리: ${state.defaultOutputName}` : "";
  els.engineText.textContent = missing.length ? `모델 누락: ${missing.join(", ")}` : `pyannote 준비 · ${backendText}${isolated}${outputText}`;
}

async function loadDevices() {
  const result = await api("/api/devices");
  state.defaultOutputName = (result.outputDevices || []).find((device) => device.isDefault)?.name || "";
  els.deviceSelect.replaceChildren();
  const defaultOption = document.createElement("option");
  defaultOption.value = "default";
  defaultOption.textContent = "기본 마이크";
  els.deviceSelect.append(defaultOption);
  for (const device of result.devices || []) {
    const option = document.createElement("option");
    option.value = device.id;
    option.textContent = device.isDefault ? `${device.name} · 기본` : device.name;
    els.deviceSelect.append(option);
  }
}

async function loadRecordings() {
  const result = await api("/api/recordings");
  state.recordings = result.recordings || [];
  if (!state.activeId && state.recordings[0]) state.activeId = state.recordings[0].id;
  renderRecordings();
  if (state.activeId) await loadTranscript(state.activeId);
  else renderTranscript();
}

async function loadTranscript(id) {
  const result = await api(`/api/recordings/${id}/transcript`);
  state.activeId = id;
  state.transcript = result.transcript || [];
  renderRecordings();
  renderTranscript();
}

async function selectRecording(id) {
  await loadTranscript(id);
}

async function startRecording() {
  setBusy(true);
  try {
    const config = {
      title: els.titleInput.value.trim(),
      source: els.sourceSelect.value,
      deviceId: els.deviceSelect.value,
      language: els.languageSelect.value,
      backend: els.backendSelect.value,
      diarization: els.diarizationToggle.checked,
    };
    setInputsDisabled(true);
    setStatus("엔진 준비 중", false);
    const result = await api("/api/recording/start", {
      method: "POST",
      body: JSON.stringify(config),
    });
    state.activeId = result.active.id;
    state.transcript = [];
    state.interim = [];
    state.previewAgreement = null;
    state.sourceLevels = { microphone: 0, system: 0 };
    renderLiveText("듣는 중");
    await loadRecordings();
    await refreshStatus();
  } finally {
    setBusy(false);
    await refreshStatus().catch(() => undefined);
  }
}

async function stopRecording() {
  setBusy(true);
  try {
    setStatus("정리 중", false);
    await api("/api/recording/stop", { method: "POST", body: "{}" });
    setInputsDisabled(false);
    await loadRecordings();
    await refreshStatus();
  } finally {
    setBusy(false);
    await refreshStatus().catch(() => undefined);
  }
}

function setInputsDisabled(disabled) {
  for (const el of [els.titleInput, els.sourceSelect, els.deviceSelect, els.languageSelect, els.backendSelect, els.diarizationToggle]) {
    el.disabled = disabled;
  }
}

async function toggleRecording() {
  if (state.busy) return;
  try {
    if (state.recording) await stopRecording();
    else await startRecording();
  } catch (error) {
    console.error(error);
    setBusy(false);
    setInputsDisabled(false);
    setStatus("오류", false);
    renderLiveText(error.message);
  }
}

function connectEvents() {
  state.eventSource?.close();
  const source = new EventSource("/api/events");
  state.eventSource = source;
  source.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === "level") {
      state.latestLevel = data.level || 0;
      els.levelText.textContent = `입력 ${Math.round(state.latestLevel * 100)}%`;
    }
    if (data.type === "microphone-quality") {
      state.microphoneQuality = data;
      renderMicrophoneQuality();
    }
    if (data.type === "source-level") {
      if (data.source === "microphone" || data.source === "system") {
        state.sourceLevels[data.source] = data.level || 0;
      }
      renderSourceLevels();
    }
    if (data.type === "segments") {
      state.transcript = data.finalSegments || data.segments || [];
      state.interim = data.interimSegments || [];
      state.previewAgreement = data.previewAgreement || null;
      renderLiveText();
      renderTranscript();
    }
    if (data.type === "finalizing") {
      renderLiveText(data.message || "최종 정리 중");
    }
    if (data.type === "recording-starting" || data.type === "recording-started") {
      refreshStatus().catch(console.error);
    }
    if (data.type === "recording-stopped") {
      state.transcript = data.segments || [];
      state.interim = [];
      state.previewAgreement = null;
      renderLiveText("최종 결과가 아래에 정리되었습니다");
      renderTranscript();
      loadRecordings().catch(console.error);
      refreshStatus().catch(console.error);
    }
    if (data.type === "error") {
      renderLiveText(data.message);
    }
  };
  source.onerror = () => {
    setStatus("서버 연결 끊김", false);
    setTimeout(() => {
      if (state.eventSource === source) connectEvents();
    }, 1200);
  };
}

function renderLiveText(message) {
  els.liveText.replaceChildren();
  if (message) {
    els.liveText.textContent = message;
    return;
  }
  const agreement = state.previewAgreement;
  const stable = agreement?.stableText || state.interim.map((segment) => segment.stableText).filter(Boolean).join(" ");
  const interim = agreement?.interimText || state.interim.map((segment) => segment.interimText || segment.text).join(" ");
  if (!stable && !interim) {
    els.liveText.textContent = "듣는 중";
    return;
  }
  if (stable) {
    const stableSpan = document.createElement("span");
    stableSpan.className = "live-stable";
    stableSpan.textContent = stable;
    els.liveText.append(stableSpan);
  }
  if (interim) {
    const interimSpan = document.createElement("span");
    interimSpan.className = "live-interim";
    interimSpan.textContent = stable ? ` ${interim}` : interim;
    els.liveText.append(interimSpan);
  }
}

function renderMicrophoneQuality() {
  if (!els.micQualityPanel || !els.micQualityText || !els.micQualityStats) return;
  const quality = state.microphoneQuality;
  if (!state.recording || !quality) {
    els.micQualityPanel.className = "mic-quality is-idle";
    els.micQualityText.textContent = "마이크 대기";
    els.micQualityStats.textContent = "Peak 0% · RMS 0% · 발화 0%";
    return;
  }
  const status = quality.status || "warming";
  els.micQualityPanel.className = `mic-quality is-${status}`;
  els.micQualityText.textContent = quality.message || "마이크 확인 중";
  const peak = Math.round((quality.peak || 0) * 100);
  const rms = Math.round((quality.rms || 0) * 100);
  const speech = Math.round((quality.speechRatio || 0) * 100);
  els.micQualityStats.textContent = `Peak ${peak}% · RMS ${rms}% · 발화 ${speech}%`;
}
function renderSourceLevels() {
  if (!els.sourceLevelText) return;
  const mic = Math.round((state.sourceLevels.microphone || 0) * 100);
  const system = Math.round((state.sourceLevels.system || 0) * 100);
  els.sourceLevelText.textContent = `마이크 ${mic}% · 컴퓨터 ${system}%`;
}

function drawMeter() {
  const canvas = els.meterCanvas;
  const ctx = canvas.getContext("2d");
  const width = canvas.width;
  const height = canvas.height;
  ctx.fillStyle = "#0d0f12";
  ctx.fillRect(0, 0, width, height);
  const bars = 96;
  const level = Math.min(1, state.latestLevel * 1.8);
  for (let i = 0; i < bars; i += 1) {
    const phase = (Date.now() / 240 + i) % bars;
    const activity = Math.max(0.05, level * (0.35 + 0.65 * Math.abs(Math.sin(phase * 0.21))));
    const barHeight = activity * height * 0.75;
    const x = (i / bars) * width;
    ctx.fillStyle = i % 5 === 0 ? "#4dabf7" : "#20c997";
    ctx.fillRect(x + 2, (height - barHeight) / 2, Math.max(3, width / bars - 4), barHeight);
  }
  state.latestLevel *= 0.92;
  state.sourceLevels.microphone *= 0.9;
  state.sourceLevels.system *= 0.9;
  renderSourceLevels();
  requestAnimationFrame(drawMeter);
}

async function copyTranscript() {
  const text = state.transcript.map((entry) => `${speakerLabel(entry.speaker)} ${formatTime(entry.start_ms ?? entry.startMs)} ${entry.text}`).join("\n");
  await navigator.clipboard.writeText(text);
  setStatus("복사됨", false);
  setTimeout(() => setStatus(state.recording ? "녹음 중" : "대기", state.recording), 900);
}

async function cleanupOrphanedWavs() {
  if (state.recording || state.busy) return;
  setBusy(true);
  try {
    const summary = await api("/api/storage/orphans");
    if (!summary.count) {
      setStatus("정리할 WAV 없음", false);
      setTimeout(() => refreshStatus().catch(console.error), 900);
      return;
    }
    const message = `DB에 연결되지 않은 WAV ${summary.count}개 (${formatBytes(summary.totalBytes)})를 삭제할까요?`;
    if (!confirm(message)) return;
    const cleaned = await api("/api/storage/orphans/cleanup", { method: "POST", body: "{}" });
    setStatus(`WAV ${cleaned.result.deletedCount}개 정리됨`, false);
    await loadRecordings();
  } finally {
    setBusy(false);
    await refreshStatus().catch(() => undefined);
  }
}

async function deleteActive() {
  if (!state.activeId || state.recording) return;
  if (!confirm("선택한 녹음을 삭제할까요?")) return;
  await api(`/api/recordings/${state.activeId}`, { method: "DELETE" });
  state.activeId = null;
  state.transcript = [];
  await loadRecordings();
}

els.recordButton.addEventListener("click", toggleRecording);
els.refreshButton.addEventListener("click", loadRecordings);
els.cleanupButton?.addEventListener("click", () => cleanupOrphanedWavs().catch(console.error));
els.copyButton.addEventListener("click", () => copyTranscript().catch(console.error));
els.deleteButton.addEventListener("click", () => deleteActive().catch(console.error));

connectEvents();
drawMeter();
await refreshStatus();
await loadDevices().catch((error) => {
  els.deviceSelect.innerHTML = "<option>마이크 확인 실패</option>";
  renderLiveText(error.message);
});
await refreshStatus();
await loadRecordings();






