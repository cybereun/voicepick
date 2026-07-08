export function normalizeTranscriptText(text) {
  return String(text || "")
    .replace(/\s+([.,!?;:'")\]}])/g, "$1")
    .replace(/([[({])\s+/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function words(text) {
  return normalizeTranscriptText(text).split(/\s+/).filter(Boolean);
}

function commonPrefixByWords(left, right) {
  const leftWords = words(left);
  const rightWords = words(right);
  const matched = [];
  const count = Math.min(leftWords.length, rightWords.length);
  for (let i = 0; i < count; i += 1) {
    if (leftWords[i] !== rightWords[i]) break;
    matched.push(leftWords[i]);
  }
  return matched.join(" ");
}

function removePrefix(text, prefix) {
  const cleanText = normalizeTranscriptText(text);
  const cleanPrefix = normalizeTranscriptText(prefix);
  if (!cleanPrefix) return cleanText;
  if (cleanText === cleanPrefix) return "";
  if (cleanText.startsWith(`${cleanPrefix} `)) return cleanText.slice(cleanPrefix.length).trim();
  return cleanText;
}

export function removeCommittedPrefix(previewText, committedText) {
  const preview = normalizeTranscriptText(previewText);
  const committed = normalizeTranscriptText(committedText);
  if (!preview || !committed) return preview;
  if (committed.includes(preview)) return "";

  const previewWords = words(preview);
  const committedWords = words(committed);
  const max = Math.min(previewWords.length, committedWords.length);
  for (let size = max; size >= 2; size -= 1) {
    const committedTail = committedWords.slice(-size).join(" ");
    const previewHead = previewWords.slice(0, size).join(" ");
    if (committedTail === previewHead) {
      return previewWords.slice(size).join(" ");
    }
  }
  return preview;
}

export class LocalAgreement {
  constructor({ minStableChars = 8 } = {}) {
    this.minStableChars = minStableChars;
    this.lastPreviewText = "";
    this.lastStableText = "";
    this.lastInterimText = "";
  }

  reset() {
    this.lastPreviewText = "";
    this.lastStableText = "";
    this.lastInterimText = "";
  }

  update(previewText, committedText = "") {
    const current = removeCommittedPrefix(previewText, committedText);
    if (!current) return this.result("", "", false);
    if (current === this.lastPreviewText) {
      return this.result(this.lastStableText, this.lastInterimText, false);
    }

    const stable = commonPrefixByWords(this.lastPreviewText, current);
    const stableText = stable.length >= this.minStableChars ? stable : "";
    const interimText = removePrefix(current, stableText);
    const changed = stableText !== this.lastStableText || interimText !== this.lastInterimText;

    this.lastPreviewText = current;
    this.lastStableText = stableText;
    this.lastInterimText = interimText;
    return this.result(stableText, interimText, changed);
  }

  result(stableText, interimText, changed) {
    return {
      stableText: normalizeTranscriptText(stableText),
      interimText: normalizeTranscriptText(interimText),
      changed,
    };
  }
}

export function mergeFinalSegments(segments, { maxGapMs = 1800, maxChars = 420 } = {}) {
  const merged = [];
  for (const segment of segments || []) {
    const text = normalizeTranscriptText(segment.text);
    if (!text) continue;
    const current = {
      ...segment,
      startMs: Math.max(0, Math.round(segment.startMs ?? segment.start_ms ?? 0)),
      endMs: Math.max(0, Math.round(segment.endMs ?? segment.end_ms ?? segment.startMs ?? segment.start_ms ?? 0)),
      text,
    };
    const previous = merged[merged.length - 1];
    const sameSpeaker = previous && (previous.speaker || "") === (current.speaker || "");
    const closeEnough = previous && current.startMs - previous.endMs <= maxGapMs;
    const shortEnough = previous && `${previous.text} ${current.text}`.length <= maxChars;
    if (sameSpeaker && closeEnough && shortEnough) {
      previous.endMs = Math.max(previous.endMs, current.endMs);
      previous.text = normalizeTranscriptText(`${previous.text} ${current.text}`);
    } else {
      merged.push(current);
    }
  }
  return merged;
}
