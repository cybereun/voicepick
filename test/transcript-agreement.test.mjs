import test from "node:test";
import assert from "node:assert/strict";
import {
  LocalAgreement,
  removeCommittedPrefix,
  mergeFinalSegments,
} from "../src/transcript-agreement.mjs";

test("local agreement promotes only the repeated stable prefix", () => {
  const agreement = new LocalAgreement({ minStableChars: 6 });

  assert.deepEqual(agreement.update("오늘 수업은 시작합니다 다음으로").stableText, "");

  const second = agreement.update("오늘 수업은 시작합니다 다음 내용은");

  assert.equal(second.stableText, "오늘 수업은 시작합니다");
  assert.equal(second.interimText, "다음 내용은");
  assert.equal(second.changed, true);
});

test("local agreement suppresses duplicate output", () => {
  const agreement = new LocalAgreement({ minStableChars: 3 });
  agreement.update("반복 문장입니다 다음");
  agreement.update("반복 문장입니다 내용");

  const duplicate = agreement.update("반복 문장입니다 내용");

  assert.equal(duplicate.changed, false);
});

test("removeCommittedPrefix removes text already present in confirmed transcript", () => {
  const result = removeCommittedPrefix(
    "오늘 수업은 시작합니다 다음 내용은 노트에 적습니다",
    "선생님 인사 후 오늘 수업은 시작합니다",
  );

  assert.equal(result, "다음 내용은 노트에 적습니다");
});

test("mergeFinalSegments joins adjacent same-speaker fragments into paragraph-like segments", () => {
  const merged = mergeFinalSegments([
    { speaker: "SPEAKER_00", startMs: 0, endMs: 1000, text: "오늘 수업을 시작합니다" },
    { speaker: "SPEAKER_00", startMs: 1000, endMs: 2200, text: "교과서를 펴세요." },
    { speaker: "SPEAKER_01", startMs: 2300, endMs: 3200, text: "네 알겠습니다." },
    { speaker: "SPEAKER_01", startMs: 3300, endMs: 4300, text: "필기하겠습니다" },
  ]);

  assert.deepEqual(merged, [
    { speaker: "SPEAKER_00", startMs: 0, endMs: 2200, text: "오늘 수업을 시작합니다 교과서를 펴세요." },
    { speaker: "SPEAKER_01", startMs: 2300, endMs: 4300, text: "네 알겠습니다. 필기하겠습니다" },
  ]);
});
