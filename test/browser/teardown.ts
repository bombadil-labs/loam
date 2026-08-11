// Putting a headless Chrome down, and taking its profile directory with it.
//
// This lives beside `cdp.ts` rather than inside it because `cdp.ts` is a frozen rail (T143) and
// teardown is not one of its assertions. The rail proves the doors work in a real browser; how the
// runner reclaims a scratch directory afterwards is hygiene, and hygiene that has needed four
// attempts belongs where it can be tuned without an authorization round. `teardown.test.ts` rails
// what a POSIX runner can reach.

import { spawnSync, type ChildProcess } from "node:child_process";
import { rmSync } from "node:fs";

const onWindows = process.platform === "win32";

// The removal failures a straggling handle explains, and nothing else. `force: true` already
// absorbs ENOENT and node's own rimraf already retries these three, so what reaches the catch is a
// race that outlasted ten retries. Any OTHER code is a real defect — a wrong path, a bad
// permission — and still throws, on every platform.
const HELD_OPEN = new Set(["EPERM", "EBUSY", "ENOTEMPTY"]);

// What `killTree` learned, for `dropProfile` to say out loud if the removal then fails. Without it
// a swallowed failure reports WHICH directory survived and never WHY, and the next reader gets a
// warning that cannot tell them anything — H7's shape in a teardown path.
let notes: string[] = [];

/**
 * Stop Chrome. On Windows, stop everything it spawned as well.
 *
 * `child.kill()` reaches Chrome's BROWSER process alone. The renderer, GPU and `crashpad_handler`
 * processes are separate processes, and they outlive their parent by a short unbounded moment while
 * still holding handles inside the profile directory. On Windows that is fatal to the removal, so
 * the pid is killed as a TREE: `/T` takes the descendants, `/F` does not ask them to agree. This
 * runs BEFORE the parent is awaited, because a tree walk needs a live parent — `taskkill` refuses a
 * pid that has already exited, and the orphans it would have collected outlive the call. When the
 * parent IS already gone, nothing here can reach them; the note says so rather than implying a
 * sweep that did not happen.
 *
 * On POSIX this is one SIGTERM to the browser process and nothing more. Chrome reaps its own
 * children there, and the Linux and macOS legs have never failed this way — so the tree kill is the
 * Windows branch, not the general behaviour of this function.
 *
 * No shell, argv as an array. `taskkill` is safe to name bare: it is `taskkill.exe`, and Windows
 * appends `.exe` to an extensionless image name — the trap that bites `npx` (a `.cmd`, per
 * `scripts/patch-adlc-npx.mjs`) is not this one.
 */
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
      // A hung taskkill would otherwise burn the whole 20s hook budget and read as a hung suite.
      const done = spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], {
        stdio: "ignore",
        timeout: 10_000,
      });
      if (done.error !== undefined) notes.push(`taskkill did not run: ${done.error.message}`);
      else if (done.status !== 0) notes.push(`taskkill exited ${String(done.status)}`);
    }
  }
  // `kill()` EMITS rather than throws, and a process caught mid-termination can answer EACCES
  // instead of ESRCH. With no listener that becomes an uncaught exception out of afterAll.
  child.once("error", (err) => {
    notes.push(`kill() raised ${err.message}`);
  });
  child.kill();
}

/**
 * Remove the throwaway profile, and on Windows never fail the rail over a handle.
 *
 * Windows refuses to remove a directory while any handle beneath it is open, so a straggling Chrome
 * child turns teardown into `EPERM ... rm '<profile>'` — raised on the profile ROOT, after its
 * contents are already gone. That flake failed CI five times (#362, #368, #375, #379, and one
 * before them), and ten retries at 200ms did not outlast it.
 *
 * `killTree` removes the cause. This is the second line of defence for the case where it does not:
 * the profile is scratch in the runner's own temp directory, it is measured in megabytes, and the
 * runner is discarded minutes later. A rail that proves a browser can log in must not go red
 * because Windows held a handle two seconds too long — so the leftover path is NAMED on stderr,
 * with whatever `killTree` learned about why, and the run continues.
 *
 * The swallow is narrow in both directions. Only the three codes a held handle produces are
 * swallowed, and only on Windows. Every other code, and every other platform, still throws — there,
 * a failed removal is a real defect with a real cause.
 */
export function dropProfile(userDataDir: string): void {
  try {
    rmSync(userDataDir, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch (err) {
    // Two refusals, deliberately separate rather than one `||`: the platform half is reachable
    // from any POSIX runner and `teardown.test.ts` rails it, and only the code half is Windows-only.
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
