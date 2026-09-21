# Database Design

- `users`: account identity and bcrypt password hash.
- `channels`: project spaces owned by a user.
- `channel_members`: many-to-many user/channel relationship with `admin`, `editor`, or `viewer` role.
- `documents`: channel documents, materialized text, JSONB CRDT state, and timestamps.
- `document_operations`: accepted insert/delete operations with a unique `(document_id, operation_id)` constraint.
- `versions`: manually saved snapshots with author, message, and timestamp.
- `invitations`: stored invitations; this project does not send email.

A user can belong to many channels. A channel contains many documents. A document has many operations and versions. Foreign keys use cascading deletes for channel-owned data and restricted deletes for historical authors.

`current_content` makes normal reads simple. `crdt_state` lets an active CRDT resume, and `document_operations` provides an operation audit trail.

Indexes on memberships, channel documents, operations, and versions keep the common list and history queries efficient without adding an ORM.
