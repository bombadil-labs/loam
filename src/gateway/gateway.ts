// The Gateway: one live front over one StoreBackend. It boots by replaying the store into a
// Reactor, writes every accepted delta through to the backend by way of the raw stream (so a
// future DerivationHost's emissions persist by the same path as appends), meta-resolves
// schema-defining deltas via SCHEMA_SCHEMA, and serves GraphQL derived from what is registered.
//
// The reactor is the living present tense; the backend is the ground it grows from and settles
// back into. Nothing is reachable except through what a registered (HyperSchema, Policy) pair
// exposes.

import {
  Reactor,
  SchemaRegistry,
  computeId,
  loadSchema,
  verifyDelta,
  type Delta,
  type HView,
  type HyperSchema,
  type Policy,
} from "@bombadil/rhizomatic";
import { graphql, type GraphQLSchema } from "graphql";
import type { StoreBackend } from "../store/backend.js";
import { buildGqlSchema, type Registered } from "./gql.js";

export interface AppendReceipt {
  readonly accepted: number;
  readonly duplicates: number;
}

export interface QueryResult {
  data?: Record<string, unknown> | null;
  errors?: string[];
}

const toError = (e: unknown): Error => (e instanceof Error ? e : new Error(String(e)));

export class Gateway {
  private readonly registered: Registered[] = [];
  private registry = SchemaRegistry.build([]);
  private gql: GraphQLSchema | undefined;
  // The write-through queue: raw-stream deltas append to the backend in arrival order. The
  // chain itself always resolves (later writes are still attempted); the FIRST failure latches
  // in `writeFailure`, and from then on the gateway is degraded: append refuses new work
  // before ingesting it, and flush/close surface the failure. A gateway that cannot persist
  // must not quietly widen the gap between the live view and the ground.
  private writes: Promise<void> = Promise.resolve();
  private writeFailure: Error | undefined;

  private constructor(
    private readonly backend: StoreBackend,
    readonly reactor: Reactor,
  ) {
    reactor.subscribeRaw((d) => {
      this.writes = this.writes
        .then(() => this.backend.append([d]))
        .then(
          () => {},
          (err: unknown) => {
            this.writeFailure ??= toError(err);
          },
        );
    });
  }

  // Open a gateway over a backend: replay everything the store holds, then start listening.
  // The raw subscription attaches AFTER replay, so boot never writes the store back to itself.
  static async open(backend: StoreBackend): Promise<Gateway> {
    const reactor = new Reactor();
    for (const d of await backend.deltasSince(new Set())) {
      const result = reactor.ingest(d);
      if (result.status === "rejected") {
        throw new Error(`replay: the store handed back an unacceptable delta ${d.id}`);
      }
    }
    return new Gateway(backend, reactor);
  }

  // Ingest a batch and write it through. The batch is validated WHOLE before anything is
  // ingested — one bad delta refuses the lot, so a caller never lands half a write.
  async append(deltas: Iterable<Delta>): Promise<AppendReceipt> {
    if (this.writeFailure !== undefined) {
      throw new Error(`this gateway can no longer persist: ${this.writeFailure.message}`);
    }
    const batch = [...deltas];
    for (const d of batch) {
      if (computeId(d.claims) !== d.id || verifyDelta(d) === "invalid") {
        throw new Error(`append rejected: delta ${d.id} is not what it claims to be`);
      }
    }
    let accepted = 0;
    let duplicates = 0;
    for (const d of batch) {
      const result = this.reactor.ingest(d);
      if (result.status === "accepted") accepted += 1;
      else duplicates += 1; // "rejected" is unreachable: the batch was validated above
    }
    await this.flush();
    return { accepted, duplicates };
  }

  // Meta-resolve schema-defining deltas via SCHEMA_SCHEMA into a HyperSchema. The definition is
  // proven against a TRIAL set first — the store is append-only, so nothing lands until the
  // deltas are known to define what the caller says they define.
  async loadSchema(deltas: Iterable<Delta>, entity: string): Promise<HyperSchema> {
    const batch = [...deltas];
    const trial = this.reactor.snapshot();
    for (const d of batch) trial.add(d);
    const schema = loadSchema(trial, entity); // throws here → nothing was persisted
    await this.append(batch);
    return schema;
  }

  // Register a (HyperSchema, Policy) pair over the given roots: a live materialization per
  // root, and a GraphQL surface rebuilt to include it. Everything that can refuse — duplicate
  // names, unresolved refs, GraphQL field collisions — refuses BEFORE any state changes, so a
  // failed registration leaves the gateway exactly as it was. Register dependencies first:
  // earlier schemas are visible to later refs.
  register(schema: HyperSchema, policy: Policy, roots: readonly string[]): void {
    const next = [...this.registered, { schema, policy, roots }];
    const registry = SchemaRegistry.build(next.map((r) => r.schema)); // refuses dups + bad refs
    const gql = buildGqlSchema(next, (name, root) => this.gather(name, root)); // refuses collisions
    this.reactor.register(schema.name, schema.body, roots, registry);
    this.registered.push({ schema, policy, roots });
    this.registry = registry;
    this.gql = gql;
  }

  // The read seam GraphQL resolves through: the live materialization when the root is watched,
  // batch evaluation otherwise — the spike proved the two are identical.
  private gather(name: string, root: string): HView {
    const live = this.reactor.materializedView(name, root);
    if (live !== undefined) return live;
    const def = this.registered.find((r) => r.schema.name === name);
    if (def === undefined) throw new Error(`no registered schema named ${name}`);
    const result = this.reactor.eval(def.schema.body, root, this.registry);
    if (result.sort !== "hview") throw new Error(`schema ${name} does not evaluate to a hyperview`);
    return result.hview;
  }

  async query(source: string, variables?: Record<string, unknown>): Promise<QueryResult> {
    if (this.gql === undefined) {
      throw new Error("nothing is registered: the gateway has no queryable surface yet");
    }
    const result = await graphql({
      schema: this.gql,
      source,
      ...(variables === undefined ? {} : { variableValues: variables }),
    });
    return {
      ...(result.data === undefined ? {} : { data: result.data }),
      ...(result.errors === undefined ? {} : { errors: result.errors.map((e) => e.message) }),
    };
  }

  // Await every write the raw stream has queued; surface the first write-through failure.
  async flush(): Promise<void> {
    await this.writes;
    if (this.writeFailure !== undefined) {
      throw new Error(`write-through failed: ${this.writeFailure.message}`);
    }
  }

  // Close always releases the backend, even when a latched write failure has to be surfaced.
  async close(): Promise<void> {
    try {
      await this.flush();
    } finally {
      await this.backend.close();
    }
  }
}
