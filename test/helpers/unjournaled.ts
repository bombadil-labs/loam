import type { StoreBackend } from "../../src/store/backend.js";

export function unjournaled<B extends StoreBackend>(backend: B): B {
  return new Proxy(backend, {
    get(target, prop) {
      if (prop === "journalStore" || prop === "journalPeers") return undefined;
      const value: unknown = Reflect.get(target, prop, target);
      return typeof value === "function"
        ? (value as (...a: unknown[]) => unknown).bind(target)
        : value;
    },
  });
}
