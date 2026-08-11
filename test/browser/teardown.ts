// Putting a headless Chrome down, and taking its profile directory with it.
//
// This lives beside `cdp.ts` rather than inside it because `cdp.ts` is a frozen rail (T143) and
// teardown is not one of its assertions. The rail proves the doors work in a real browser; how the
// runner reclaims a scratch directory afterwards is hygiene, and hygiene that has needed four
// attempts belongs where it can be tuned without an authorization round.

import { spawnSync, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";

const onWindows = process.platform === "win32";

/**
 * Stop Chrome and everything it spawned.
 *
 * `child.kill()` reaches Chrome's BROWSER process alone. The renderer, GPU and `crashpad_handler`
 * processes are separate processes, and they outlive their parent by a short unbounded moment while
 * still holding handles inside the profile directory. So on Windows the pid is killed as a TREE:
 * `/T` takes the descendants, `/F` does not ask them to agree. This runs BEFORE the parent is
 * awaited, because a tree walk needs a live parent — `taskkill` refuses a pid that has already
 * exited, and the orphans it would have collected outlive the call.
 *
 * No shell, argv as an array. `taskkill` is safe to name bare: it is `taskkill.exe`, and Windows
 * appends `.exe` to an extensionless image name — the trap that bites `npx` (a `.cmd`, per
 * `scripts/patch-adlc-npx.mjs`) is not this one.
 */
export function killTree(child: ChildProcess): void {
  if (onWindows && child.pid !== undefined) {
    spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { stdio: "ignore" });
  }
  child.kill();
}

/**
 * Remove the throwaway profile, and on Windows never fail the rail over it.
 *
 * Windows refuses to remove a directory while any handle beneath it is open, so a straggling Chrome
 * child turns teardown into `EPERM ... rm '<profile>'` — raised on the profile ROOT, after its
 * contents are already gone. That flake failed CI five times (#362, #368, #375, #379, and one
 * before them), and ten retries at 200ms did not outlast it.
 *
 * `killTree` removes the cause. This is the second line of defence for the case where it does not:
 * the profile is scratch in the runner's own temp directory, it is measured in megabytes, and the
 * runner is discarded minutes later. A rail that proves a browser can log in must not go red
 * because Windows held a handle two seconds too long — so the leftover path is NAMED on stderr and
 * the run continues. Every other platform still throws: there, a failed removal is a real defect
 * with a real cause.
 */
export function dropProfile(userDataDir: string): void {
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (err) {
    if (!onWindows) throw err;
    console.warn(`could not remove the throwaway Chrome profile ${userDataDir}: ${String(err)}`);
  }
}
