# Real-Time Collaborative Document Management System

A beginner-to-medium DBMS project showing real-time collaborative editing with a custom educational CRDT.

## Problem and objectives

Whole-document replacement can overwrite another user's edit. This project represents edits as operations, merges them deterministically, persists the state in PostgreSQL, and sends operations through Socket.IO. It also demonstrates authentication, channels, roles, presence, and manual version snapshots.

## Features

- User registration and login with bcryptjs and JWT.
- PostgreSQL users, channels, membership, documents, CRDT operations, versions, and invitations.
- Admin, editor, and viewer permissions checked by the backend and Socket.IO.
- Character-based custom CRDT with unique ids, tombstones, pending operations, deterministic ordering, and idempotency.
- Socket.IO document rooms with initial sync, operation replication, presence, basic cursor/typing events.
- Save, preview, and restore document versions. Restore creates a new version and keeps old versions.
- Simple React textarea editor with responsive plain CSS.

## Technology stack

React, Vite, JavaScript, JSX, React Router, Fetch API, Socket.IO client, Node.js, Express, Socket.IO, JWT, bcryptjs, PostgreSQL, and `pg`. No ready-made CRDT library is used.

## Setup

For feature work, use the `bhavesh-feature` branch so changes stay separate from `main`.

1. Install Node.js, PostgreSQL, and npm.
2. Create the database:

```bash
createdb collab_docs
psql -d collab_docs -f database/schema.sql
```

3. Copy `.env.example` to `.env` and set `DATABASE_URL`, `JWT_SECRET`, and `CLIENT_URL`. On a passwordless local macOS PostgreSQL installation, `DATABASE_URL=postgresql:///collab_docs` may be useful.
4. Install and run the server:

```bash
cd server
npm install
npm start
```

5. In another terminal, install and run the client:

```bash
cd client
npm install
npm run dev
```

Open `http://localhost:5173`.

## Architecture and database

React communicates with Express over REST for accounts and stored resources. Socket.IO carries live operations and awareness events. The server uses a `TextCRDT` instance per active document and persists JSONB state plus operation history. See [docs/architecture.md](docs/architecture.md), [docs/database-design.md](docs/database-design.md), and [docs/api.md](docs/api.md).

## CRDT algorithm

Each character node has `id`, `value`, `leftId`, and `deleted`. Inserts reference the node on their left. Deletes create tombstones. Concurrent siblings are sorted by operation id, so delivery order does not decide the final text. Missing dependencies wait in `pendingOperations`, and duplicate ids are ignored. See [docs/crdt-explanation.md](docs/crdt-explanation.md).

## Testing

Run the CRDT tests:

```bash
cd server
npm run test:crdt
```

Build the frontend:

```bash
cd client
npm run build
```

Manual test plan: register two users, create a channel, join it from a second browser, create a document, open it in both browsers, edit at the same time, verify convergence, save two versions, preview the first, restore it, and verify the restore creates another version. Add a viewer and verify they can read but cannot edit, save, restore, or manage members.

## Limitations and future work

The editor is a textarea, awareness is basic, active CRDTs are in one server's memory, and the CRDT is educational rather than production-grade. There is no rich text, semantic NLP conflict resolution, offline multi-server synchronization, email service, or large-scale deployment. Future work could add rich text, comments, notifications, attachments, advanced search, offline support, semantic conflict visualization, and multi-server scaling.

## Viva questions

**What is CRDT?** Conflict-Free Replicated Data Type; it lets replicas modify and merge data so they converge to the same state.

**Why a custom CRDT?** To understand the basic mechanism instead of hiding it behind a ready-made library.

**Why Socket.IO?** It provides real-time communication for CRDT operations and awareness events.

**Why PostgreSQL?** It stores relational users, channels, memberships, documents, operations, and version history reliably.

**What happens during simultaneous editing?** Each user creates an operation, replicas apply it, and deterministic ordering makes their visible states converge.

**What is a tombstone?** A deleted node that remains internally so references to its id stay valid.

**What is version control?** Manual snapshots with an author, timestamp, and message that can be previewed or restored.

**What happens during restore?** The selected content becomes new CRDT operations and a new version; previous versions remain untouched.

**What is RBAC?** Role-Based Access Control; admin, editor, and viewer roles receive different permissions.
