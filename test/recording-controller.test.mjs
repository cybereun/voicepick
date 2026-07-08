import test from "node:test";
import assert from "node:assert/strict";
import { analyzeAudioQuality, normalizeAudioForRecognition } from "../src/recording-controller.mjs";

function approxArray(actual, expected, epsilon = 0.000001) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i += 1) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= epsilon, `${actual[i]} != ${expected[i]}`);
  }
}

function peak(samples) {
  let value = 0;
  for (const sample of samples) value = Math.max(value, Math.abs(sample));
  return value;
}

test("normalizeAudioForRecognition lifts quiet audio without mutating input", () => {
  const input = new Float32Array([0.01, -0.05, 0.02]);
  const output = normalizeAudioForRecognition(input, { targetPeak: 0.5, maxGain: 12 });

  assert.notEqual(output, input);
  assert.equal(peak(output), 0.5);
  approxArray(input, [0.01, -0.05, 0.02]);
});

test("normalizeAudioForRecognition does not amplify already loud audio", () => {
  const input = new Float32Array([0.8, -0.2]);
  const output = normalizeAudioForRecognition(input, { targetPeak: 0.5, maxGain: 12 });

  assert.notEqual(output, input);
  approxArray(output, input);
});


test("analyzeAudioQuality flags quiet microphone input", () => {
  const input = new Float32Array(16000).fill(0.002);
  const quality = analyzeAudioQuality(input);

  assert.equal(quality.status, "too-quiet");
  assert.equal(quality.message, "마이크 입력이 너무 작습니다");
});

test("analyzeAudioQuality accepts clear speech-like input", () => {
  const input = new Float32Array(16000);
  for (let i = 0; i < input.length; i += 1) input[i] = i % 4 < 2 ? 0.18 : -0.18;
  const quality = analyzeAudioQuality(input);

  assert.equal(quality.status, "good");
  assert.ok(quality.speechRatio > 0.9);
});
