# Smart Team Collaboration Backend — Project Specification

**Stack:** Node.js, Express, MySQL (mysql2), Socket.io, JWT Auth, Multer

**Purpose:** Multi-tenant collaboration backend providing workspaces, channels, messaging, tasks, notifications, file uploads, search, and real-time updates.

---

## 1) System Architecture

### 1.1 High-Level Overview
- **API Layer:** Express server exposing REST endpoints under `/api/*`.
- **Realtime Layer:** Socket.io server for live chat, typing indicators, unread counts, and presence.
- **Data Layer:** MySQL accessed via `mysql2` with `db.promise()` for async queries.
- **Auth:** JWT bearer tokens, verified via middleware.

### 1.2 Server Entry
- File: `backend/server.js`
- Config: `backend/config/db.js` (env-based connection)
- Routes mounted:
  - `/api/auth`
  - `/api/workspaces`
  - `/api/channels`
  - `/api/messages`
  - `/api/tasks`
  - `/api/direct-messages`
  - `/api/notifications`
  - `/api/unread`
  - `/api/files`
  - `/api/search`
- Static uploads served at `/uploads`.

---

## 2) Authentication System

### 2.1 Register
- `POST /api/auth/register`
- Controller: `authController.registerUser`
- Creates user with bcrypt hash.

### 2.2 Login
- `POST /api/auth/login`
- Controller: `authController.loginUser`
- Returns JWT (`expiresIn: 1d`) and user profile.

### 2.3 JWT Middleware
- File: `middleware/authMiddleware.js`
- Verifies `Authorization: Bearer <token>`
- Injects `req.user = { user_id, email }`

---

## 3) Workspace System

### 3.1 Create Workspace
- `POST /api/workspaces/create`
- Requires auth
- Transaction:
  - Insert into `workspaces`
  - Insert creator into `workspace_members` as `owner`

### 3.2 Fetch Workspaces
- `GET /api/workspaces/my-workspaces`
- Returns workspaces where user is a member.

### 3.3 Roles & Permissions
- Middleware: `middleware/roleMiddleware.js`
- Roles: `owner`, `admin`, `member`
- Used on channel/task creation to limit to owner/admin.

---

## 4) Channel & Chat System

### 4.1 Channels
- `POST /api/channels/create` (owner/admin only)
- `GET /api/channels/workspace/:workspaceId`

### 4.2 Channel Messages
- `POST /api/messages/send`
  - Inserts into `messages` with `reply_to` optional
- `GET /api/messages/channel/:channelId`
  - Returns messages in ascending order

### 4.3 Message Edit & Delete (Soft Delete)
- `PUT /api/messages/edit/:messageId`
  - Validates ownership
  - Updates `message_text`, `is_edited = TRUE`
- `DELETE /api/messages/:messageId`
  - Validates ownership
  - Updates `is_deleted = TRUE`, `message_text = "[deleted]"`

---

## 5) Direct Messages (DM)

### 5.1 Send DM
- `POST /api/direct-messages/send`
- Inserts into `direct_messages`

### 5.2 Fetch DM Thread
- `GET /api/direct-messages/chat/:receiverId`
- Marks messages as read for receiver

---

## 6) Task System

### 6.1 Create Task
- `POST /api/tasks/create`
- Owner/admin only
- Supports status, priority, due date, assignee

### 6.2 Get Workspace Tasks
- `GET /api/tasks/workspace/:workspaceId`

### 6.3 Update Task Status
- `PUT /api/tasks/status/:taskId`

---

## 7) Notifications

### 7.1 Create Notification
- `POST /api/notifications/create`

### 7.2 List Notifications
- `GET /api/notifications/my-notifications`

### 7.3 Mark Read
- `PUT /api/notifications/read/:notificationId`

---

## 8) Search System

- `GET /api/search?q=keyword`
- Global search across:
  - users
  - messages
  - tasks
  - channels

---

## 9) File Upload System

- `POST /api/files/upload`
- Uses Multer (`middleware/uploadMiddleware.js`)
- Accepts JPG/JPEG/PNG/PDF, max 10MB
- Stores in `/backend/uploads`

---

## 10) Unread System

### 10.1 Unread Counts API
- `GET /api/unread/count`
- Counts:
  - Channel unread (messages where `is_read = FALSE`, sender != user)
  - DM unread (direct_messages where `is_read = FALSE`, receiver = user)
  - Notifications unread (notifications where `is_read = FALSE`, user = user)
  - Per-channel unread mapping

### 10.2 Realtime Unread Updates
- Socket events:
  - `join_user_room` → join room `user_{userId}`
  - `unread_update` → server emits unread counts to user room
  - `mark_channel_read` → updates messages to read for channel
  - `mark_dm_read` → updates DMs to read for receiver

---

## 11) Socket.io Realtime Architecture

### 11.1 Connection Flow
- Client connects to Socket.io
- Optional events:
  - `user_online` → server broadcasts `online_users`
  - `join_channel` → joins `channel_{channelId}`
  - `join_dm` → joins `dm_{minId}_{maxId}`
  - `join_notifications` → joins `notification_{userId}`
  - `join_user_room` → joins `user_{userId}`

### 11.2 Rooms Strategy
- **Channel room:** `channel_{channelId}`
- **DM room:** `dm_{userA}_{userB}` (sorted IDs)
- **Notification room:** `notification_{userId}`
- **User room:** `user_{userId}` (unread updates)

### 11.3 Socket Events (Server)
**Presence**
- `user_online` → emits `online_users`

**Channel Chat**
- `join_channel`
- `send_message` → emits `receive_message` to channel room
- `message_edited` → emits `message_edited`
- `message_deleted` → emits `message_deleted`
- `message_reply` → emitted when `send_message` includes `reply_to`

**DM Chat**
- `join_dm`
- `send_dm` → emits `receive_dm`

**Notifications**
- `join_notifications`
- `send_notification` → emits `receive_notification`

**Typing Indicators**
- `typing` → emits `user_typing`
- `stop_typing` → emits `user_stop_typing`

**Unread**
- `unread_update` → emits updated counts
- `mark_channel_read`
- `mark_dm_read`

### 11.4 Realtime Flow Details
**Message Send**
- Client emits `send_message` → server broadcasts `receive_message`
- If `reply_to`, server emits `message_reply`
- Server updates unread counts for channel members

**Message Edit**
- REST update → client (or server) emits `message_edited`
- Channel receives updated payload

**Message Delete**
- REST update → client (or server) emits `message_deleted`

**Unread Updates**
- Triggered after message/DM operations and read events

---

## 12) Database Schema (Observed + Inferred)

> **Note:** `database/schema.sql` contains only an `ALTER TABLE` for `messages.is_read`. The full schema is inferred from controllers and docs and should be verified/expanded.

### 12.1 users
- `user_id` (PK)
- `name`
- `email` (unique)
- `password_hash`
- `created_at`

### 12.2 workspaces
- `workspace_id` (PK)
- `name`
- `description`
- `owner_id` (FK users)
- `created_at`

### 12.3 workspace_members
- `member_id` (PK)
- `workspace_id` (FK workspaces)
- `user_id` (FK users)
- `role` ENUM(`owner`,`admin`,`member`)

### 12.4 channels
- `channel_id` (PK)
- `workspace_id` (FK workspaces)
- `name`
- `description`
- `created_at`

### 12.5 messages
- `message_id` (PK)
- `channel_id` (FK channels)
- `sender_id` (FK users)
- `message_text`
- `is_read` BOOLEAN DEFAULT FALSE
- `is_edited` BOOLEAN DEFAULT FALSE
- `is_deleted` BOOLEAN DEFAULT FALSE
- `reply_to` INT NULL (FK messages.message_id)
- `created_at`

### 12.6 direct_messages
- `direct_message_id` (PK)
- `sender_id` (FK users)
- `receiver_id` (FK users)
- `message_text`
- `is_read` BOOLEAN DEFAULT FALSE
- `created_at`

### 12.7 tasks
- `task_id` (PK)
- `workspace_id` (FK workspaces)
- `assigned_to` (FK users)
- `created_by` (FK users)
- `title`
- `description`
- `status` ENUM(`pending`,`in_progress`,`completed`)
- `priority` ENUM(`low`,`medium`,`high`)
- `due_date`
- `created_at`

### 12.8 notifications
- `notification_id` (PK)
- `user_id` (FK users)
- `message`
- `type` ENUM(`message`,`task`,`workspace`)
- `is_read` BOOLEAN DEFAULT FALSE
- `created_at`

### 12.9 activity_logs (mentioned in docs)
- **Not implemented in controllers**
- Recommended fields:
  - `log_id`, `workspace_id`, `user_id`, `action`, `metadata`, `created_at`

---

## 13) API Reference (Current)

### Auth
- `POST /api/auth/register`
- `POST /api/auth/login`

### Workspaces
- `POST /api/workspaces/create`
- `GET /api/workspaces/my-workspaces`

### Channels
- `POST /api/channels/create`
- `GET /api/channels/workspace/:workspaceId`

### Messages
- `POST /api/messages/send`
- `GET /api/messages/channel/:channelId`
- `PUT /api/messages/edit/:messageId`
- `DELETE /api/messages/:messageId`

### Direct Messages
- `POST /api/direct-messages/send`
- `GET /api/direct-messages/chat/:receiverId`

### Tasks
- `POST /api/tasks/create`
- `GET /api/tasks/workspace/:workspaceId`
- `PUT /api/tasks/status/:taskId`

### Notifications
- `POST /api/notifications/create`
- `GET /api/notifications/my-notifications`
- `PUT /api/notifications/read/:notificationId`

### Unread
- `GET /api/unread/count`

### Search
- `GET /api/search?q=...`

### Files
- `POST /api/files/upload`

---

## 14) Frontend Requirements (React)

### 14.1 Core Structure
- **Auth pages:** login, register
- **Workspace shell:** sidebar + main panel
- **Channel view:** message list, composer, thread/replies
- **DM view:** conversation list + chat window
- **Task view:** list + status controls
- **Notifications panel:** list + read actions
- **Search UI:** global search with grouped results

### 14.2 Realtime Integration
- Connect Socket.io on login
- Join rooms:
  - `user_{userId}` for unread counts
  - `channel_{channelId}` when channel opened
  - `dm_{userA}_{userB}` when DM opened
  - `notification_{userId}` for live notifications
- Handle events:
  - `receive_message`, `message_edited`, `message_deleted`, `message_reply`
  - `receive_dm`
  - `user_typing`, `user_stop_typing`
  - `online_users`
  - `unread_update`

### 14.3 Message UX
- Inline edit form for own messages
- Soft delete UI showing `[deleted]`
- Reply threading support (reply_to mapping)

### 14.4 Unread Badges
- Display per-channel unread counts
- DM unread badge
- Notifications unread badge
- Total unread aggregated for nav header

---

## 15) Production Readiness Notes

### Present
- JWT auth, role enforcement
- Basic error handling
- Socket.io and REST separation

### Missing / Gaps
- **Schema definition incomplete:** `database/schema.sql` lacks table creation statements.
- **Activity logs not implemented** despite docs.
- **Message pagination** missing (can grow large).
- **Rate limiting / abuse protection** not present.
- **Request validation** basic (no schema validation library).
- **File storage** is local; no S3 or CDN integration.
- **Audit trails** not implemented for edits/deletes.
- **Search** lacks workspace scoping and pagination.
- **Notifications** are created via API only (no server-side triggers).

---

## 16) Recommended Next Steps

1. Add full SQL schema with migrations (users/workspaces/channels/messages/tasks/etc.).
2. Add pagination for messages, DMs, notifications, and search.
3. Implement activity logs & server-side event triggers.
4. Add websocket auth and token verification on connection.
5. Add message edit/delete socket emits from server after REST update (optional).
6. Add workspace member management endpoints (invite/remove/update role).
7. Move file uploads to cloud storage and signed URLs.

---

## 17) Environment Variables

- `PORT`
- `DB_HOST`
- `DB_USER`
- `DB_PASSWORD`
- `DB_NAME`
- `JWT_SECRET`
