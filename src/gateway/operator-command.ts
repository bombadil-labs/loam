// Operator-local command trial. This is not a bound-user or remote serving door.
import {
  CommandEndpoint,
  commandDescriptionClaims,
  encodeBindings,
  readConfiguration,
  readOperation,
  readCommandResult,
  serializeCommandDelta,
  VOCAB_PREFIX,
  type Delta,
  type Primitive,
  type Target,
} from "@bombadil/rhizomatic";
import type { Gateway } from "./gateway.js";
import { admitting, catchUp, preflightAppend } from "./ingest.js";
import { readClosedIds } from "./slate-law.js";
import { RESERVED_CTX_PREFIX, RESERVED_ID_PREFIX } from "./repair.js";

export interface CommandInstallation {
  readonly configuration: Delta;
  readonly declarations: readonly Delta[];
}
export type OperatorCommand =
  | { readonly kind: "retain"; readonly expectedHead: string; readonly payload: readonly Delta[] }
  | {
      readonly kind: "evaluate";
      readonly expectedHead: string;
      readonly at: number;
      readonly root: string;
      readonly hyperschema: Delta;
      readonly schema: Delta;
      readonly hyperschemaPin: string;
      readonly schemaPin: string;
      readonly definitions: readonly Delta[];
      readonly bindings: Readonly<Record<string, Primitive>>;
    };
export interface OperatorCommandResult {
  readonly request: Delta;
  readonly outcome: Delta;
  readonly result: ReturnType<typeof readCommandResult>;
}
const text = (value: string): readonly Target[] => [{ kind: "primitive", value }];
const ref = (delta: string): readonly Target[] => [{ kind: "delta", deltaRef: { delta } }];
const entity = (id: string): readonly Target[] => [{ kind: "entity", entity: { id } }];

function requireFacts(batch: readonly Delta[]): void {
  for (const delta of batch) {
    for (const { role, target } of delta.claims.pointers) {
      // Even an otherwise ordinary negation could retire law. Program acts and manifests
      // belong to their existing services, which own their activation and provenance.
      if (
        ["negates", "defines", "manifest", "erases"].includes(role) ||
        role.startsWith(`${VOCAB_PREFIX}.txn.`) ||
        role.startsWith(`${VOCAB_PREFIX}.hyperschema.`) ||
        role.startsWith(`${VOCAB_PREFIX}.schema.`)
      )
        throw new Error(`command fact import refuses control role ${role}`);
      if (
        (target.kind === "entity" &&
          (target.entity.id.startsWith(RESERVED_ID_PREFIX) ||
            target.entity.context === "definition" ||
            target.entity.context?.startsWith(RESERVED_CTX_PREFIX))) ||
        (target.kind === "delta" && target.deltaRef.context?.startsWith(RESERVED_CTX_PREFIX))
      )
        throw new Error("command fact import refuses reserved Loam law references");
    }
  }
}

/** Opens only over an already operated, journal-backed Gateway. No seed retrieval is needed. */
export async function openOperatorCommands(gw: Gateway, installation: CommandInstallation) {
  const signer =
    gw.signer === undefined
      ? undefined
      : { author: gw.signer.author, sign: gw.signer.sign.bind(gw.signer) };
  const peer = gw.peer;
  if (signer === undefined || peer === undefined || peer.journal.peerId !== signer.author)
    throw new Error("operator commands require this gateway's own-key peer and signer");
  const stable = structuredClone(installation);
  const config = readConfiguration(stable.configuration);
  if (
    config.caller?.length !== 1 ||
    config.caller[0]?.kind !== "primitive" ||
    config.caller[0].value !== signer.author
  )
    throw new Error("operator command installation must name only this operator as caller");
  const operations = new Map(stable.declarations.map((d) => [readOperation(d), d.id]));
  let receivedAt = gw.now();
  const endpoint = await CommandEndpoint.boot({
    configuration: stable.configuration,
    declarations: stable.declarations,
    signer,
    store: peer.store,
    clock: () => receivedAt,
    diagnostic: (fault) => {
      throw new Error("operator command store fault", { cause: fault });
    },
  });
  return {
    /** A current head is an observation; the caller must put the chosen head in each request. */
    async head(): Promise<string> {
      const read = await peer.store.readHead(signer.author);
      if (read.status !== "head") throw new Error("operator command head unavailable");
      return read.head;
    },
    async run(input: OperatorCommand): Promise<OperatorCommandResult> {
      const command = structuredClone(input);
      if (
        !command ||
        !["retain", "evaluate"].includes(command.kind) ||
        typeof command.expectedHead !== "string"
      )
        throw new Error(
          "operator commands require a retain/evaluate request and explicit expectedHead",
        );
      return admitting(gw, async () => {
        receivedAt = gw.now();
        const fields: Record<string, readonly Target[]> = {
          receiver: entity(signer.author),
          configuration: ref(stable.configuration.id),
          operation: ref(operations.get(command.kind)!),
          "expected-head": text(command.expectedHead),
        };
        const support: Delta[] = [];
        if (command.kind === "retain") {
          fields.payload = [...new Set(command.payload.map((d) => d.id))].flatMap(ref);
          support.push(...command.payload);
        } else {
          Object.assign(fields, {
            source: text("admitted"),
            interpretation: text("core/1"),
            at: [{ kind: "primitive", value: command.at }],
            root: entity(command.root),
            hyperschema: ref(command.hyperschema.id),
            schema: ref(command.schema.id),
            "hyperschema-pin": text(command.hyperschemaPin),
            "schema-pin": text(command.schemaPin),
            definition: command.definitions.flatMap((d) => ref(d.id)),
            bindings: [
              { kind: "bytes", mime: "application/cbor", value: encodeBindings(command.bindings) },
            ],
          });
          support.push(command.hyperschema, command.schema, ...command.definitions);
        }
        const request = signer.sign(
          commandDescriptionClaims(signer.author, receivedAt, "request/1", fields),
        );
        const head = await peer.store.readHead(signer.author);
        // Never evaluate guards against a stale reactor. A moved head reaches the command
        // endpoint with the caller's original expectation and produces its signed refusal.
        if (
          head.status === "head" &&
          head.head === command.expectedHead &&
          head.head === peer.journal.currentHead() &&
          !gw.needsJournalRefresh &&
          gw.reseating === undefined
        ) {
          if (command.kind === "retain") {
            requireFacts(command.payload);
            preflightAppend(gw, command.payload, receivedAt);
          } else if (readClosedIds(gw, receivedAt).size > 0) {
            throw new Error(
              "operator command evaluation unavailable while read closures are active",
            );
          }
        } else if (head.status === "head" && head.head === command.expectedHead) {
          // This gateway may have committed a native emission while readHead was in flight.
          // Keep the chosen expectation and let the endpoint sign the conflict in that case.
          const current = await peer.store.readHead(signer.author);
          if (current.status === "head" && current.head === command.expectedHead)
            throw new Error(
              "operator command gateway is stale; refresh before choosing a new head",
            );
        }
        const outcome = await endpoint.invoke(
          request.id,
          [request, ...support].map(serializeCommandDelta),
        );
        const result = readCommandResult(
          outcome,
          {
            receiver: signer.author,
            configuration: stable.configuration.id,
            request: request.id,
          },
          request,
        );
        if (command.kind === "retain" && result.status === "completed") await catchUp(gw);
        return { request, outcome, result };
      });
    },
  };
}
