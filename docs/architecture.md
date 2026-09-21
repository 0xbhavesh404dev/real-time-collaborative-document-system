# Architecture

## Main flow

```text
React + textarea
      | REST API / Socket.IO
      v
Express + Socket.IO server
      | custom TextCRDT
      v
PostgreSQL
```

REST is used for authentication, channels, documents, and version snapshots. Socket.IO is used for live document rooms, CRDT operations, presence, cursor awareness, and typing indicators.

## Components

- `client`: React pages and the simple textarea editor.
- `server`: Express routes, JWT middleware, Socket.IO events, and PostgreSQL access.
- `server/crdt`: the educational character-based sequence CRDT.
- `database/schema.sql`: relational tables and constraints.

The active CRDT map is held in memory on one server and is loaded from PostgreSQL when a document is first opened. This keeps the implementation understandable for a college project.

## Security boundary

HTTP routes use the JWT middleware. Socket connections verify the JWT during the handshake. Before joining or changing a document, the server checks channel membership and role. The frontend hides or disables controls for convenience, but the backend remains authoritative.
