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

export class Gateway {
  private readonly registered: Registered[] = [];
  private gql: GraphQLSchema | undefined;
  // The write-through queue: raw-stream deltas append to the backend in arrival order. A failed
  // write leaves the chain rejected, so the next flush (and every one after) surfaces it —
  // a gateway that cannot persist must not pretend it can.
  private writes: Promise<unknown> = Promise.resolve();

  private constructor(
    private readonly backend: StoreBackend,
    readonly reactor: Reactor,
  ) {
    reactor.subscribeRaw((d) => {
      this.writes = this.writes.then(() => this.backend.append([d]));
      this.writes.catch(() => {}); // surfaced at flush; never an unhandled rejection
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

  // Append schema-defining deltas and meta-resolve them via SCHEMA_SCHEMA into a HyperSchema.
  async loadSchema(deltas: Iterable<Delta>, entity: string): Promise<HyperSchema> {
    await this.append(deltas);
    return loadSchema(this.reactor.snapshot(), entity);
  }

  // Register a (HyperSchema, Policy) pair over the given roots: a live materialization per
  // root, and a GraphQL surface rebuilt to include it. Schemas registered earlier are visible
  // to this one's refs (register dependencies first).
  register(schema: HyperSchema, policy: Policy, roots: readonly string[]): void {
    this.registered.push({ schema, policy, roots });
    const registry = SchemaRegistry.build(this.registered.map((r) => r.schema));
    this.reactor.register(schema.name, schema.body, roots, registry);
    this.gql = buildGqlSchema(this.registered, (name, root) => this.gather(name, root));
  }

  // The read seam GraphQL resolves through: the live materialization when the root is watched,
  // batch evaluation otherwise — the spike proved the two are identical.
  private gather(name: string, root: string): HView {
    const live = this.reactor.materializedView(name, root);
    if (live !== undefined) return live;
    const def = this.registered.find((r) => r.schema.name === name);
    if (def === undefined) throw new Error(`no registered schema named ${name}`);
    const registry = SchemaRegistry.build(this.registered.map((r) => r.schema));
    const result = this.reactor.eval(def.schema.body, root, registry);
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

  // Await every write the raw stream has queued. Rejects if any write-through failed.
  async flush(): Promise<void> {
    await this.writes;
  }

  async close(): Promise<void> {
    await this.flush();
    await this.backend.close();
  }
}
