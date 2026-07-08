import { spawn } from "node:child_process";
import { openSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const cwd = dirname(fileURLToPath(import.meta.url));
const out = openSync(join(cwd, "voicepick-server.out.log"), "a");
const err = openSync(join(cwd, "voicepick-server.err.log"), "a");
const child = spawn("C:\\Program Files\\nodejs\\node.exe", ["--no-warnings", "src/server.mjs"], {
  cwd,
  detached: true,
  stdio: ["ignore", out, err],
  windowsHide: true,
});
child.unref();
console.log(child.pid);
