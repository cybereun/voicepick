import { mkdir, open } from "node:fs/promises";
import { existsSync, readdirSync, statSync, unlinkSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { randomUUID } from "node:crypto";

export class StorageService {
  constructor(rootDir) {
    this.rootDir = rootDir;
    this.dbPath = join(rootDir, "data", "database", "voicepick.db");
    this.recordingsDir = join(rootDir, "data", "storage", "recordings");
    this.exportsDir = join(rootDir, "data", "storage", "exports");
    this.db = null;
  }

  async init() {
    await mkdir(dirname(this.dbPath), { recursive: true });
    await mkdir(this.recordingsDir, { recursive: true });
    await mkdir(this.exportsDir, { recursive: true });
    this.db = new DatabaseSync(this.dbPath);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      CREATE TABLE IF NOT EXISTS recordings (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        source TEXT NOT NULL,
        language TEXT NOT NULL,
        status TEXT NOT NULL,
        audio_path TEXT,
        duration_ms INTEGER DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS recording_audio_sources (
        recording_id TEXT NOT NULL,
        source TEXT NOT NULL,
        audio_path TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY (recording_id, source),
        FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_recording_audio_sources_recording ON recording_audio_sources(recording_id);
      CREATE TABLE IF NOT EXISTS transcript_entries (
        id TEXT PRIMARY KEY,
        recording_id TEXT NOT NULL,
        speaker TEXT,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        text TEXT NOT NULL,
        is_final INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        FOREIGN KEY (recording_id) REFERENCES recordings(id) ON DELETE CASCADE
      );
      CREATE INDEX IF NOT EXISTS idx_transcript_entries_recording ON transcript_entries(recording_id, start_ms);
      CREATE TABLE IF NOT EXISTS settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
    `);
  }

  createRecording({ title, source, language }) {
    const now = new Date().toISOString();
    const id = randomUUID();
    const safeTitle = title?.trim() || `VoicePick ${new Date().toLocaleString("ko-KR", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
    this.db.prepare(`
      INSERT INTO recordings (id, title, source, language, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'recording', ?, ?)
    `).run(id, safeTitle, source, language, now, now);
    return this.getRecording(id);
  }

  setRecordingAudioPath(id, audioPath) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE recordings SET audio_path = ?, updated_at = ? WHERE id = ?").run(audioPath, now, id);
  }

  setRecordingSourceAudioPath(recordingId, source, audioPath) {
    const now = new Date().toISOString();
    this.db.prepare(`
      INSERT INTO recording_audio_sources (recording_id, source, audio_path, created_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(recording_id, source) DO UPDATE SET audio_path = excluded.audio_path
    `).run(recordingId, source, audioPath, now);
  }

  updateRecordingStatus(id, status, durationMs = 0) {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE recordings SET status = ?, duration_ms = ?, updated_at = ? WHERE id = ?").run(status, Math.round(durationMs), now, id);
  }

  upsertSegments(recordingId, segments, { replace = true } = {}) {
    const now = new Date().toISOString();
    this.db.exec("BEGIN IMMEDIATE");
    try {
      if (replace) this.db.prepare("DELETE FROM transcript_entries WHERE recording_id = ?").run(recordingId);
      const insert = this.db.prepare(`
        INSERT INTO transcript_entries (id, recording_id, speaker, start_ms, end_ms, text, is_final, created_at)
        VALUES (?, ?, ?, ?, ?, ?, 1, ?)
      `);
      for (const segment of segments) {
        const text = String(segment.text || "").trim();
        if (!text) continue;
        insert.run(
          randomUUID(),
          recordingId,
          segment.speaker || "",
          Math.max(0, Math.round(segment.startMs || 0)),
          Math.max(0, Math.round(segment.endMs || segment.startMs || 0)),
          text,
          now,
        );
      }
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  appendEntry(recordingId, segment) {
    const now = new Date().toISOString();
    const text = String(segment.text || "").trim();
    if (!text) return;
    this.db.prepare(`
      INSERT INTO transcript_entries (id, recording_id, speaker, start_ms, end_ms, text, is_final, created_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, ?)
    `).run(randomUUID(), recordingId, segment.speaker || "", segment.startMs || 0, segment.endMs || segment.startMs || 0, text, now);
  }

  listRecordings() {
    return this.db.prepare(`
      SELECT r.*,
        (SELECT COUNT(*) FROM transcript_entries e WHERE e.recording_id = r.id) AS line_count
      FROM recordings r
      ORDER BY r.created_at DESC
    `).all();
  }

  getRecording(id) {
    return this.db.prepare("SELECT * FROM recordings WHERE id = ?").get(id);
  }

  listRecordingAudioSources(recordingId) {
    return this.db.prepare(`
      SELECT source, audio_path FROM recording_audio_sources
      WHERE recording_id = ?
      ORDER BY source ASC
    `).all(recordingId);
  }

  getTranscript(recordingId) {
    return this.db.prepare(`
      SELECT * FROM transcript_entries
      WHERE recording_id = ?
      ORDER BY start_ms ASC, created_at ASC
    `).all(recordingId);
  }

  listOrphanedAudioFiles() {
    if (!existsSync(this.recordingsDir)) return [];
    const linkedRows = [
      ...this.db.prepare("SELECT audio_path FROM recordings WHERE audio_path IS NOT NULL AND audio_path != ''").all(),
      ...this.db.prepare("SELECT audio_path FROM recording_audio_sources WHERE audio_path IS NOT NULL AND audio_path != ''").all(),
    ];
    const linked = new Set(linkedRows.map((row) => resolve(row.audio_path)));
    const files = [];
    for (const entry of readdirSync(this.recordingsDir, { withFileTypes: true })) {
      if (!entry.isFile() || !entry.name.toLowerCase().endsWith(".wav")) continue;
      const audioPath = join(this.recordingsDir, entry.name);
      if (linked.has(resolve(audioPath))) continue;
      const stat = statSync(audioPath);
      files.push({
        name: basename(audioPath),
        path: audioPath,
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
      });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
  }

  deleteOrphanedAudioFiles() {
    const orphaned = this.listOrphanedAudioFiles();
    const deleted = [];
    for (const file of orphaned) {
      if (!isInsideDirectory(file.path, this.recordingsDir) || !existsSync(file.path)) continue;
      unlinkSync(file.path);
      deleted.push(file);
    }
    return {
      deleted,
      deletedCount: deleted.length,
      totalBytes: deleted.reduce((sum, file) => sum + file.size, 0),
    };
  }

  deleteRecording(id) {
    const recording = this.getRecording(id);
    const sourceAudioFiles = this.listRecordingAudioSources(id);
    this.db.prepare("DELETE FROM recordings WHERE id = ?").run(id);
    const audioPaths = [recording?.audio_path, ...sourceAudioFiles.map((file) => file.audio_path)].filter(Boolean);
    for (const audioPath of audioPaths) {
      if (isInsideDirectory(audioPath, this.recordingsDir) && existsSync(audioPath)) {
        unlinkSync(audioPath);
      }
    }
    return recording;
  }

  close() {
    this.db?.close();
    this.db = null;
  }
}

export class WavWriter {
  constructor(filePath, sampleRate = 16000) {
    this.filePath = filePath;
    this.sampleRate = sampleRate;
    this.samples = 0;
    this.handle = null;
  }

  async open() {
    await mkdir(dirname(this.filePath), { recursive: true });
    this.handle = await open(this.filePath, "w+");
    await this.handle.write(Buffer.alloc(44), 0, 44, 0);
  }

  async writeFloat32(float32) {
    if (!this.handle) return;
    const buffer = Buffer.alloc(float32.length * 2);
    for (let i = 0; i < float32.length; i += 1) {
      const sample = Math.max(-1, Math.min(1, float32[i]));
      buffer.writeInt16LE(Math.round(sample * 32767), i * 2);
    }
    await this.handle.write(buffer);
    this.samples += float32.length;
  }

  async close() {
    if (!this.handle) return;
    const dataBytes = this.samples * 2;
    const header = Buffer.alloc(44);
    header.write("RIFF", 0);
    header.writeUInt32LE(36 + dataBytes, 4);
    header.write("WAVE", 8);
    header.write("fmt ", 12);
    header.writeUInt32LE(16, 16);
    header.writeUInt16LE(1, 20);
    header.writeUInt16LE(1, 22);
    header.writeUInt32LE(this.sampleRate, 24);
    header.writeUInt32LE(this.sampleRate * 2, 28);
    header.writeUInt16LE(2, 32);
    header.writeUInt16LE(16, 34);
    header.write("data", 36);
    header.writeUInt32LE(dataBytes, 40);
    await this.handle.write(header, 0, 44, 0);
    await this.handle.close();
    this.handle = null;
  }

  get durationMs() {
    return (this.samples / this.sampleRate) * 1000;
  }
}

export function ensureUniqueRecordingPath(recordingsDir, recordingId) {
  let counter = 0;
  while (true) {
    const suffix = counter === 0 ? "" : `-${counter}`;
    const path = join(recordingsDir, `${recordingId}${suffix}.wav`);
    if (!existsSync(path)) return path;
    counter += 1;
  }
}

function isInsideDirectory(path, directory) {
  const target = resolve(path);
  const root = resolve(directory);
  const rel = relative(root, target);
  return rel && !rel.startsWith("..") && !rel.includes(":");
}


