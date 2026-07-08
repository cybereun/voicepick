import test from "node:test";
import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { StorageService } from "../src/storage.mjs";

test("deleteRecording removes the recording row and its audio file", async () => {
  const root = join(process.cwd(), ".tmp-tests", randomUUID());
  await mkdir(root, { recursive: true });
  const storage = new StorageService(root);

  try {
    await storage.init();
    const recording = storage.createRecording({
      title: "delete file test",
      source: "microphone",
      language: "ko",
    });
    const audioPath = join(storage.recordingsDir, `${recording.id}.wav`);
    const micPath = join(storage.recordingsDir, `${recording.id}-microphone.wav`);
    const systemPath = join(storage.recordingsDir, `${recording.id}-system.wav`);
    await writeFile(audioPath, Buffer.from("fake wav"));
    await writeFile(micPath, Buffer.from("fake mic wav"));
    await writeFile(systemPath, Buffer.from("fake system wav"));
    storage.setRecordingAudioPath(recording.id, audioPath);
    storage.setRecordingSourceAudioPath(recording.id, "microphone", micPath);
    storage.setRecordingSourceAudioPath(recording.id, "system", systemPath);

    const deleted = storage.deleteRecording(recording.id);

    assert.equal(deleted.id, recording.id);
    assert.equal(storage.getRecording(recording.id), undefined);
    assert.equal(existsSync(audioPath), false);
    assert.equal(existsSync(micPath), false);
    assert.equal(existsSync(systemPath), false);
  } finally {
    storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

test("deleteOrphanedAudioFiles removes only WAV files that are not linked from the database", async () => {
  const root = join(process.cwd(), ".tmp-tests", randomUUID());
  await mkdir(root, { recursive: true });
  const storage = new StorageService(root);

  try {
    await storage.init();
    const recording = storage.createRecording({
      title: "keep linked file",
      source: "microphone",
      language: "ko",
    });
    const linkedPath = join(storage.recordingsDir, `${recording.id}.wav`);
    const linkedMicPath = join(storage.recordingsDir, `${recording.id}-microphone.wav`);
    const orphanPath = join(storage.recordingsDir, "orphan.wav");
    const textPath = join(storage.recordingsDir, "notes.txt");
    await writeFile(linkedPath, Buffer.from("linked wav"));
    await writeFile(linkedMicPath, Buffer.from("linked mic wav"));
    await writeFile(orphanPath, Buffer.from("orphan wav"));
    await writeFile(textPath, Buffer.from("not audio"));
    storage.setRecordingAudioPath(recording.id, linkedPath);
    storage.setRecordingSourceAudioPath(recording.id, "microphone", linkedMicPath);

    const before = storage.listOrphanedAudioFiles();
    const result = storage.deleteOrphanedAudioFiles();

    assert.deepEqual(before.map((file) => file.name), ["orphan.wav"]);
    assert.equal(result.deletedCount, 1);
    assert.equal(existsSync(orphanPath), false);
    assert.equal(existsSync(linkedPath), true);
    assert.equal(existsSync(linkedMicPath), true);
    assert.equal(existsSync(textPath), true);
  } finally {
    storage.close();
    await rm(root, { recursive: true, force: true });
  }
});

