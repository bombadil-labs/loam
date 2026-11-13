import { authorForSeed, signClaims, type Claims, type Delta } from "@bombadil/rhizomatic";

export interface Signer {
  readonly author: string;
  sign(claims: Claims): Delta;
}

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
