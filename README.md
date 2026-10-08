cd "/Users/bhaveshkumar/Downloads/real-time-collaborative-2 with ai integrated/server"
npm install
npm start



cd "/Users/bhaveshkumar/Downloads/real-time-collaborative-2 with ai integrated/client"
npm install
npm run dev


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
- Custom contentEditable rich-text editor with a full formatting toolbar, live grammar suggestions, autocomplete, originality scanning, paraphrase/rewrite actions, and a right-side AI workspace.

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

If the API reports that the port is already in use, keep the existing backend process and open the frontend in the browser. The backend health check is available at `http://localhost:5000/api/health`.

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

The CRDT remains educational rather than production-grade, awareness is basic, and active CRDTs are in one server's memory. The AI originality checker is corpus-based unless an external provider is configured. Offline multi-server synchronization, semantic conflict resolution, email service, and large-scale deployment are outside this capstone scope. Future work could add rich text, comments, notifications, attachments, advanced search, offline support, semantic conflict visualization, and multi-server scaling.

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

### Editor and AI interaction

While an editor types, the live grammar assistant waits briefly for a stable draft and can present an exact-text correction with **Accept** and **Reject** actions. Accept replaces only the matching phrase through the editor change pipeline, while Reject dismisses that suggestion for the current context. Autocomplete remains available as a separate ghost-text flow with Tab/Escape controls.

The toolbar now includes text styles, font family/size, bold/italic/underline/strike, text and highlight colors, superscript/subscript, four alignments, bullet/numbered/check lists, indentation, quote/code block, divider, links, tables, line height, image insertion, AI rewrite, and clear formatting.

The originality panel shows a similarity-risk ring, scan statistics, matched passages, source links, per-source match meters, and a one-click rewrite action.

## AI Copilot setup

The editor now includes AI writing assistance on the right rail and a floating AI command bar. The implemented backend routes are:

- `POST /api/ai/autocomplete` — debounced inline continuation (last 500 characters).
- `POST /api/ai/paraphrase` — three rewrite alternatives for academic, casual, or concise tone.
- `POST /api/ai/grammar` — grammar, spelling, and clarity suggestions.
- `POST /api/ai/summarize` — a concise 2–3 sentence document summary.
- `POST /api/ai/plagiarism` — local TF-IDF/cosine similarity scan against the bundled educational corpus.

Set `GEMINI_API_KEY` and `AI_MODEL` in `.env` to enable live Gemini responses. When the key is not configured, the server uses a deterministic fallback so the UI remains demonstrable without an external API.

AI suggestion requests are protected by a per-user 20 requests/minute in-memory limiter. AI outputs are audited in PostgreSQL when the `ai_suggestions` table is available; plagiarism reports are stored in `plagiarism_reports`.

The existing right-side Version History / Collaborators / Operations rail remains intact. The AI Copilot card is placed above it so AI functionality is available without removing the CRDT monitoring panels.
