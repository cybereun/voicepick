import test from "node:test";
import assert from "node:assert/strict";
import { applyGain } from "../src/audio-mixer.mjs";

function approxArray(actual, expected, epsilon = 0.000001) {
  assert.equal(actual.length, expected.length);
  for (let i = 0; i < actual.length; i += 1) {
    assert.ok(Math.abs(actual[i] - expected[i]) <= epsilon, `${actual[i]} != ${expected[i]}`);
  }
}

test("applyGain amplifies low microphone samples and clips safely", () => {
  const input = new Float32Array([0.01, -0.02, 0.2, -0.2]);
  const output = applyGain(input, 8);

  approxArray(output, [0.08, -0.16, 1, -1]);
  approxArray(input, [0.01, -0.02, 0.2, -0.2]);
});

test("applyGain returns a copy when gain is neutral", () => {
  const input = new Float32Array([0.1, -0.1]);
  const output = applyGain(input, 1);

  assert.notEqual(output, input);
  approxArray(output, [0.1, -0.1]);
});
