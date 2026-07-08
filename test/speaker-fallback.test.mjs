import test from "node:test";
import assert from "node:assert/strict";
import { applySpeakerFallbacks } from "../src/speaker-fallback.mjs";

test("speaker cue fallback splits English speaker one and speaker two turns", () => {
  const result = applySpeakerFallbacks([
    {
      speaker: "SPEAKER_00",
      startMs: 0,
      endMs: 30000,
      text: "Speaker one starts the meeting. Speaker two answers the question. Speaker one continues the topic. Speaker two finishes the sample.",
    },
  ]);

  assert.deepEqual([...new Set(result.map((segment) => segment.speaker))], ["SPEAKER_00", "SPEAKER_01"]);
  assert.equal(result.length, 4);
  assert.equal(result[0].text, "starts the meeting.");
  assert.equal(result[1].text, "answers the question.");
});

test("speaker cue fallback splits Korean speaker labels", () => {
  const result = applySpeakerFallbacks([
    {
      speaker: "",
      startMs: 0,
      endMs: 20000,
      text: "화자 1 오늘 수업을 시작합니다. 화자 2 네 알겠습니다. 화자 1 교과서를 펴세요.",
    },
  ]);

  assert.deepEqual(result.map((segment) => segment.speaker), ["SPEAKER_00", "SPEAKER_01", "SPEAKER_00"]);
  assert.equal(result[0].text, "오늘 수업을 시작합니다.");
});
test("speaker cue fallback supports three Korean speaker labels", () => {
  const result = applySpeakerFallbacks([
    {
      speaker: "",
      startMs: 0,
      endMs: 30000,
      text: "화자 1 첫 번째 의견입니다. 화자 2 두 번째 의견입니다. 화자 3 세 번째 의견입니다.",
    },
  ]);

  assert.deepEqual(result.map((segment) => segment.speaker), ["SPEAKER_00", "SPEAKER_01", "SPEAKER_02"]);
  assert.equal(result[2].text, "세 번째 의견입니다.");
});

test("speaker fallback does not invent speakers from dash-only dialogue text", () => {
  const segments = [
    { speaker: "SPEAKER_00", startMs: 0, endMs: 1000, text: "- 첫 번째 말입니다." },
    { speaker: "SPEAKER_00", startMs: 1000, endMs: 2000, text: "- 두 번째 말입니다." },
    { speaker: "SPEAKER_00", startMs: 2000, endMs: 3000, text: "- 세 번째 말입니다." },
    { speaker: "SPEAKER_00", startMs: 3000, endMs: 4000, text: "- 다시 첫 번째입니다." },
  ];

  assert.deepEqual(applySpeakerFallbacks(segments), segments);
});

test("speaker fallback leaves real multi-speaker diarization untouched", () => {
  const segments = [
    { speaker: "SPEAKER_00", startMs: 0, endMs: 1000, text: "hello" },
    { speaker: "SPEAKER_01", startMs: 1000, endMs: 2000, text: "hi" },
  ];

  assert.deepEqual(applySpeakerFallbacks(segments), segments);
});
