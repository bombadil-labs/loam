// A local operator invocation. Signed catalog files remain explicit inputs.
import { readFileSync } from "node:fs";
import { parseCommandDelta, serializeCommandDelta, type Primitive } from "@bombadil/rhizomatic";
import { Gateway } from "../gateway/gateway.js";
import { openOperatorCommands, type OperatorCommand } from "../gateway/operator-command.js";
import { SqliteBackend } from "../store/sqlite.js";
import { readSeed } from "./config.js";
import { UsageError } from "./args.js";
import type { IO } from "./cli.js";

const record = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new UsageError("command input requires an object");
  return value as Record<string, unknown>;
};
const list = (value: unknown) => {
  if (!Array.isArray(value)) throw new UsageError("command support requires an explicit array");
  return value.map(parseCommandDelta);
};
const string = (value: unknown): string => {
  if (typeof value !== "string") throw new UsageError("command field requires a string");
  return value;
};
function job(value: unknown): OperatorCommand {
  const input = record(value);
  const allowed =
    input.kind === "retain"
      ? ["kind", "expectedHead", "payload"]
      : [
          "kind",
          "expectedHead",
          "at",
          "root",
          "hyperschema",
          "schema",
          "hyperschemaPin",
          "schemaPin",
          "definitions",
          "bindings",
        ];
  if (Object.keys(input).some((k) => !allowed.includes(k)))
    throw new UsageError(
      "command contains an unknown field; remote and bound modes are unavailable",
    );
  const expectedHead = string(input.expectedHead);
  if (input.kind === "retain")
    return { kind: "retain", expectedHead, payload: list(input.payload) };
  if (input.kind !== "evaluate" || typeof input.at !== "number" || !Number.isFinite(input.at))
    throw new UsageError("command requires retain or finite-time evaluate");
  const bindings = record(input.bindings);
  if (
    Object.values(bindings).some(
      (v) =>
        !["string", "number", "boolean"].includes(typeof v) ||
        (typeof v === "number" && !Number.isFinite(v)),
    )
  )
    throw new UsageError("command bindings require finite primitive values");
  return {
    kind: "evaluate",
    expectedHead,
    at: input.at,
    root: string(input.root),
    hyperschema: parseCommandDelta(input.hyperschema),
    schema: parseCommandDelta(input.schema),
    hyperschemaPin: string(input.hyperschemaPin),
    schemaPin: string(input.schemaPin),
    definitions: list(input.definitions),
    bindings: bindings as Record<string, Primitive>,
  };
}
export async function runOperatorCommand(
  options: { home: string; store: string; installation: string; request: string },
  io: IO,
): Promise<number> {
  const input = job(JSON.parse(readFileSync(options.request, "utf8")) as unknown);
  const installation = record(JSON.parse(readFileSync(options.installation, "utf8")) as unknown);
  if (Object.keys(installation).some((k) => !["configuration", "declarations"].includes(k)))
    throw new UsageError("installation requires only signed configuration and declarations");
  const gateway = await Gateway.open(new SqliteBackend(options.store), {
    seed: readSeed(options.home),
  });
  try {
    const service = await openOperatorCommands(gateway, {
      configuration: parseCommandDelta(installation.configuration),
      declarations: list(installation.declarations),
    });
    const result = await service.run(input);
    io.out(
      JSON.stringify({
        request: serializeCommandDelta(result.request),
        outcome: serializeCommandDelta(result.outcome),
        status: result.result.status,
        ...(result.result.view === undefined ? {} : { view: result.result.view }),
      }),
    );
    return result.result.status === "completed" ? 0 : 1;
  } finally {
    await gateway.close();
  }
}
