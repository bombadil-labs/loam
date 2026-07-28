// Reading a secret from the terminal, with the echo off.
//
// It wants a TTY and says so rather than reading a password off a pipe by accident — a password that
// arrives through a shell is a password in the shell's history. `run()` takes a `readSecret` override
// for callers that have their own way of asking (and for the rails, which have no terminal at all).
//
// Raw mode is what turns the echo off, so every exit path must turn it back on: a process that leaves
// the terminal raw looks like a hung shell to whoever typed the command.

const CTRL_C = "";
const CTRL_D = "";
const ERASERS = new Set(["", ""]); // backspace and delete, as terminals send them

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
