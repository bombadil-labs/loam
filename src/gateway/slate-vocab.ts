// The slate vocabulary erasure's law also reads: the context and the pointer shape. A leaf, so
// erasure and slates can both read it without importing each other.

import { type Claims } from "@bombadil/rhizomatic";

export const CTX_SLATE = "loam.erasure.slate";

// --- claim builders -----------------------------------------------------------------------------

export const entityPtr = (
  role: string,
  id: string,
  context: string,
): Claims["pointers"][number] => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});

/** The pointer a cut's erasure carries so "which erasures belong to this graveyard" is a JOIN. */
export function slatePointer(container: string): Claims["pointers"][number] {
  return entityPtr("slate", container, CTX_SLATE);
}
