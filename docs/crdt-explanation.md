# Custom CRDT Explanation

CRDT means Conflict-Free Replicated Data Type. A replica is a local copy of the shared state. Each client can create operations locally, and replicas merge operations instead of replacing the whole document.

## Character nodes

Each character is stored as a node:

```json
{
  "id": "clientA:1",
  "value": "H",
  "leftId": "HEAD",
  "deleted": false
}
```

An insert operation stores the character and the node to its left. A delete marks a node as deleted. The deleted node is a tombstone, so later operations can still safely refer to its id.

## Deterministic ordering

If A and B both insert after the same node, their operation ids are sorted lexicographically. The result does not depend on which network message arrived first.

For example, operations `A:1` and `B:1` both after `H` are rendered as `A:1` then `B:1` on every replica. This is an educational convergence rule, not a semantic language-aware conflict resolver.

## Pending and duplicate operations

An insert whose `leftId` has not arrived is held in `pendingOperations`. It is applied when the dependency appears. An operation id already present in `nodes` or `pendingOperations` is ignored, providing idempotency.

## Persistence and transport

Socket.IO transports operations to the server and other document-room clients. PostgreSQL stores both the materialized `current_content` and serialized `crdt_state`, while `document_operations` stores operation history.

## Restore

Restoring a version does not delete history or directly replace the textarea. The server creates tombstone deletes for visible current characters and insert operations for the selected snapshot, persists them, broadcasts them, and records a new version.

## Limitations

This CRDT is educational, single-server, character-based, and not intended to compete with mature production CRDT libraries. It does not implement semantic NLP conflict resolution, offline multi-server synchronization, or rich text.
