// Types for the board vocabulary module. The demos boot from it and `test/board/*` asserts
// against it — one vocabulary, every door.

/** The singleton the board renders from. */
export const BOARD_ENTITY: string;

/** The route the renderer claims: `/:mount/app/board/board:main`. */
export const BOARD_ROUTE: string;

/** The banner a fresh board wakes up with. */
export const BANNER_DEFAULT: string;

/** The BoardItem registration — the exact body POST /:mount/register accepts. */
export const BOARD_ITEM_REGISTRATION: Record<string, unknown>;

/** The Board registration — registered AFTER BoardItem (its gather names that reading). */
export const BOARD_REGISTRATION: Record<string, unknown>;
