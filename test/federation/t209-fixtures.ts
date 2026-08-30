// T209 §24.6 × §46 — INSTALL BY FEDERATION: an arriving renderer is inert until blessed.
//
// A renderer is a delta and a channel carries deltas, so a peer's app already lands in the receiver's
// pool as bytes. What it may not do is RUN. Blessing a name (§46.3's `blessing` toggle) and mounting
// code that executes are different grants, and the second one is strictly wider — so auto-bless must
// never mean auto-execute. The explicit act is `bless-app`, one route at a time.
//
// THE RAILS ASK AT BOTH LEVELS, because either alone is blind here:
//   - BYTES: the peer's renderer delta is in the POOL's store and in no tier of the receiver's own.
//   - DOOR: what a person receives from `serveRoute` — 404 before the blessing, a framed page after.
// A rail that only proved the 404 would pass with renderers deleted from the product entirely, so
// every inertness rail here carries the blessed half beside it: the refusal is the blessing's
// absence, never the app's.
//
// WHAT THESE RAILS DELIBERATELY DO NOT ASSERT. (1) That the probation frame is UNFORGEABLE — it is
// chrome inside the same document as untrusted markup (§24.7 states the limit, and
// test/gateway/probation-frame.test.ts owns the frame's own contract). (2) That a COLD process serves
// a blessed app: the served bundle is loaded by `prepareRoute`, which the HTTP door calls before
// every render, and these rails run in one process where the publish already warmed the ESM cache.
// A REBOOT DOES NOT CLOSE IT EITHER, which the first draft of this note got wrong: the ESM cache is
// a module-level Map that `close()` never clears, so any rail that blesses and then reboots in ONE
// process warms it before the reboot. Closing this wants the blessing to happen in a DIFFERENT
// process — a CLI child — or an eviction hook. The restart rail below is about the pool's re-attach
// and its scope, not about a cold load, and it does not claim otherwise.

import { existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect } from "vitest";
import { authorForSeed, contentAddress, type Policy, type Schema } from "@bombadil/rhizomatic";
import { run } from "../../src/cli/cli.js";
import { exportOffer } from "../../src/federation/offer.js";
import { grantClaims } from "../../src/gateway/accounts.js";
import { declareHostSizedBill } from "../helpers/pool-bill.js";
import { CTX_MANIFEST } from "../../src/gateway/adopt-law.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { PUBLIC_ENTITY } from "../../src/gateway/public.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, pickLatest } from "../gateway/fixtures.js";

export const ALICE_SEED = "a1".repeat(32);
export const BOB_SEED = "b0".repeat(32);
export const CAROL_SEED = "c7".repeat(32);
export const PEN_SEED = "5a".repeat(32);
export const PEN = authorForSeed(PEN_SEED);
export const BOB = authorForSeed(BOB_SEED);

// A needle no other store in this file plants, so a byte probe over a pool FILE is about this app's
// code and nothing else. Not pure hex: a hex needle collides with delta ids and author keys.
export const NEEDLE = "arrived-app-marker-zoltar";

// A peer's app: it paints what the lens resolves and offers the form that writes it back.
export const APP =
  `export default (n) => \`<main data-app="${NEEDLE}"><p id=h>\${n.view.height ?? ""}</p>` +
  "<form method=post><input name=height></form></main>`;";
// A DIFFERENT app, so a hash rail cannot pass by reporting one constant.
export const OTHER_APP =
  'export default (n) => `<section id=other>${n.view.height ?? ""}</section>`;';
// An app that paints WHICH READING rendered it: `watered` is a field two Schemas over the same
// ground answer differently, so the page distinguishes lenses where a value never could.
export const LENS_APP = "export default (n) => `<p id=w>${String(n.view.watered)}</p>`;";

// A reading of the SAME hyperschema under the SAME lens name, with different law — the corpus in
// which "a lens of that name is served here" and "this law is served here" give different answers.
export const RIVAL_PLANT: Schema = {
  props: new Map<string, Policy>([
    ["height", pickLatest],
    ["tag", pickLatest],
  ]),
  default: pickLatest,
};

export const CHANNEL = "channel:friends:alice";

export const store = async (
  seed: string,
  opts?: { pens: Record<string, string> },
): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: seed,
      registrations: [],
      ...(seed === BOB_SEED
        ? { grants: [grantClaims(STORE_ENTITY, PEN, "write", BOB, 9_001)] }
        : {}),
    }),
    opts,
  );
  // Every receiver in these suites asserts pool-render SUCCESS through channel apps; the
  // default 500ms bill also clocks worker spawn on the pool path and loses under load (T253).
  await declareHostSizedBill(gw, 9_010);
  return gw;
};

/** A peer who registered a lens, holds one observation, and publishes an app over it. */
export async function peer(
  seed: string,
  opts: { route: string; app: string; height: number; writes?: boolean },
): Promise<Gateway> {
  const gw = await store(seed);
  await gw.publishRegistration(PLANT, PLANT_POLICY, [FERN], undefined, undefined, undefined, [
    "height",
  ]);
  await gw.append([observed(FERN, "height", opts.height, 1_000, seed)]);
  await gw.publishRenderer({
    route: opts.route,
    schema: "Plant",
    consumes: ["height"],
    bundle: opts.app,
    ...(opts.writes === true ? { writable: ["height"], pen: "alice-pen" } : {}),
  });
  return gw;
}

/** A peer whose lens has a COMPUTED field — the §22 resolver whose ESM must not run uninvited. */
export async function resolverPeer(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: ALICE_SEED,
      registrations: [
        {
          hyperschema: PLANT,
          schema: PLANT_POLICY,
          roots: [FERN],
          resolvers: {
            readings: { rung: "a", type: "number", code: "export default () => 424242;" },
            // A SECOND computed field, on a prop whose Policy ALWAYS answers (`absentAs false`).
            // It is what lets a rail tell "the store refused" from "the store fell back": for
            // `readings` this corpus gathers nothing, so both produce an absent field.
            watered: { rung: "a", type: "boolean", code: "export default () => true;" },
          },
        },
      ],
    }),
  );
  await gw.append([observed(FERN, "height", 62, 1_000, ALICE_SEED)]);
  return gw;
}

/** A peer who dresses their own module up as this store's refusal, marker and all. */
export async function forgingPeer(): Promise<Gateway> {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: ALICE_SEED,
      registrations: [
        {
          hyperschema: PLANT,
          schema: PLANT_POLICY,
          roots: [FERN],
          resolvers: {
            readings: {
              rung: "a",
              type: "number",
              code:
                "// loam:resolver-withheld\n" +
                "globalThis.__t209_forged__ = true;\n" +
                "export default () => 424242;",
            },
          },
        },
      ],
    }),
  );
  await gw.append([observed(FERN, "height", 62, 1_000, ALICE_SEED)]);
  return gw;
}

/**
 * A CLI home with one channel open to `from`, and the io capture the CLI rails read.
 *
 * `reopen` re-exports the peer's offer and opens the channel again, which is how a fresh CLI
 * invocation pulls what the peer has published since — a file offer carries no credential, so
 * nothing resumes and nothing polls on its own.
 */
export async function cliHome(
  root: string,
  from: Gateway,
): Promise<{
  me: string;
  io: () => { out: (s: string) => void; err: (s: string) => void };
  said: () => string;
  fresh: () => void;
  reopen: () => Promise<void>;
}> {
  const out: string[] = [];
  const err: string[] = [];
  const io = (): { out: (s: string) => void; err: (s: string) => void } => ({
    out: (t: string) => out.push(t),
    err: (t: string) => err.push(t),
  });
  const said = (): string => [...out, ...err].join("\n");
  const fresh = (): void => {
    out.length = 0;
    err.length = 0;
  };
  const me = join(root, "me");
  const offer = join(root, "peer.offer");
  const open = async (): Promise<void> => {
    writeFileSync(offer, exportOffer(from));
    fresh();
    expect(
      await run(
        [
          "federate",
          "open",
          "--from",
          offer,
          "--into",
          "friends",
          "--prefix",
          "alice",
          "--home",
          me,
        ],
        io(),
      ),
      said(),
    ).toBe(0);
    fresh();
  };
  expect(await run(["init", "--home", me], io())).toBe(0);
  await open();
  return { me, io, said, fresh, reopen: open };
}

export const link = (bob: Gateway, from: Gateway, prefix: string, bless = true) =>
  bob.openChannel({
    into: "friends",
    prefix,
    bless,
    source: { pull: () => Promise.resolve(from.reactor.arrivalLog()) },
  });

/** The id of a renderer binding delta, found by the route it claims — never by our own reader. */
export const bindingOf = (gw: Gateway, route: string): string =>
  [...gw.reactor.snapshot()].find((d) =>
    d.claims.pointers.some(
      (p) => p.role === "route" && p.target.kind === "primitive" && p.target.value === route,
    ),
  )!.id;

export const bodyOf = (r: { body: string }): string => r.body;

/** How many `loam:public` declarations a store actually HOLDS — asked of the ground, not a reader. */
export const publicDeltas = (gw: Gateway): number =>
  [...gw.reactor.snapshot()].filter((d) =>
    d.claims.pointers.some(
      (pt) => pt.target.kind === "entity" && pt.target.entity.id === PUBLIC_ENTITY,
    ),
  ).length;

/** Is this delta a manifest export row at all? */
export const isRow = (d: { claims: { pointers: readonly { target: unknown }[] } }): boolean =>
  d.claims.pointers.some(
    (p) =>
      (p.target as { kind?: string; entity?: { context?: string } }).kind === "entity" &&
      (p.target as { entity?: { context?: string } }).entity?.context === CTX_MANIFEST,
  );

// Does ANY pool file under this home still hold these bytes? EVERY file, not just the .sqlite:
// sqlite runs in WAL mode, so a recent write lives in the -wal sidecar until a checkpoint, and a
// probe that reads only the main file reports "gone" for data that is merely un-checkpointed.
export const anyPoolFileHolds = (home: string, needle: string): boolean => {
  const dir = join(home, "channels");
  if (!existsSync(dir)) return false;
  return readdirSync(dir).some((f) => readFileSync(join(dir, f)).includes(needle));
};

// THE APP IDENTITY THE REPORT SHOULD PRINT, spelled out here as a literal rather than imported from
// the reader under test (H10): a shared helper cannot witness its own bug, and this is the number an
// operator compares two stores by. It covers everything the binding serves with EXCEPT the lens
// name, which the receiver renames on the way in — the sibling rails move the bundle, the writable
// list and the PEN in turn and watch it change.
//
// LENGTH-PREFIXED, restated here for the same reason: a peer signs these fields, so a separator any
// of them may contain would let two different bindings mint one identity.
export const appIdOf = (
  bundle: string,
  opts: {
    route?: string;
    consumes?: string[];
    writable?: string[];
    pen?: string;
    versionId?: string;
  } = {},
): string =>
  contentAddress(
    new TextEncoder().encode(
      [
        "loam.channel.app",
        opts.route ?? "hello",
        JSON.stringify(opts.consumes ?? ["height"]),
        bundle,
        JSON.stringify(opts.writable ?? []),
        opts.pen ?? "",
        opts.versionId ?? "",
      ]
        .map((field) => `${new TextEncoder().encode(field).length}:${field}`)
        .join(""),
    ),
  );

// RE-EXPORTED so a rail file has one import and no second list to keep in step. These are the
// substrate and product names the T209 rails reach for; the fixtures above are the rest.
export {
  authorForSeed,
  contentAddress,
  makeNegationClaims,
  signClaims,
} from "@bombadil/rhizomatic";
export { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
export { tmpdir } from "node:os";
export { join } from "node:path";
export { run } from "../../src/cli/cli.js";
export { readSeed, storePath } from "../../src/cli/config.js";
export { exportOffer } from "../../src/federation/offer.js";
export { manifestExportClaims, readManifest } from "../../src/gateway/adopt-law.js";
export { freezeMembers } from "../../src/gateway/container-identity.js";
export { assembleGenesis } from "../../src/gateway/genesis.js";
export { Gateway } from "../../src/gateway/gateway.js";
export { publicClaims, PUBLIC_ENTITY } from "../../src/gateway/public.js";
export { decorateChildren } from "../../src/gateway/resolvers.js";
export { rendererBindingClaims } from "../../src/gateway/renderers.js";
export { serve } from "../../src/server/http.js";
export { MemoryBackend } from "../../src/store/memory.js";
export { SqliteBackend } from "../../src/store/sqlite.js";
export { FERN, observed } from "../spike/garden.js";
export { PLANT, PLANT_POLICY, pickLatest } from "../gateway/fixtures.js";
