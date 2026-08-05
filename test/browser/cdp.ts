// A minimal Chrome-DevTools-Protocol driver for the door-smoke rail — no npm dependency, just
// Chrome's own debugging endpoint over Node's built-in WebSocket. T143 exists because no rail
// drove a real browser; this helper is deliberately small enough to keep that rail cheap.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";

/**
 * Find a Chrome to drive, or THROW — never skip. A skipped browser rail is exactly the hole that
 * shipped T143: every hand-built fixture stayed green while no real browser could log in.
 */
export function resolveChrome(): string {
  const named = process.env["LOAM_CHROME"] ?? process.env["CHROME_BIN"];
  if (named !== undefined && named !== "") return named;
  const names =
    process.platform === "win32"
      ? ["chrome.exe"]
      : ["google-chrome", "google-chrome-stable", "chromium", "chromium-browser"];
  for (const dir of (process.env["PATH"] ?? "").split(delimiter)) {
    if (dir === "") continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (existsSync(candidate)) return candidate;
    }
  }
  for (const candidate of [
    "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
    "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
    join(process.env["LOCALAPPDATA"] ?? "C:\\", "Google", "Chrome", "Application", "chrome.exe"),
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ]) {
    if (existsSync(candidate)) return candidate;
  }
  throw new Error(
    "the browser rail needs a real Chrome and found none — it fails rather than skips, because " +
      "a skipped browser rail is how T143 shipped. Install Chrome, or set LOAM_CHROME to a " +
      "Chrome/Chromium binary.",
  );
}

const DEADLINE_MS = 30_000;

const withDeadline = <T>(promise: Promise<T>, what: string): Promise<T> => {
  let timer: NodeJS.Timeout;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`timed out after ${DEADLINE_MS}ms: ${what}`)), DEADLINE_MS);
      timer.unref();
    }),
  ]);
};

interface CdpMessage {
  readonly id?: number;
  readonly method?: string;
  readonly params?: unknown;
  readonly result?: unknown;
  readonly error?: { message: string };
}

/** One page, one WebSocket. Register a `loaded()` waiter BEFORE the action that navigates. */
export class Tab {
  private readonly ws: WebSocket;
  private nextId = 1;
  private readonly pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private readonly eventWaiters = new Map<string, ((params: unknown) => void)[]>();

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.addEventListener("message", (event) => {
      const msg = JSON.parse(String(event.data)) as CdpMessage;
      if (msg.id !== undefined) {
        const waiter = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        if (waiter === undefined) return;
        if (msg.error !== undefined) waiter.reject(new Error(msg.error.message));
        else waiter.resolve(msg.result);
        return;
      }
      if (msg.method !== undefined) {
        const waiters = this.eventWaiters.get(msg.method) ?? [];
        this.eventWaiters.delete(msg.method);
        for (const waiter of waiters) waiter(msg.params);
      }
    });
  }

  static async open(wsUrl: string): Promise<Tab> {
    const ws = new WebSocket(wsUrl);
    await withDeadline(
      new Promise<void>((resolve, reject) => {
        ws.addEventListener("open", () => resolve(), { once: true });
        ws.addEventListener("error", () => reject(new Error(`could not open ${wsUrl}`)), { once: true });
      }),
      "opening the CDP socket",
    );
    const tab = new Tab(ws);
    await tab.send("Page.enable");
    await tab.send("Runtime.enable");
    return tab;
  }

  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.nextId++;
    const sent = new Promise<unknown>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params }));
    });
    return withDeadline(sent, method);
  }

  /** The NEXT Page.loadEventFired. Await the returned promise after triggering the navigation. */
  loaded(): Promise<void> {
    return withDeadline(
      new Promise<void>((resolve) => {
        const list = this.eventWaiters.get("Page.loadEventFired") ?? [];
        list.push(() => resolve());
        this.eventWaiters.set("Page.loadEventFired", list);
      }),
      "waiting for a page load",
    );
  }

  async navigate(url: string): Promise<void> {
    const done = this.loaded();
    await this.send("Page.navigate", { url });
    await done;
  }

  /** Evaluate an expression in the page and return its JSON value. */
  async eval(expression: string): Promise<unknown> {
    const result = (await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise: true,
    })) as { result: { value?: unknown }; exceptionDetails?: { text: string } };
    if (result.exceptionDetails !== undefined) {
      throw new Error(`page threw: ${result.exceptionDetails.text} — in: ${expression}`);
    }
    return result.result.value;
  }

  close(): void {
    this.ws.close();
  }
}

/** A headless Chrome with its own throwaway profile; every tab it opens shares that profile. */
export class Browser {
  private constructor(
    private readonly child: ChildProcess,
    private readonly userDataDir: string,
    private readonly port: number,
  ) {}

  static async launch(): Promise<Browser> {
    const chrome = resolveChrome();
    const userDataDir = mkdtempSync(join(tmpdir(), "loam-door-smoke-"));
    const child = spawn(
      chrome,
      [
        "--headless=new",
        "--remote-debugging-port=0",
        `--user-data-dir=${userDataDir}`,
        "--no-first-run",
        "--no-default-browser-check",
        "--disable-gpu",
        "--disable-extensions",
        "--disable-dev-shm-usage",
        "--no-sandbox", // CI containers have no usable namespace sandbox; this profile only ever visits loopback
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    // Chrome announces its picked port by writing DevToolsActivePort into the profile dir.
    const portFile = join(userDataDir, "DevToolsActivePort");
    const deadline = Date.now() + DEADLINE_MS;
    let port: number | undefined;
    while (port === undefined) {
      if (child.exitCode !== null) throw new Error(`Chrome exited ${child.exitCode} before serving CDP`);
      if (Date.now() > deadline) throw new Error("Chrome never wrote DevToolsActivePort");
      try {
        const first = readFileSync(portFile, "utf8").split("\n")[0] ?? "";
        if (first !== "") port = Number(first);
      } catch {
        // not written yet
      }
      if (port === undefined) await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return new Browser(child, userDataDir, port);
  }

  /** Open a fresh tab (same profile, same cookie jar) and attach to it. */
  async tab(url = "about:blank"): Promise<Tab> {
    const endpoint = `http://127.0.0.1:${this.port}/json/new?${new URLSearchParams({ url })}`;
    // Modern Chrome wants PUT here; older builds answered GET. Try both rather than pin a version.
    let res = await fetch(endpoint, { method: "PUT" });
    if (!res.ok) res = await fetch(endpoint);
    if (!res.ok) throw new Error(`/json/new answered ${res.status}`);
    const target = (await res.json()) as { webSocketDebuggerUrl: string };
    return Tab.open(target.webSocketDebuggerUrl);
  }

  async close(): Promise<void> {
    this.child.kill();
    await new Promise((resolve) => setTimeout(resolve, 200));
    rmSync(this.userDataDir, { recursive: true, force: true });
  }
}
