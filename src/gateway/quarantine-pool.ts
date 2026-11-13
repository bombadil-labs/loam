import type { Delta } from "@bombadil/rhizomatic";
import type { StoreBackend } from "../store/backend.js";
import { openContainerImpl } from "./container.js";
import type { FederationReport, Gateway } from "./gateway.js";

export interface QuarantinePool {
  readonly gateway: Gateway;
  reseed(): Promise<FederationReport>;
  drop(): Promise<void>;
  detach(): Promise<void>;
}

export interface QuarantineOptions {
  readonly backend?: StoreBackend;
  readonly admit?: (d: Delta) => boolean;
  readonly membership?: unknown;
}

export async function openQuarantineImpl(
  gw: Gateway,
  opts: QuarantineOptions = {},
): Promise<QuarantinePool> {
  const c = await openContainerImpl(
    gw,
    { ...opts, trust: "untrusted", posture: "separate" },
    "openQuarantine",
  );
  return {
    gateway: c.gateway!,
    reseed: () => c.reseed(),
    drop: () => c.drop(),
    detach: () => c.detach(),
  };
}
