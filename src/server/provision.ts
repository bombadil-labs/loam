// Provisioning a person's place in the tree (SPEC §40 create-root, §58 consent): their signing
// key, their home container, and a child under it. Two doors do this — the admin page when a
// person presses "create your container", and the consent page when a person binds a connection
// on a day their home does not exist yet — so the acts live here, once, with one set of words.
//
// A seed file that EXISTS but cannot be used fails closed: overwriting a key file because it read
// wrong would destroy a credential no door can prove dead. Every fault reaches the operator through
// `onFault` (it names paths); the caller sees only the refusal's status and sentence.

import { randomBytes } from "node:crypto";
import { authorForSeed, signClaims } from "@bombadil/rhizomatic";
import { readUserSeed, userSeedPath, writeUserSeed } from "../cli/config.js";
import { grantClaims } from "../gateway/accounts.js";
import { containerClaims } from "../gateway/container.js";
import type { Gateway } from "../gateway/gateway.js";
import { STORE_ENTITY } from "../gateway/genesis.js";

export interface ProvisionRefusal {
  readonly status: number;
  readonly message: string;
}

/** A leaf a person may name under their home: one path segment, never a colon (the separator). */
export const LEAF_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/i;

/** The membership every provisioned container starts with: what its owner authored. */
export const authoredBy = (publicKey: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: publicKey } },
  in: "input",
});

const said = (err: unknown): string => (err instanceof Error ? err.message : String(err));

/**
 * The user's signing seed, minted and trusted with a write grant when absent. Refuses when the
 * store cannot sign, when a present seed cannot be used, or when minting fails — nothing partial.
 */
export async function ensureUserKey(
  gw: Gateway,
  home: string,
  user: string,
  onFault: (message: string) => void,
): Promise<{ userKey: string } | { refusal: ProvisionRefusal }> {
  if (gw.options.seed === undefined || gw.operatorAuthor === undefined) {
    return {
      refusal: {
        status: 503,
        message: "This store cannot sign a declaration right now, so nothing was made.",
      },
    };
  }
  const seed = readUserSeed(home, user);
  if (seed.kind === "present" && /^[0-9a-f]{64}$/.test(seed.seed)) return { userKey: seed.seed };
  if (seed.kind === "absent") {
    const minted = randomBytes(32).toString("hex");
    try {
      writeUserSeed(home, user, minted);
      await gw.append([
        signClaims(
          grantClaims(
            STORE_ENTITY,
            authorForSeed(minted),
            "write",
            gw.operatorAuthor,
            gw.nextTimestamp(),
          ),
          gw.options.seed,
        ),
      ]);
    } catch (err) {
      onFault(`could not provision a signing key for ${user}: ${said(err)}`);
      return {
        refusal: {
          status: 503,
          message:
            "Your signing key could not be provisioned, so no container was made. Nothing " +
            "partial was kept.",
        },
      };
    }
    return { userKey: minted };
  }
  onFault(
    `cannot use ${userSeedPath(home, user)}: ` +
      (seed.kind === "unreadable"
        ? seed.detail
        : "it is present but is not a 64-character hex signing key"),
  );
  return {
    refusal: {
      status: 409,
      message:
        "This user's signing key exists on this store but cannot be used, so no container was " +
        "made. Ask the store's operator to repair it.",
    },
  };
}

/** Declare a container gathering what `userKey` authored — the home (no parent) or a child. */
export async function declareOwned(
  gw: Gateway,
  name: string,
  userKey: string,
  parent: string | undefined,
  onFault: (message: string) => void,
): Promise<ProvisionRefusal | undefined> {
  if (gw.options.seed === undefined || gw.operatorAuthor === undefined) {
    return {
      status: 503,
      message: "This store cannot sign a declaration right now, so nothing was made.",
    };
  }
  const spec = {
    container: name,
    trust: "curated" as const,
    posture: "shared" as const,
    membership: authoredBy(authorForSeed(userKey)),
    ...(parent === undefined ? {} : { parent }),
  };
  try {
    await gw.append([
      signClaims(containerClaims(spec, gw.operatorAuthor, gw.nextTimestamp()), gw.options.seed),
    ]);
  } catch (err) {
    onFault(
      `could not declare ${parent === undefined ? `the root container for ${name}` : name}: ` +
        said(err),
    );
    return {
      status: 503,
      message: "This store could not land the declaration, so nothing was made.",
    };
  }
  return undefined;
}
