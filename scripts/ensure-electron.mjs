import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const electronDir = path.join(root, "node_modules", "electron");
const distDir = path.join(electronDir, "dist");
const pathTxt = path.join(electronDir, "path.txt");
const platformPath =
  process.platform === "darwin"
    ? "Electron.app/Contents/MacOS/Electron"
    : process.platform === "win32"
      ? "electron.exe"
      : "electron";

function isHealthy() {
  try {
    const exe = path.join(distDir, platformPath);
    if (!fs.existsSync(exe)) return false;
    if (!fs.existsSync(pathTxt)) return false;
    // On macOS the Mach-O stub is small; Chromium lives in Frameworks.
    if (process.platform === "darwin") {
      const frameworks = path.join(distDir, "Electron.app/Contents/Frameworks");
      if (!fs.existsSync(frameworks)) return false;
    } else if (fs.statSync(exe).size < 1_000_000) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

if (isHealthy()) {
  process.exit(0);
}

const { downloadArtifact } = require("@electron/get");
const { version } = require(path.join(electronDir, "package.json"));

const zipPath = await downloadArtifact({
  version,
  artifactName: "electron",
  platform: process.platform,
  arch: process.arch,
});

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "electron-ensure-"));
execFileSync("unzip", ["-q", zipPath, "-d", tmp], { stdio: "inherit" });
fs.rmSync(distDir, { recursive: true, force: true });
fs.renameSync(tmp, distDir);
fs.writeFileSync(pathTxt, platformPath);
console.log("Electron binary ensured at", path.join(distDir, platformPath));
