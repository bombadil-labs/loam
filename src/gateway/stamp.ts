// A delta's signed times when its author says nothing more: valid from the moment it is made.
// One call, spread into a claims literal, so a clock-like expression is evaluated once.
export const stamped = (t: number): { timestamp: number; validFrom: number } => ({
  timestamp: t,
  validFrom: t,
});
