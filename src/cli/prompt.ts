// Reading a secret from the terminal, with the echo off.
//
// It wants a TTY and says so rather than reading a password off a pipe by accident — a password that
// arrives through a shell is a password in the shell's history. `run()` takes a `readSecret` override
// for callers that have their own way of asking (and for the rails, which have no terminal at all).
//
// Raw mode is what turns the echo off, so every exit path must turn it back on: a process that leaves
// the terminal raw looks like a hung shell to whoever typed the command.

import { createInterface } from "node:readline";

const CTRL_C = "";
const CTRL_D = "";
const ERASERS = new Set(["", ""]); // backspace and delete, as terminals send them

// Reading an answer in the open, echo on — the guided init's name prompt. The same terminal
// requirement as promptSecret, for the same reason: an answer read off a pipe by accident is not
// an answer anyone gave. `run()` takes a `readInput` override for callers with their own way of
// asking.
export function promptLine(prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    if (process.stdin.isTTY !== true) {
      reject(
        new Error(
          "a prompt wants a terminal — run this command interactively, " +
            "or drive it through the library's `readInput` option",
        ),
      );
      return;
    }
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    // Ctrl-D closes the interface without ever invoking the question callback, and Ctrl-C is
    // readline's own SIGINT event — either would leave this promise unsettled, and an unsettled
    // prompt is a process that exits 0 having done half its work. Both reject instead; `run()`
    // turns the rejection into exit 1.
    let settled = false;
    const finish = (answer?: string): void => {
      if (settled) return;
      settled = true;
      rl.close();
      if (answer === undefined) reject(new Error("cancelled"));
      else resolve(answer.trim());
    };
    rl.on("close", () => finish());
    rl.on("SIGINT", () => finish());
    rl.question(prompt, (answer) => finish(answer));
  });
}

export function promptSecret(prompt: string): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const input = process.stdin;
    if (input.isTTY !== true) {
      reject(
        new Error(
          "a password prompt wants a terminal — run this command interactively, " +
            "or drive it through the library's `readSecret` option",
        ),
      );
      return;
    }
    process.stdout.write(prompt);
    let secret = "";
    const onData = (chunk: string): void => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n") {
          finish();
          return;
        }
        if (character === CTRL_C || character === CTRL_D) {
          finish(new Error("cancelled"));
          return;
        }
        if (ERASERS.has(character)) {
          secret = secret.slice(0, -1);
          continue;
        }
        secret += character;
      }
    };
    const finish = (err?: Error): void => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      if (err !== undefined) reject(err);
      else resolve(secret);
    };
    input.setEncoding("utf8");
    input.setRawMode(true);
    input.resume();
    input.on("data", onData);
  });
}
