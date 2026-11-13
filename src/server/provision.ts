import { randomBytes } from "node:crypto";
import { rmSync } from "node:fs";
import { authorForSeed } from "@bombadil/rhizomatic";
import { readUserSeed, userSeedPath, writeUserSeed } from "../cli/config.js";
import { grantClaims } from "../gateway/accounts.js";
import { containerClaims } from "../gateway/container-law.js";
import type { Gateway } from "../gateway/gateway.js";
import { STORE_ENTITY } from "../gateway/genesis.js";
import type { Leeway } from "../gateway/leeway.js";
import { stampOn, withStamp } from "../gateway/stamp.js";
import { authoredBy } from "../gateway/membership.js";
import { writtenByUser } from "../gateway/member-of.js";
import { subjectKeyAt, USER_PREFIX, userGroundOf } from "../gateway/user-root.js";
import { keyEvidenceHeld, resolveUserView, rootClaims, userEntity } from "./users.js";

export interface ProvisionRefusal {
  readonly status: number;
  readonly message: string;
}

export const LEAF_RE = /^[a-z0-9][a-z0-9_-]{0,62}$/i;

const said = (err: unknown): string => (err instanceof Error ? err.message : String(err));

export async function ensureUserKey(
  gw: Gateway,
  home: string,
  user: string,
  onFault: (message: string) => void,
): Promise<{ userSeed: string } | { refusal: ProvisionRefusal }> {
  if (gw.signer === undefined || gw.operatorAuthor === undefined) {
    return {
      refusal: {
        status: 503,
        message: "This store cannot sign a declaration right now, so nothing was made.",
      },
    };
  }
  const seed = readUserSeed(home, user);
  if (seed.kind === "present" && /^[0-9a-f]{64}$/.test(seed.seed)) return { userSeed: seed.seed };
  if (seed.kind === "absent") {
    const minted = randomBytes(32).toString("hex");
    let written = false;
    try {
      writeUserSeed(home, user, minted);
      written = true;
      const operator = gw.operatorAuthor;
      const signer = gw.signer;
      const key = authorForSeed(minted);
      const known = resolveUserView(gw.reactor, operator, gw.validityNow(), user) !== undefined;
      await gw.append([
        signer.sign(
          withStamp(stampOn(gw, operator, Date.now()), (t) =>
            grantClaims(STORE_ENTITY, known ? userEntity(user) : key, "write", operator, t),
          ),
        ),
        signer.sign(
          withStamp(stampOn(gw, operator, Date.now()), (t) => rootClaims(user, key, operator, t)),
        ),
      ]);
    } catch (err) {
      let survived = false;
      if (written) {
        try {
          rmSync(userSeedPath(home, user), { force: true });
        } catch {
          survived = true;
        }
      }
      onFault(
        `could not provision a signing key for ${user}: ${said(err)}` +
          (survived ? `; the seed file at ${userSeedPath(home, user)} could not be removed` : ""),
      );
      return {
        refusal: {
          status: 503,
          message:
            "Your signing key could not be provisioned, so no container was made." +
            (survived ? "" : " Nothing partial was kept."),
        },
      };
    }
    return { userSeed: minted };
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

export function ownedMembership(
  gw: Gateway,
  owner: { readonly user: string; readonly seed: string },
  scope: string,
): { readonly membership: unknown } | { readonly refusal: string } {
  const key = authorForSeed(owner.seed);
  const operator = gw.operatorAuthor;
  const now = gw.validityNow();
  if (subjectKeyAt(gw.reactor, now, operator, `${USER_PREFIX}${owner.user}`) === key) {
    return { membership: writtenByUser(owner.user, scope) };
  }
  const bound =
    operator !== undefined &&
    keyEvidenceHeld(userGroundOf(gw.reactor).reactor, operator, owner.user);
  return bound
    ? {
        refusal:
          `${owner.user} is a user of this store, and the key file here is not their current key, ` +
          `so a container cannot be made for them from it`,
      }
    : { membership: authoredBy(key) };
}

export async function declareOwned(
  gw: Gateway,
  name: string,
  owner: { readonly user: string; readonly seed: string },
  parent: string | undefined,
  onFault: (message: string) => void,
  leeway?: Leeway,
): Promise<ProvisionRefusal | undefined> {
  if (gw.signer === undefined || gw.operatorAuthor === undefined) {
    return {
      status: 503,
      message: "This store cannot sign a declaration right now, so nothing was made.",
    };
  }
  const owned = ownedMembership(gw, owner, name);
  if ("refusal" in owned) {
    onFault(`could not declare ${name}: ${owned.refusal}`);
    return {
      status: 409,
      message:
        "This user's key file is not their current key on this store, so nothing was made. Ask " +
        "the store's operator to repair it.",
    };
  }
  const spec = {
    container: name,
    trust: "curated" as const,
    posture: "shared" as const,
    membership: owned.membership,
    ...(parent === undefined ? {} : { parent }),
    ...(leeway === undefined ? {} : { leeway }),
  };
  const operator = gw.operatorAuthor;
  try {
    await gw.append([
      gw.signer.sign(
        withStamp(stampOn(gw, operator, Date.now()), (t) => containerClaims(spec, operator, t)),
      ),
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
