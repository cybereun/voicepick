function normalizeText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

function uniqueSpeakerCount(segments) {
  return new Set((segments || []).map((segment) => segment.speaker).filter(Boolean)).size;
}

function speakerFromCue(cue) {
  const normalized = normalizeText(cue).toLowerCase();
  if (/^(speaker\s*(one|1)|화자\s*1|speaker\s*a|a\s*:)/i.test(normalized)) return "SPEAKER_00";
  if (/^(speaker\s*(two|2)|화자\s*2|speaker\s*b|b\s*:)/i.test(normalized)) return "SPEAKER_01";
  if (/^(speaker\s*(three|3)|화자\s*3|speaker\s*c|c\s*:)/i.test(normalized)) return "SPEAKER_02";
  return "";
}

const CUE_PATTERN = /(Speaker\s+(?:one|two|three|1|2|3)|화자\s*[123]|Speaker\s+[ABC]|[ABC]\s*:)/gi;

export function splitSpeakerCueSegments(segments) {
  const output = [];
  for (const segment of segments || []) {
    const text = normalizeText(segment.text);
    if (!text) continue;
    const matches = [...text.matchAll(CUE_PATTERN)];
    if (matches.length === 0) {
      output.push(segment);
      continue;
    }

    for (let i = 0; i < matches.length; i += 1) {
      const match = matches[i];
      const next = matches[i + 1];
      const speaker = speakerFromCue(match[0]) || segment.speaker || "";
      const startIndex = match.index + match[0].length;
      const endIndex = next ? next.index : text.length;
      const turnText = normalizeText(text.slice(startIndex, endIndex).replace(/^[:：\-–—\s]+/, ""));
      if (!turnText) continue;
      const ratioStart = Math.max(0, Math.min(1, match.index / Math.max(1, text.length)));
      const ratioEnd = Math.max(ratioStart, Math.min(1, endIndex / Math.max(1, text.length)));
      const duration = Math.max(0, (segment.endMs ?? segment.end_ms ?? 0) - (segment.startMs ?? segment.start_ms ?? 0));
      const baseStart = segment.startMs ?? segment.start_ms ?? 0;
      output.push({
        ...segment,
        speaker,
        startMs: Math.round(baseStart + duration * ratioStart),
        endMs: Math.round(baseStart + duration * ratioEnd),
        text: turnText,
      });
    }
  }
  return output;
}


export function applySpeakerFallbacks(segments) {
  if (!Array.isArray(segments) || segments.length === 0) return [];
  if (uniqueSpeakerCount(segments) > 1) return segments;

  const cueSplit = splitSpeakerCueSegments(segments);
  if (uniqueSpeakerCount(cueSplit) > 1) return cueSplit;

  return segments;
}
