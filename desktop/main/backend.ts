import { ChildProcessWithoutNullStreams, spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { createInterface } from "node:readline";

type Service = { origin: string; token: string };
export class Backend {
  private child?: ChildProcessWithoutNullStreams;
  private ready?: Promise<Service>;
  private stopping = false;

  constructor(
    private root: string,
    private packaged: boolean,
  ) {}

  private connect(): Promise<Service> {
    if (this.stopping) throw Error("Raphael is closing.");
    if (this.ready) return this.ready;
    this.ready = new Promise<Service>((resolve, reject) => {
      const pythonPath =
        process.platform === "win32" ? "Scripts/python.exe" : "bin/python";
      const python =
        process.env.RAPHAEL_PYTHON ||
        [
          path.join(this.root, ".venv", pythonPath),
          process.env.VIRTUAL_ENV &&
            path.join(process.env.VIRTUAL_ENV, pythonPath),
        ].find((p) => p && existsSync(p)) ||
        (process.platform === "win32" ? "python" : "python3");
      const binary = this.packaged
        ? path.join(process.resourcesPath, "raphael-engine", "raphael-engine")
        : python;
      const args = this.packaged
        ? []
        : [path.join(this.root, "desktop_service.py")];
      const toolDirs: string[] = this.packaged
        ? JSON.parse(
            readFileSync(path.join(this.root, "tool-dirs.json"), "utf8"),
          )
        : [];
      const env = {
        ...process.env,
        PYTHONUNBUFFERED: "1",
        PATH: [
          process.env.PATH,
          ...toolDirs,
          "/opt/homebrew/bin",
          "/usr/local/bin",
          path.join(homedir(), ".local", "bin"),
          path.join(homedir(), ".pyenv", "shims"),
        ]
          .filter(Boolean)
          .join(path.delimiter),
      };
      const child = spawn(binary, args, {
        cwd: this.packaged ? process.resourcesPath : this.root,
        env,
        detached: process.platform !== "win32",
      });
      this.child = child;
      // A child that exits during quit can close its pipe before stdin.end().
      child.stdin.on("error", () => {});
      child.once("exit", () => {
        // Clean up outstanding Codex/Whisper processes in our own process group.
        if (process.platform !== "win32" && child.pid) {
          try { process.kill(-child.pid, "SIGTERM"); } catch { /* Group already empty. */ }
        }
      });
      const lines = createInterface({ input: child.stdout });
      const timer = setTimeout(() => {
        reject(Error("The local engine took too long to start."));
        this.kill(child);
      }, 15000);
      let detail = "";
      child.stderr.on("data", (data) => {
        detail = (detail + data.toString()).slice(-1800);
        process.stderr.write(data);
      });
      lines.once("line", (line) => {
        clearTimeout(timer);
        try {
          const hello = JSON.parse(line);
          if (
            !Number.isInteger(hello.port) ||
            hello.port <= 0 ||
            hello.port > 65535 ||
            typeof hello.token !== "string" ||
            !hello.token
          )
            throw Error("Invalid engine handshake.");
          resolve({
            origin: "http://127.0.0.1:" + hello.port,
            token: hello.token,
          });
        } catch {
          reject(Error("The local engine could not start."));
          this.kill(child);
        }
      });
      child.once("error", (err) =>
        reject(
          Error(
            "Could not launch Raphael’s engine. Check the Python environment. " +
              err.message,
          ),
        ),
      );
      child.once("close", () => {
        clearTimeout(timer);
        lines.close();
        if (this.child === child) {
          this.child = undefined;
          this.ready = undefined;
        }
        reject(
          Error(
            detail.trim().split("\n").at(-1) || "The local engine stopped.",
          ),
        );
      });
    });
    return this.ready;
  }

  async request(route: string, data: unknown) {
    const { origin, token } = await this.connect();
    const response = await fetch(origin + "/api/" + route, {
      method: "POST",
      redirect: "error",
      headers: { "Content-Type": "application/json", "X-Raphael-Token": token },
      body: JSON.stringify(data),
      signal: AbortSignal.timeout(120000),
    });
    const result = (await response.json()) as { error?: string };
    if (!response.ok)
      throw Error(
        result.error || "The local engine could not complete that request.",
      );
    return result;
  }

  private kill(child: ChildProcessWithoutNullStreams) {
    try {
      if (process.platform !== "win32" && child.pid)
        process.kill(-child.pid, "SIGKILL");
      else child.kill("SIGKILL");
    } catch {
      /* Already exited. */
    }
  }

  async close() {
    this.stopping = true;
    const child = this.child;
    if (!child) return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(() => this.kill(child), 8000);
      child.once("close", () => {
        clearTimeout(timer);
        resolve();
      });
      child.stdin.end();
    });
  }
}
