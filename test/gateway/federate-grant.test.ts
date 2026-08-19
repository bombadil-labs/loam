// T188 — federation authority is a CONTAINER-SCOPED grant, not the operator role.
//
// Today `GET /:mount/federate` demands the operator token, and that token also registers root law,
// mints grants, drops containers and reads everything. So "let me federate with you" costs a peer
// the entire store. §28 says trust is a property of a CONTAINER and multitenancy is a goal, so
// re-centralising on the operator would defeat the model this arc exists to build.
//
// The shape mirrors T174's register verb exactly: a verb in the grant vocabulary, scoped — there by
// an entity-namespace prefix, here by a container name. The operator holds it at root BY
// CONSTRUCTION rather than as a special case.

import { describe, expect, it } from "vitest";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { federateContainersOf, grantClaims, holdsGrant } from "../../src/gateway/accounts.js";
import { assembleGenesis, STORE_ENTITY } from "../../src/gateway/genesis.js";
import { Gateway } from "../../src/gateway/gateway.js";
import { MemoryBackend } from "../../src/store/memory.js";

const OP = "cc".repeat(32);
const FRIEND = "d1".repeat(32);
const STRANGER = "e2".repeat(32);

async function store(): Promise<Gateway> {
  return Gateway.boot(
    new MemoryBackend(),
    assembleGenesis({ operatorSeed: OP, registrations: [] }),
  );
}

/** The operator grants `subject` the federate verb, scoped to one container. */
async function grantFederate(gw: Gateway, subject: string, container: string): Promise<void> {
  await gw.append([
    signClaims(
      grantClaims(
        STORE_ENTITY,
        subject,
        "federate",
        authorForSeed(OP),
        gw.nextTimestamp(),
        container,
      ),
      OP,
    ),
  ]);
}

describe("T188 — a container-scoped federate grant", () => {
  it("names the containers its holder may federate, and only those", async () => {
    const gw = await store();
    try {
      const friend = authorForSeed(FRIEND);
      await grantFederate(gw, friend, "friends");
      expect(federateContainersOf(gw.reactor, friend, gw.operatorAuthor)).toEqual(["friends"]);
    } finally {
      await gw.close();
    }
  });

  it("a holder scoped to one container is not scoped to another", async () => {
    // The fence, from the side that matters: holding `federate` at `friends` must not admit `work`.
    const gw = await store();
    try {
      const friend = authorForSeed(FRIEND);
      await grantFederate(gw, friend, "friends");
      const held = federateContainersOf(gw.reactor, friend, gw.operatorAuthor);
      expect(held).toContain("friends");
      expect(held).not.toContain("work");
    } finally {
      await gw.close();
    }
  });

  it("a stranger holds nothing", async () => {
    const gw = await store();
    try {
      await grantFederate(gw, authorForSeed(FRIEND), "friends");
      // Two-sided: the reader must distinguish a holder from a bystander, or the fence is decorative.
      expect(federateContainersOf(gw.reactor, authorForSeed(STRANGER), gw.operatorAuthor)).toEqual(
        [],
      );
    } finally {
      await gw.close();
    }
  });

  it("the verb is real: holdsGrant answers for it like any other", async () => {
    const gw = await store();
    try {
      const friend = authorForSeed(FRIEND);
      expect(holdsGrant(gw.reactor, STORE_ENTITY, friend, "federate", gw.operatorAuthor)).toBe(
        false,
      );
      await grantFederate(gw, friend, "friends");
      expect(holdsGrant(gw.reactor, STORE_ENTITY, friend, "federate", gw.operatorAuthor)).toBe(
        true,
      );
    } finally {
      await gw.close();
    }
  });

  it("revocation binds at once, and takes only the revoked grant", async () => {
    const gw = await store();
    try {
      const friend = authorForSeed(FRIEND);
      const other = authorForSeed(STRANGER);
      await grantFederate(gw, friend, "friends");
      await grantFederate(gw, other, "work");

      const { makeNegationClaims } = await import("@bombadil/rhizomatic");
      const grant = [...gw.reactor.snapshot()].find(
        (d) =>
          d.claims.pointers.some(
            (p) =>
              p.role === "verb" && p.target.kind === "primitive" && p.target.value === "federate",
          ) &&
          d.claims.pointers.some(
            (p) =>
              p.role === "subject" && p.target.kind === "primitive" && p.target.value === friend,
          ),
      )!;
      await gw.append([
        signClaims(makeNegationClaims(gw.operatorAuthor!, gw.nextTimestamp(), grant.id), OP),
      ]);

      expect(federateContainersOf(gw.reactor, friend, gw.operatorAuthor)).toEqual([]);
      // Two-sided: the bystander's grant is untouched.
      expect(federateContainersOf(gw.reactor, other, gw.operatorAuthor)).toEqual(["work"]);
    } finally {
      await gw.close();
    }
  });
});
