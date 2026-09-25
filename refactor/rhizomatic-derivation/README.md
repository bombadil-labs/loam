# rhizomatic-derivation (L7)

The layer-7 library: code that travels in deltas. It hosts derived authors on the WASM ABI that
rhizomatic's `spec/07-derivation-abi.PROPOSAL.md` describes. A pure module has zero imports. An
effectful module declares its capabilities as host imports, and the host grants each one.

One question is open before this starts: do Loam's read-side resolvers (Loam SPEC §22) fold into
L7 derived authors, or get their own ABI in L5?

Empty until M7.
