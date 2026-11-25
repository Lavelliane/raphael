// Build a local Mac app with its own Python interpreter and native audio modules.
import { packager } from "@electron/packager";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  cpSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.platform !== "darwin")
  throw Error("Build Raphael.app on the Mac that will run it.");
const root = fileURLToPath(new URL("../", import.meta.url));
const venv = path.join(root, ".venv/bin/python");
const python =
  process.env.RAPHAEL_PYTHON || (existsSync(venv) ? venv : "python3");
const metadata = JSON.parse(
  readFileSync(path.join(root, "package.json"), "utf8"),
);
const work = mkdtempSync(path.join(os.tmpdir(), "raphael-app-"));
const stage = path.join(work, "app");
try {
  execFileSync(
    python,
    ["-c", "import numpy,soundcard,pysysaudio,PyInstaller"],
    { stdio: "inherit" },
  );
  execFileSync(
    python,
    [
      "-m",
      "PyInstaller",
      "--noconfirm",
      "--onedir",
      "--name",
      "raphael-engine",
      "--distpath",
      path.join(work, "engine"),
      "--workpath",
      path.join(work, "freeze"),
      "--specpath",
      work,
      "--collect-all",
      "pysysaudio",
      "--collect-all",
      "soundcard",
      path.join(root, "desktop_service.py"),
    ],
    { cwd: root, stdio: "inherit" },
  );
  mkdirSync(stage);
  cpSync(path.join(root, "dist"), path.join(stage, "dist"), {
    recursive: true,
  });
  writeFileSync(
    path.join(stage, "package.json"),
    JSON.stringify({
      name: metadata.name,
      productName: "Raphael",
      version: metadata.version,
      main: metadata.main,
    }),
  );
  const resources = [path.join(work, "engine", "raphael-engine")];
  const modelFolder = path.join(work, "models");
  const model = [
    process.env.RAPHAEL_WHISPER_MODEL,
    ...["ggml-base-q5_1.bin", "ggml-small-q5_1.bin"].map((n) =>
      path.join(root, "models", n),
    ),
  ].find((p) => p && existsSync(p));
  if (model) {
    mkdirSync(modelFolder);
    cpSync(model, path.join(modelFolder, "meeting-model.bin"));
    resources.push(modelFolder);
  } else {
    console.log(
      "No local model to bundle. The app will need an already-running whisper-server.",
    );
  }
  // Finder may start the app with a shorter PATH than the terminal used for the build.
  const toolDirs = [
    ...new Set(
      ["codex", "whisper-server"]
        .map((name) => {
          try {
            return path.dirname(
              execFileSync("/usr/bin/which", [name], {
                encoding: "utf8",
              }).trim(),
            );
          } catch {
            return null;
          }
        })
        .filter(Boolean),
    ),
  ];
  writeFileSync(path.join(stage, "tool-dirs.json"), JSON.stringify(toolDirs));
  const outputs = await packager({
    dir: stage,
    out: path.join(root, "release"),
    name: "Raphael",
    platform: "darwin",
    arch: process.arch,
    electronVersion: metadata.devDependencies.electron,
    appBundleId: "io.github.lavelliane.raphael",
    icon: path.join(root, "desktop/assets/Raphael.icns"),
    extraResource: resources,
    overwrite: true,
    prune: false,
    asar: true,
    extendInfo: {
      NSAudioCaptureUsageDescription:
        "Raphael transcribes system playback during a listening session.",
      NSMicrophoneUsageDescription:
        "Raphael can capture a selected loopback audio input.",
    },
  });
  for (const output of outputs) {
    const appPath = path.join(output, "Raphael.app");
    execFileSync(
      "/usr/bin/codesign",
      ["--force", "--deep", "--sign", "-", appPath],
      { stdio: "inherit" },
    );
    console.log(appPath);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
