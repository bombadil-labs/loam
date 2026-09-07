import { Gateway, type ConnectionBinding } from "./gateway.js";
import { inboxName } from "./container.js";
import { connectionStands } from "./connection-authority.js";

interface RootRendererContext {
  readonly kind: "root";
  readonly execution: Gateway;
  readonly door: "full" | "public";
  readonly now: () => number;
}

interface BoundRendererContext {
  readonly kind: "bound";
  readonly authority: Gateway;
  readonly destination: string;
  readonly binding: ConnectionBinding;
  readonly requester: string;
  readonly execution: Gateway;
  readonly door: "full";
  readonly now: () => number;
}

/** Trusted host selection, not a channel activation or transport capability. */
export type RendererContext = RootRendererContext | BoundRendererContext;
const issued = new WeakSet<object>();

export const rendererContextRefusal = (): Error =>
  new Error("renderer context refuses this request");

export function createRootRendererContext(
  gateway: Gateway,
  door: "full" | "public",
  now: () => number,
): RendererContext {
  if (
    !(gateway instanceof Gateway) ||
    (door !== "full" && door !== "public") ||
    typeof now !== "function"
  ) {
    throw rendererContextRefusal();
  }
  const context = Object.freeze({ kind: "root" as const, execution: gateway, door, now });
  issued.add(context);
  return context;
}

export function createBoundRendererContext(input: {
  readonly authority: Gateway;
  readonly destination: string;
  readonly binding: ConnectionBinding;
  readonly requester: string;
  readonly execution: Gateway;
  readonly now: () => number;
}): RendererContext {
  if (
    input === null ||
    typeof input !== "object" ||
    !(input.authority instanceof Gateway) ||
    !(input.execution instanceof Gateway) ||
    typeof input.destination !== "string" ||
    input.destination === "" ||
    typeof input.requester !== "string" ||
    input.requester === "" ||
    typeof input.now !== "function" ||
    input.binding === null ||
    typeof input.binding !== "object" ||
    input.binding.container !== input.destination ||
    input.binding.inbox !== inboxName(input.destination, input.requester) ||
    input.execution.envelope === undefined
  )
    throw rendererContextRefusal();
  const context = Object.freeze({
    kind: "bound" as const,
    authority: input.authority,
    destination: input.destination,
    binding: Object.freeze({ container: input.binding.container, inbox: input.binding.inbox }),
    requester: input.requester,
    execution: input.execution,
    door: "full" as const,
    now: input.now,
  });
  issued.add(context);
  return context;
}

/** Re-read authority at each call and after each asynchronous authority boundary. */
export function rendererContextStands(context: unknown): context is RendererContext {
  if (context === null || typeof context !== "object" || !issued.has(context)) return false;
  const selected = context as RendererContext;
  return (
    selected.kind === "root" ||
    (selected.execution.envelope !== undefined &&
      connectionStands(selected.authority, selected.binding))
  );
}
