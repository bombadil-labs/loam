// A signing seam: one object that signs in one key's voice. It refuses claims authored by any other
// key, so no caller can produce a delta that names one author and is signed by another. A gateway
// keeps its seed only here: its options drop the seed once the signer is made. It is a seam, not key
// protection: the process still holds the seed in memory, and the key file stays where it was read.

import { authorForSeed, signClaims, type Claims, type Delta } from "@bombadil/rhizomatic";

export interface Signer {
  /** The author every delta this signer signs must name. */
  readonly author: string;
  sign(claims: Claims): Delta;
}

/** The signer for `seed`. */
export function seedSigner(seed: string): Signer {
  const author = authorForSeed(seed);
  return {
    author,
    sign(claims) {
      if (claims.author !== author) {
        throw new Error(`a signer for ${author} refuses claims authored by ${claims.author}`);
      }
      return signClaims(claims, seed);
    },
  };
}
