// The membership terms Loam writes into container declarations. One builder per shape, so a
// suggested membership (the admin form) and a provisioned one cannot drift apart.

/** A container that gathers what one key authored. */
export const authoredBy = (publicKey: string): unknown => ({
  op: "select",
  pred: { match: { field: "author", cmp: "eq", const: publicKey } },
  in: "input",
});
