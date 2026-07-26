// T78 — DYNAMIC MOUNTS: a container loaded after boot is live at /name/*, and gone when it goes.
// The mount table used to be frozen at `serve()`, so "ingest this module and run it, now" ended at
// a restart. These rails assert at the OBJECT level throughout — what the HTTP door ANSWERS, before
// and after — because the whole product here is a served door; the delta level (does the container
// table resolve? does the wall hold bytes?) is T32's, already railed in test/gateway/container-*.
//
// The load-bearing invariant is the DOOR DISCIPLINE (SPEC §12): to a tokenless caller a mount that
// exists, a mount that was removed, and a mount that never existed must be BYTE-IDENTICAL refusals.
// Mounting at runtime turns the mount set into moving state, and moving state is exactly what makes
// a 404-vs-401 oracle easy to reintroduce — so the sweep below probes every verb, not just graphql.
//
// Two properties are easy to get wrong and are railed on purpose:
//
//   * The ANONYMOUS door on a container mount is the HOST operator's live decision, never the wall's
//     seeded copy of it. A wall holds its own snapshot of `loam:public` and only moves on reseed(),
//     so gating on the pool's own answer would make a §12 revocation unrevocable at that mount.
//   * A mount can VANISH MID-REQUEST. Every await in a handler — a client-paced body, a
//     subscription opening — is a window in which drop()/removeMount() can land, and the answer
//     afterwards must be the one an unresolvable mount gives, not a served copy of a dead world.
//
// What these rails deliberately do NOT assert: that a dropped container's own in-flight SSE stream
// ends (drop closes the pool underneath it; the stream teardown railed here is removeMount's, the
// path the server owns); that a claim RETRACTED at the host stops resolving inside an attached wall
// (it does not, and must not — a wall is a point-in-time copy by construction, §24.2, moved only by
// reseed() and by the erasure fan-out, which crosses unconditionally); that the host NARROWING its
// public set (striking one declaration, publishing a smaller one) narrows what the wall serves
// anonymously (it does not — the door's OPENNESS is live, its CONTENT is the wall's snapshot; the
// rail that would close it needs a cached public-lens-set reader on Gateway to intersect against,
// which is a gateway-side seam, not a transport one); and nothing about per-container TOKENS — a
// dynamic mount answers under the server's existing token table by design.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { request } from "node:http";
import { authorForSeed, makeNegationClaims, signClaims, type Delta } from "@bombadil/rhizomatic";

// Real listening server + SSE: a generous hang-guard, so machine load cannot masquerade as a stuck
// stream. Only ever matters when something is genuinely stuck.
vi.setConfig({ testTimeout: 15000 });
import { containerClaims } from "../../src/gateway/container.js";
import { assembleGenesis } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { publicClaims } from "../../src/gateway/public.js";
import { serve, type ServerHandle } from "../../src/server/http.js";
import { MemoryBackend } from "../../src/store/memory.js";
import { FERN, observed } from "../spike/garden.js";
import { PLANT, PLANT_POLICY, PLANT_WRITABLE } from "../gateway/fixtures.js";
import { toWire } from "../../src/federation/wire.js";

const OP_SEED = "7c".repeat(32);
const OP = authorForSeed(OP_SEED);
const ALICE_SEED = "a1".repeat(32);

// Every world here is BOOTED (registration deltas in the ground, not a session-only register), so a
// wall seeded through the one-way glass replays the registrations and can actually serve GraphQL.
const boot = async (height: number): Promise<Gateway> => {
  const gw = await Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({
      operatorSeed: OP_SEED,
      registrations: [
        { hyperschema: PLANT, schema: PLANT_POLICY, roots: [FERN], writable: [...PLANT_WRITABLE] },
      ],
    }),
  );
  await gw.append([observed(FERN, "height", height, 1000, OP_SEED)]);
  return gw;
};

// The §12 open door, returned as a DELTA so a rail can strike it — revocation is one negation.
const openDoor = async (gw: Gateway, ts: number): Promise<Delta> => {
  const declaration = signClaims(publicClaims(["Plant"], OP, ts), OP_SEED);
  await gw.append([declaration]);
  return declaration;
};

const HEIGHT_QUERY = `{ plant(entity: "${FERN}") { height } }`;

let garden: Gateway; // the static mount: height 41, public
let gardenDoor: Delta; // the garden's surviving `loam:public` declaration
let orchard: Gateway; // mounted dynamically: height 30, nothing public
let handle: ServerHandle;
let base: string;

// Fresh worlds per test, not shared: these rails APPEND to the garden and attach containers to it,
// and a store carried between tests would make every height assertion order-dependent.
beforeEach(async () => {
  garden = await boot(41);
  gardenDoor = await openDoor(garden, 10_000);
  orchard = await boot(30);
  handle = await serve({
    mounts: { garden },
    tokens: { "alice-token": { actor: ALICE_SEED }, "op-token": { operator: true } },
    port: 0,
    host: "127.0.0.1",
  });
  base = handle.url;
});
afterEach(async () => {
  await handle.close();
  await garden.close();
  await orchard.close();
});

interface Answer {
  readonly status: number;
  readonly text: string;
}

const ask = async (
  path: string,
  token: string | undefined,
  method = "POST",
  body: unknown = { query: HEIGHT_QUERY },
): Promise<Answer> => {
  const res = await fetch(`${base}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  return { status: res.status, text: await res.text() };
};

const heightAt = async (mount: string, token = "alice-token"): Promise<number | null> => {
  const answer = await ask(`/${mount}/graphql`, token);
  expect(answer.status).toBe(200);
  const body = JSON.parse(answer.text) as { data?: { plant?: { height: number } | null } };
  return body.data?.plant?.height ?? null;
};

// Every verb the server routes, in the shape a prober would try it. The tokenless sweep must answer
// all of them identically across a live mount, a removed one, and a name that never existed.
const VERBS: readonly (readonly [string, string])[] = [
  ["graphql", "POST"],
  ["subscribe?query=subscription%20%7B%20__typename%20%7D", "GET"],
  ["mcp", "POST"],
  ["rest/v1/Plant/plant:fern", "GET"],
  ["append", "POST"],
  ["register", "POST"],
  ["federate", "POST"],
  ["health", "GET"],
  ["openapi.json", "GET"],
  ["app/card/plant:fern", "GET"],
  ["bytes/deadbeef?from=Plant/plant:fern", "GET"],
  ["nonesuch", "POST"],
];

const sweep = (mount: string): Promise<Answer[]> =>
  Promise.all(VERBS.map(([verb, method]) => ask(`/${mount}/${verb}`, undefined, method)));

describe("T78 — the mount table is live, not frozen at boot", () => {
  it("a mount added after boot answers where it uniformly refused before", async () => {
    const before = await ask("/orchard/graphql", "alice-token");
    expect(before.status).toBe(404);
    expect(await heightAt("garden")).toBe(41); // the static world, for contrast

    handle.addMount("orchard", orchard);

    expect(await heightAt("orchard")).toBe(30);
    // The whole door set, not just graphql: the mount is a world, not an endpoint.
    const openapi = await ask("/orchard/openapi.json", "alice-token", "GET");
    expect(openapi.status).toBe(200);
    expect(openapi.text).toMatch(/Plant/);
    const rest = await ask(
      `/orchard/rest/v1/Plant/${encodeURIComponent(FERN)}`,
      "alice-token",
      "GET",
    );
    expect(rest.status).toBe(200);
    expect(JSON.parse(rest.text)).toMatchObject({ view: { height: 30 } });
  });

  it("removeMount returns the door to indistinguishable-from-never-there", async () => {
    handle.addMount("orchard", orchard);
    expect(await heightAt("orchard")).toBe(30);

    expect(await handle.removeMount("orchard")).toBe(true);

    const removed = await ask("/orchard/graphql", "alice-token");
    const never = await ask("/nowhere/graphql", "alice-token");
    expect(removed.status).toBe(404);
    expect(removed).toEqual(never);
    const removedAnon = await ask("/orchard/graphql", undefined);
    const neverAnon = await ask("/nowhere/graphql", undefined);
    expect(removedAnon.status).toBe(401);
    expect(removedAnon).toEqual(neverAnon);
    // Idempotent, and honest about it: nothing was there to take down the second time.
    expect(await handle.removeMount("orchard")).toBe(false);
  });

  it("the static mounts are untouched, and a static mount cannot be unmounted", async () => {
    handle.addMount("orchard", orchard);
    expect(await heightAt("garden")).toBe(41);
    await handle.removeMount("orchard");
    expect(await heightAt("garden")).toBe(41);

    await expect(handle.removeMount("garden")).rejects.toThrow(/static/i);
    expect(await heightAt("garden")).toBe(41); // the refusal did not half-take-it-down
  });

  it("a live mount is never silently replaced, and a mount name is validated like a static one", async () => {
    handle.addMount("orchard", orchard);
    const other = await boot(77);
    expect(() => handle.addMount("orchard", other)).toThrow(/already/i);
    expect(() => handle.addMount("garden", other)).toThrow(/already/i);
    // The standing worlds still answer, both of them — a refused add changes nothing.
    expect(await heightAt("orchard")).toBe(30);
    expect(await heightAt("garden")).toBe(41);

    // Each unroutable shape, one per branch of the name rule: empty, a second segment, a name that
    // would arrive under a DIFFERENT spelling than it was mounted as, an escape that does not
    // decode, and a control character.
    for (const bad of [
      "",
      "a/b",
      "a%2Fb",
      "a%zz",
      "orch\u0000ard",
      `x${String.fromCharCode(0x1f)}y`,
    ]) {
      expect(() => handle.addMount(bad, other)).toThrow();
    }
    // And the boundary from the other side: 0x20 is a SPACE, not a control character — mountable,
    // and reachable percent-encoded, which keeps the rule "unroutable" rather than "unusual".
    handle.addMount("two words", other);
    expect(await heightAt("two%20words")).toBe(77);

    await handle.removeMount("two words");
    await other.close();
  });

  it("serve refuses a static mount name no URL could ever reach", async () => {
    await expect(
      serve({ mounts: { "a/b": orchard }, tokens: { t: { operator: true } }, port: 0 }),
    ).rejects.toThrow(/mount name/i);
  });
});

describe("T78 — the door discipline holds while the mount set moves", () => {
  it("tokenless probing cannot enumerate mounts: live, removed, and never-there answer alike", async () => {
    handle.addMount("orchard", orchard); // mounted, and nothing in it is public
    const shortLived = await boot(55);
    handle.addMount("gone", shortLived);
    await handle.removeMount("gone");

    const live = await sweep("orchard");
    const removed = await sweep("gone");
    const never = await sweep("nowhere");
    for (const answer of [...live, ...removed, ...never]) expect(answer.status).toBe(401);
    expect(live).toEqual(never);
    expect(removed).toEqual(never);
    await shortLived.close();
  });

  it("a presented-but-wrong token is 401 on a dynamic mount too — no downgrade to anonymous", async () => {
    handle.addMount("orchard", orchard);
    const junk = await ask("/orchard/graphql", "junk-token");
    expect(junk.status).toBe(401);
    expect(junk).toEqual(await ask("/nowhere/graphql", "junk-token"));
  });

  it("the token table is unchanged: an actor token reaches no operator verb on a dynamic mount", async () => {
    handle.addMount("orchard", orchard);
    expect((await ask("/orchard/federate", "alice-token")).status).toBe(403);
    expect((await ask("/orchard/health", "alice-token", "GET")).status).toBe(404);
    expect((await ask("/orchard/federate", "op-token")).status).toBe(200);
    expect((await ask("/orchard/health", "op-token", "GET")).status).toBe(200);
  });
});

// Declare a wall container at the garden — the operator's word that the name exists.
const declare = async (name: string, ts: number): Promise<void> => {
  await garden.append([
    signClaims(
      containerClaims({ container: name, trust: "curated", posture: "separate" }, OP, ts),
      OP_SEED,
    ),
  ]);
};

describe("T78 — a container's own gateway, mounted", () => {
  it("attaching a declared container makes it live at its own mount, serving its OWN ground", async () => {
    await declare("grove", 30_100);
    const c = await garden.openContainer({ name: "grove", backend: new MemoryBackend() });

    expect(await heightAt("grove")).toBe(41); // the seeded copy of the garden's own ground

    // It is the WALL that answers, not the primary: a fact appended after the seeding is visible
    // at /garden and NOT at /grove, which no shared-gateway shortcut could produce.
    await garden.append([observed(FERN, "height", 99, 2000, OP_SEED)]);
    expect(await heightAt("garden")).toBe(99);
    expect(await heightAt("grove")).toBe(41);

    await c.drop();
  });

  it("the anonymous door opens through a dynamically-mounted container too", async () => {
    await declare("commons", 30_200);
    const c = await garden.openContainer({ name: "commons", backend: new MemoryBackend() });

    const anon = await ask("/commons/graphql", undefined);
    expect(anon.status).toBe(200);
    expect(JSON.parse(anon.text)).toMatchObject({ data: { plant: { height: 41 } } });

    await c.drop();
  });

  it("striking loam:public at the HOST closes the container mount's anonymous door", async () => {
    await declare("commons", 30_210);
    const c = await garden.openContainer({ name: "commons", backend: new MemoryBackend() });
    expect((await ask("/commons/graphql", undefined)).status).toBe(200);

    // §12 revocation: one negation, at the host, where the operator speaks.
    await garden.append([signClaims(makeNegationClaims(OP, 10_001, gardenDoor.id), OP_SEED)]);

    expect((await ask("/garden/graphql", undefined)).status).toBe(401);
    // And the container's door shuts with it, byte-for-byte like a name that never existed — even
    // though the WALL still holds its own seeded copy of the struck declaration (a wall moves only
    // on reseed, §24.2). That copy is exactly why the gate cannot be the pool's own answer.
    expect(await ask("/commons/graphql", undefined)).toEqual(
      await ask("/nowhere/graphql", undefined),
    );
    // What was revoked is the ANONYMOUS door, not the mount: a token still reads the wall.
    expect(await heightAt("commons")).toBe(41);

    await c.drop();
  });

  it("a container attached to a DYNAMICALLY mounted host is served too", async () => {
    handle.addMount("annex", orchard);
    await orchard.append([
      signClaims(
        containerClaims({ container: "wing", trust: "curated", posture: "separate" }, OP, 30_220),
        OP_SEED,
      ),
    ]);
    const c = await orchard.openContainer({ name: "wing", backend: new MemoryBackend() });

    // The host was discovered through the DYNAMIC tier, not the static one.
    expect(await heightAt("wing")).toBe(30);

    await c.drop();
  });

  it("a container whose declared name no URL can reach is not served, and is LISTED", async () => {
    await declare("a/b", 30_230);
    const c = await garden.openContainer({ name: "a/b", backend: new MemoryBackend() });

    // Not under the two-segment spelling (that is a mount "a" with a verb "b")...
    expect(await ask("/a/b/graphql", "alice-token")).toEqual(
      await ask("/nowhere/graphql", "alice-token"),
    );
    // ...and not under the escaped one either: the name discipline is the same for all three tiers,
    // so a container cannot answer at a spelling no static mount could have been given.
    expect(await ask("/a%2Fb/graphql", "alice-token")).toEqual(
      await ask("/nowhere/graphql", "alice-token"),
    );
    // The skip is VISIBLE: an operator who names a module unroutably can see why it went nowhere.
    expect(handle.unroutableMounts()).toEqual(["a/b"]);

    await c.drop();
    expect(handle.unroutableMounts()).toEqual([]);
  });

  it("drop() takes the mount down with it — no zombie gateway, no 500", async () => {
    await declare("doomed", 30_300);
    const c = await garden.openContainer({ name: "doomed", backend: new MemoryBackend() });
    expect(await heightAt("doomed")).toBe(41);

    await c.drop();

    const gone = await ask("/doomed/graphql", "alice-token");
    expect(gone).toEqual(await ask("/nowhere/graphql", "alice-token"));
    expect(await ask("/doomed/graphql", undefined)).toEqual(
      await ask("/nowhere/graphql", undefined),
    );
    // Twice: a dangling mount 404s every time rather than throwing once it is warm.
    expect(await ask("/doomed/graphql", "alice-token")).toEqual(gone);
  });

  it("detach() takes the mount down too — the bytes are kept, the door is not", async () => {
    await declare("parked", 30_400);
    const store = new MemoryBackend();
    const c = await garden.openContainer({ name: "parked", backend: store });
    expect(await heightAt("parked")).toBe(41);

    await c.detach("parked for review");

    expect(await ask("/parked/graphql", "alice-token")).toEqual(
      await ask("/nowhere/graphql", "alice-token"),
    );
  });

  it("a container never shadows a mount the operator already named", async () => {
    await declare("garden", 30_500); // a container that WANTS the static mount's name
    await declare("thicket", 30_510); // and its uncontested twin, so this rail cannot pass empty
    const shadow = await garden.openContainer({ name: "garden", backend: new MemoryBackend() });
    const twin = await garden.openContainer({ name: "thicket", backend: new MemoryBackend() });

    await garden.append([observed(FERN, "height", 63, 3000, OP_SEED)]);
    expect(await heightAt("garden")).toBe(63); // still the primary, never the wall's snapshot
    expect(await heightAt("thicket")).toBe(41); // and the twin proves containers do mount at all

    await shadow.drop();
    await twin.drop();
  });

  it("removeMount refuses a container's mount — the container owns its own door", async () => {
    await declare("stubborn", 30_600);
    const c = await garden.openContainer({ name: "stubborn", backend: new MemoryBackend() });

    await expect(handle.removeMount("stubborn")).rejects.toThrow(/container/i);
    expect(await heightAt("stubborn")).toBe(41); // the refusal left the door standing, honestly

    await c.drop();
  });

  it("a wall outside the erasure registry serves nothing — liveness is BOTH questions", async () => {
    await declare("halfway", 30_700);
    const c = await garden.openContainer({ name: "halfway", backend: new MemoryBackend() });
    expect(await heightAt("halfway")).toBe(41);

    // The half-removed attachment, built by hand: the named index still points at the wall while
    // the erasure registry no longer holds it. A door that served THAT would serve a store outside
    // §11's fan-out, so the mount asks both questions — exactly as the completeness guard does.
    garden.quarantinePools.delete(c.gateway!);

    expect(await ask("/halfway/graphql", "alice-token")).toEqual(
      await ask("/nowhere/graphql", "alice-token"),
    );

    garden.quarantinePools.add(c.gateway!); // back in reach, so drop() can prove the discard
    await c.drop();
  });
});

describe("T78 — streams on a mount that goes away", () => {
  // One live SSE stream, framed: `next()` yields the next payload, or undefined at EOF.
  const stream = async (mount: string) => {
    const query = encodeURIComponent(`subscription { plant(entity: "${FERN}") { height } }`);
    const res = await fetch(`${base}/${mount}/subscribe?query=${query}`, {
      headers: { authorization: "Bearer alice-token", accept: "text/event-stream" },
    });
    expect(res.status).toBe(200);
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    const next = async (): Promise<{ plant: { height: number } } | undefined> => {
      for (;;) {
        const boundary = buffer.indexOf("\n\n");
        if (boundary >= 0) {
          const frame = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          const data = frame
            .split("\n")
            .filter((l) => l.startsWith("data:"))
            .map((l) => l.slice(5).trim())
            .join("");
          if (data.length > 0) return JSON.parse(data) as never;
          continue;
        }
        const chunk = await reader.read();
        if (chunk.done) return undefined;
        buffer += decoder.decode(chunk.value, { stream: true });
      }
    };
    return { next };
  };

  it("removing a mount ends ITS streams and no others", async () => {
    handle.addMount("orchard", orchard);
    const doomed = await stream("orchard");
    const spared = await stream("garden");
    expect((await doomed.next())?.plant.height).toBe(30);
    expect((await spared.next())?.plant.height).toBe(41);

    await handle.removeMount("orchard");

    // The removed mount's stream ends — EOF, not a hang (the test timeout is the hang detector).
    expect(await doomed.next()).toBeUndefined();
    // And the static mount's consumer is untouched: it still receives the next patch. A teardown
    // that ended every stream would look identical at the removed door and be a service outage.
    await garden.append([observed(FERN, "height", 58, 4000, OP_SEED)]);
    expect((await spared.next())?.plant.height).toBe(58);
  });
});

describe("T78 — a mount that vanishes mid-request", () => {
  // A POST whose body arrives in TWO halves, with a hook in between: the window that every await in
  // a handler opens, held open deliberately. The body is client-paced, so this is not a rare race —
  // it is the ordinary shape of a slow or hostile client.
  const pacedPost = (
    path: string,
    token: string,
    body: string,
    midflight: () => Promise<unknown>,
  ): Promise<Answer> =>
    new Promise<Answer>((resolve, reject) => {
      const req = request(
        `${base}${path}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${token}`,
            "content-length": String(Buffer.byteLength(body)),
          },
        },
        (res) => {
          let text = "";
          res.setEncoding("utf8");
          res.on("data", (chunk: string) => (text += chunk));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, text }));
        },
      );
      req.on("error", reject);
      const cut = Math.floor(body.length / 2);
      req.write(body.slice(0, cut));
      // Let the server route the request and enter its body read, THEN move the world under it.
      setTimeout(() => {
        void midflight().then(() => req.end(body.slice(cut)), reject);
      }, 100);
    });

  it("a body still arriving cannot be answered from a container that was dropped", async () => {
    await declare("vanishing", 32_000);
    const c = await garden.openContainer({ name: "vanishing", backend: new MemoryBackend() });
    expect(await heightAt("vanishing")).toBe(41);

    const answer = await pacedPost(
      "/vanishing/graphql",
      "alice-token",
      JSON.stringify({ query: HEIGHT_QUERY }),
      () => c.drop(),
    );

    // The world is gone, so the answer is the one an unresolvable mount gives — never a 200 whose
    // bytes drop() has just proven discarded (H7: a served copy of a world reported destroyed).
    expect(answer).toEqual(await ask("/nowhere/graphql", "alice-token"));
  });

  it("a WRITE whose body is still arriving lands nothing in a dropped container", async () => {
    await declare("writeable", 32_010);
    // A backend that REMEMBERS every id handed to it, so the delta-level question survives the
    // close() at the end of drop() (a closed store refuses even to be asked what it holds).
    const admitted: string[] = [];
    const store = new (class extends MemoryBackend {
      override async append(deltas: Iterable<Delta>): Promise<number> {
        const batch = [...deltas];
        for (const d of batch) admitted.push(d.id);
        return super.append(batch);
      }
    })();
    const c = await garden.openContainer({ name: "writeable", backend: store });
    const late = observed(FERN, "height", 7, 5000, OP_SEED);

    const answer = await pacedPost(
      "/writeable/append",
      "op-token",
      JSON.stringify({ deltas: [toWire(late)] }),
      () => c.drop(),
    );

    // Object level: the door refuses exactly as an absent mount does.
    expect(answer).toEqual(await ask("/nowhere/graphql", "op-token"));
    // Delta level: the write never reached the store drop() had just proven empty. A delta admitted
    // after the discard would be bytes outside every sweep that reported success (H7).
    expect(admitted).not.toContain(late.id);
  });

  it("a body still arriving cannot be answered from a mount that was removed", async () => {
    handle.addMount("orchard", orchard);

    const answer = await pacedPost(
      "/orchard/graphql",
      "alice-token",
      JSON.stringify({ query: HEIGHT_QUERY }),
      () => handle.removeMount("orchard"),
    );

    expect(answer).toEqual(await ask("/nowhere/graphql", "alice-token"));
  });

  // A pacing seam for the subscribe path, where there is no body to hold: a gateway whose
  // subscribe() parks until released, so the window between "the mount resolved" and "the stream
  // registers" can be entered on purpose rather than hoped for.
  const parking = (target: Gateway) => {
    let entered = (): void => {};
    const inside = new Promise<void>((r) => (entered = r));
    let release = (): void => {};
    const held = new Promise<void>((r) => (release = r));
    const gateway = new Proxy(target, {
      get(t, prop) {
        if (prop === "subscribe") {
          return async (source: string) => {
            entered();
            await held;
            return t.subscribe(source);
          };
        }
        const value: unknown = Reflect.get(t, prop, t);
        return typeof value === "function"
          ? (value as (...args: unknown[]) => unknown).bind(t)
          : value;
      },
    });
    return { gateway, inside, release: (): void => release() };
  };

  it("a subscription opening while its mount is removed never becomes a live stream", async () => {
    const park = parking(orchard);
    handle.addMount("slow", park.gateway);
    const query = encodeURIComponent(`subscription { plant(entity: "${FERN}") { height } }`);
    const pending = fetch(`${base}/slow/subscribe?query=${query}`, {
      headers: { authorization: "Bearer alice-token", accept: "text/event-stream" },
    });

    await park.inside; // the handler is past the mount resolution, parked inside subscribe()
    await handle.removeMount("slow"); // the teardown sweep runs while nothing is registered yet
    park.release();

    // Re-resolving after the await is what keeps this from becoming a stream on a removed mount:
    // the request refuses exactly as an absent one, and the generator it opened is closed.
    const res = await pending;
    expect(res.status).toBe(404);
    expect(await res.text()).toBe((await ask("/nowhere/graphql", "alice-token")).text);
  });
});
