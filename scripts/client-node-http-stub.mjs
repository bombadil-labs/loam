// The browser bundle's stand-in for `node:http`. rhizomatic's root index re-exports its peer
// transport (Peer/servePeer → node:http) and does not declare `sideEffects: false`, so the
// bundler cannot drop the edge on its own — this stub satisfies it with a function the client
// never exports a path to. Reaching it means someone rewired the bundle's internals; it
// refuses loudly rather than half-working.
export const createServer = () => {
  throw new Error("the peer transport is not part of the browser client");
};
