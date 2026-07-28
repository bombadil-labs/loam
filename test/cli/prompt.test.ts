// `promptSecret` (§36 phase 3, T124), tested directly against a fake TTY — every other rail in
// this ticket injects `readSecret` and never exercises this file at all, so without this it would
// ship with zero coverage of its own echo-off, backspace and cancel handling.

import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { promptSecret } from "../../src/cli/prompt.js";

// Named rather than embedded literally, so a reviewer sees what each byte is (`prompt.ts` mirrors
// these as its own private constants — this file cannot import them, so the values are repeated).
const BACKSPACE = String.fromCharCode(0x08);
const DELETE = String.fromCharCode(0x7f);
const CTRL_C = String.fromCharCode(0x03);
const CTRL_D = String.fromCharCode(0x04);

class FakeTTY extends EventEmitter {
  isTTY = true;
  rawModeCalls: boolean[] = [];
  paused = false;
  setRawMode(on: boolean): void {
    this.rawModeCalls.push(on);
  }
  setEncoding(): void {}
  resume(): void {
    this.paused = false;
  }
  pause(): void {
    this.paused = true;
  }
}

let originalStdin: typeof process.stdin;
let originalWrite: typeof process.stdout.write;
let written: string[];

function useFakeStdin(): FakeTTY {
  const fake = new FakeTTY();
  Object.defineProperty(process, "stdin", { value: fake, configurable: true });
  return fake;
}

beforeEach(() => {
  originalStdin = process.stdin;
  originalWrite = process.stdout.write.bind(process.stdout);
});
afterEach(() => {
  Object.defineProperty(process, "stdin", { value: originalStdin, configurable: true });
  process.stdout.write = originalWrite;
});

describe("promptSecret", () => {
  it("rejects immediately on a non-TTY stdin, without prompting", async () => {
    const fake = new (class extends EventEmitter {
      isTTY = false;
    })();
    Object.defineProperty(process, "stdin", { value: fake, configurable: true });
    written = [];
    process.stdout.write = (s: string) => {
      written.push(s);
      return true;
    };
    await expect(promptSecret("password: ")).rejects.toThrow(/wants a terminal/);
    expect(written).toEqual([]); // never even printed the prompt
  });

  it("resolves the typed characters on Enter, and turns raw mode back off", async () => {
    const fake = useFakeStdin();
    const promise = promptSecret("password: ");
    for (const ch of "hunter2") fake.emit("data", ch);
    fake.emit("data", "\r");
    await expect(promise).resolves.toBe("hunter2");
    expect(fake.rawModeCalls).toEqual([true, false]);
    expect(fake.paused).toBe(true); // finish() pauses the stream
  });

  it("a backspace erases exactly the last character, not the whole buffer", async () => {
    const fake = useFakeStdin();
    const promise = promptSecret("password: ");
    for (const ch of "abc") fake.emit("data", ch);
    fake.emit("data", BACKSPACE);
    fake.emit("data", "d");
    fake.emit("data", "\n");
    await expect(promise).resolves.toBe("abd");
  });

  // Both erasers name a DIFFERENT byte a terminal can send for the same key — a rail
  // exercising only one cannot see a set narrowed to the other.
  it("delete (the second eraser byte) also erases the last character", async () => {
    const fake = useFakeStdin();
    const promise = promptSecret("password: ");
    for (const ch of "xyz") fake.emit("data", ch);
    fake.emit("data", DELETE);
    fake.emit("data", "\n");
    await expect(promise).resolves.toBe("xy");
  });

  it("Ctrl+C rejects with 'cancelled' and still turns raw mode back off", async () => {
    const fake = useFakeStdin();
    const promise = promptSecret("password: ");
    fake.emit("data", "partial");
    fake.emit("data", CTRL_C);
    await expect(promise).rejects.toThrow(/cancelled/);
    expect(fake.rawModeCalls).toEqual([true, false]);
  });

  it("Ctrl+D also cancels", async () => {
    const fake = useFakeStdin();
    const promise = promptSecret("password: ");
    fake.emit("data", CTRL_D);
    await expect(promise).rejects.toThrow(/cancelled/);
  });

  it("an empty answer (Enter with nothing typed) resolves to an empty string", async () => {
    const fake = useFakeStdin();
    const promise = promptSecret("password: ");
    fake.emit("data", "\n");
    await expect(promise).resolves.toBe("");
  });
});
