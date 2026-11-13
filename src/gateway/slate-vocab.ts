import { type Claims } from "@bombadil/rhizomatic";

export const CTX_SLATE = "loam.erasure.slate";

export const entityPtr = (
  role: string,
  id: string,
  context: string,
): Claims["pointers"][number] => ({
  role,
  target: { kind: "entity", entity: { id, context } },
});

export function slatePointer(container: string): Claims["pointers"][number] {
  return entityPtr("slate", container, CTX_SLATE);
}
