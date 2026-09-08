# Erased channel openings retain an operator cleanup path

Myk authorized the cleanup recommendation from the review of PR #566.

Erasing a protected opening stops receive operations. It must not permanently prevent the operator from purging the exact attached pool.

New opening erasures retain the exact pool declaration in their local-control marker. Cleanup validates the attached handle, current declaration, status, and relevant history. It refuses malformed history, unmarked missing openings, ambiguous openings, and changed attachments.

A protected `cleanup` event names the pool declaration and erasure tombstones. It has no opening pointer and grants no receive authority. The service persists it before the existing pool-drop operation. Retry selects only surviving cleanup records. A fresh incarnation can ignore the erased historical references that those records explicitly cover.

Older channel-only erasure markers remain readable. They cannot prove which declaration belonged to a missing current opening. That case still refuses cleanup. A valid current opening can establish the target when only an older incarnation has a marked hole.

Independent review reproduced a retry defect in the first draft. When cleanup-record erasure failed to purge its bytes, retry could select that erased record. Selection now uses surviving parsed records and deterministic IDs. A regression test covers the failed purge and first successful retry.

Channel token-file behavior is outside this change.
