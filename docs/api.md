# API Reference

All routes except registration and login require `Authorization: Bearer <token>`.
Protected requests should use the current user's token; user IDs are never trusted from the request body.

| Method | Endpoint | Purpose |
|---|---|---|
| POST | `/api/auth/register` | Create account; body: username, email, password, confirmPassword |
| POST | `/api/auth/login` | Authenticate; body: email, password |
| GET | `/api/auth/me` | Return current user |
| GET | `/api/channels` | List channels for current user |
| POST | `/api/channels` | Create channel; body: name, description |
| GET | `/api/channels/:id` | Get a member channel |
| POST | `/api/channels/:id/join` | Join channel by id |
| POST | `/api/channels/join-by-name` | Join channel by name; body: name |
| POST | `/api/channels/:id/leave` | Leave channel |
| GET | `/api/channels/:id/members` | List members and roles |
| POST | `/api/channels/:id/invite` | Admin stores an invitation |
| DELETE | `/api/channels/:id` | Admin deletes channel |
| DELETE | `/api/channels/:id/members/:userId` | Admin removes member |
| PATCH | `/api/channels/:id/members/:userId` | Admin changes role; body: role |
| GET | `/api/channels/:channelId/documents` | List documents |
| POST | `/api/channels/:channelId/documents` | Create document; body: title |
| GET | `/api/documents/:id` | Open document |
| PATCH | `/api/documents/:id` | Rename document; body: title |
| DELETE | `/api/documents/:id` | Delete a document and its saved history (admin/editor) |
| POST | `/api/documents/:id/versions` | Save snapshot; body: message |
| GET | `/api/documents/:id/versions` | List snapshots newest first |
| GET | `/api/versions/:id` | Preview one snapshot |
| POST | `/api/versions/:id/restore` | Restore through CRDT and create new snapshot |

Successful restore responses include both the new version and `restoredContent` so connected editors can update their visible state.

Socket events include `join-document`, `leave-document`, `crdt-operation`, `cursor-move`, `typing-start`, and `typing-stop`. Server events include `initial-document`, `crdt-operation`, `user-joined`, `user-left`, `user-typing`, `user-stopped-typing`, and `error`.
