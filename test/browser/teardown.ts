import { spawnSync, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";

const onWindows = process.platform === "win32";

const HELD_OPEN = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);

let notes: string[] = [];

export function killTree(child: ChildProcess): void {
  notes = [];
  if (onWindows) {
    if (child.exitCode !== null || child.signalCode !== null) {
      notes.push(
        "Chrome's browser process had already exited, so any orphan it left was out of taskkill's reach",
      );
    } else if (child.pid === undefined) {
      notes.push("Chrome had no pid to kill");
    } else {
      const done = spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
        stdio: "ignore",
        timeout: 10_000,
      });
      if (done.error !== undefined) notes.push(`taskkill did not run: ${done.error.message}`);
      else if (done.status !== 0) notes.push(`taskkill exited ${String(done.status)}`);
    }
  }
  child.once("error", (err) => {
    notes.push(`kill() raised ${err.message}`);
  });
  child.kill();
}

export function dropProfile(userDataDir: string): void {
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (err) {
    if (!onWindows) throw err;
    const code = (err as NodeJS.ErrnoException).code ?? "";
    if (!HELD_OPEN.has(code)) throw err;
    console.warn(
      [`Windows still holds the throwaway Chrome profile ${userDataDir} (${code})`, ...notes].join(
        " — ",
      ),
    );
  }
}
