import { createInterface } from "node:readline";

const CTRL_C = "";
const CTRL_D = "";
const ERASERS = new Set(["", ""]);

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
