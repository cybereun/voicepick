import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { join } from "node:path";

const cwd = "H:\\App-2026\\Alt\\VoicePick";
const out = openSync(join(cwd, "voicepick-server.out.log"), "a");
const err = openSync(join(cwd, "voicepick-server.err.log"), "a");
const child = spawn("C:\\Program Files\\nodejs\\node.exe", ["--no-warnings", "src/server.mjs"], {
  cwd,
  detached: true,
  stdio: ["ignore", out, err],
  windowsHide: false,
});
child.unref();
console.log(child.pid);
