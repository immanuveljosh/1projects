# OfficeChat Mobile (Flutter Android) Integration Guide

This document defines the integration contracts for building the Flutter mobile client against the OfficeChat backend. The backend is 100% platform-agnostic with no web-specific dependencies.

---

## 1. Authentication Flow

### Token Model
- **Access Token**: JWT containing `user_id`, `email`, `role` (valid for 15 minutes).
- **Refresh Token**: Cryptographically secure opaque string (valid for 7 days, stored hashed with SHA-256 in PostgreSQL).
- **Token Rotation**: Each refresh request invalidates the old refresh token and issues a fresh one.

### Recommended Mobile Storage
Store tokens using `flutter_secure_storage` (Android Keystore / iOS Keychain).

### HTTP Interceptor Flow (e.g., using `Dio` in Flutter)
```dart
class AuthInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    final accessToken = await SecureStorage.getAccessToken();
    if (accessToken != null) {
      options.headers['Authorization'] = 'Bearer $accessToken';
    }
    handler.next(options);
  }

  @override
  void onError(DioException err, ErrorInterceptorHandler handler) async {
    if (err.response?.statusCode == 401) {
      final refreshToken = await SecureStorage.getRefreshToken();
      if (refreshToken != null) {
        final newTokens = await refreshTokens(refreshToken);
        if (newTokens != null) {
          // Retry failed request with new access token
          final retryOptions = err.requestOptions;
          retryOptions.headers['Authorization'] = 'Bearer ${newTokens.accessToken}';
          final response = await dio.fetch(retryOptions);
          return handler.resolve(response);
        }
      }
      // Logout and navigate to login screen if refresh fails
      await SecureStorage.clear();
    }
    handler.next(err);
  }
}
```

---

## 2. WebSocket Protocol & Event Contracts

### Connection
- **Endpoint**: `ws://<host>:8080/ws?token=<ACCESS_TOKEN>`
- **Query Parameter**: Supply active JWT access token in the `token` query param.
- **Auto-reconnect**: Flutter client should implement exponential backoff (e.g. 1s -> 2s -> 4s -> max 30s).
- **Heartbeat**: Client sends `{"type": "ping"}` every 30 seconds; server replies `{"type": "pong"}`.

### Inbound Events (Server -> Client)

All WebSocket events follow this JSON structure:
```json
{
  "type": "<event_name>",
  "data": { ... },
  "timestamp": "2026-10-26T12:00:00Z"
}
```

#### Event Catalog
1. **`message.new`**: A new message was posted in a channel or DM.
   ```json
   {
     "type": "message.new",
     "data": {
       "id": "uuid",
       "workspace_id": "uuid",
       "channel_id": "uuid",
       "sender_id": "uuid",
       "content": "Hello team!",
       "created_at": "2026-10-26T12:00:00Z",
       "sender": { "id": "uuid", "display_name": "Jane Doe", "avatar_url": "..." },
       "reactions": [],
       "attachments": []
     }
   }
   ```
2. **`message.updated`**: A message was edited.
3. **`message.deleted`**: A message was deleted (soft-deleted).
4. **`reaction.added`**: User reacted to a message.
   ```json
   {
     "type": "reaction.added",
     "data": {
       "message_id": "uuid",
       "user_id": "uuid",
       "emoji": "👍"
     }
   }
   ```
5. **`reaction.removed`**: User removed their reaction.
6. **`typing.start` / `typing.stop`**: Typing indicators for channel or DM.
   ```json
   {
     "type": "typing.start",
     "data": {
       "channel_id": "uuid",
       "user_id": "uuid",
       "user_name": "Jane Doe"
     }
   }
   ```
7. **`presence.update`**: A workspace user changed status (online, away, dnd, offline).
   ```json
   {
     "type": "presence.update",
     "data": {
       "user_id": "uuid",
       "status": "away",
       "custom_status": "In a meeting"
     }
   }
   ```
8. **`read.updated`**: Channel or DM unread count updated.
9. **`poll.created`**: Interactive poll created.
   ```json
   {
     "type": "poll.created",
     "data": {
       "id": "uuid",
       "question": "Lunch choice?",
       "total_votes": 0,
       "options": [{"id": "uuid", "option_text": "Pizza", "vote_count": 0}]
     }
   }
   ```
10. **`poll.voted`**: A user voted in a poll.
11. **`poll.closed`**: Poll voting finalized.
12. **`task.created`**: Task created (direct or from message).
13. **`task.updated`**: Task updated or marked completed.
14. **`notification.new`**: Real-time push notification for mentions, DMs, or replies.

### Outbound Events (Client -> Server)
- **Typing start**: `{"type": "typing.start", "channel_id": "uuid"}`
- **Typing stop**: `{"type": "typing.stop", "channel_id": "uuid"}`
- **Presence update**: `{"type": "presence.set", "status": "away", "custom_status": "In a client call"}`

---

## 3. Endpoints Matrix for Flutter App

### Authentication & Account
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/auth/register` | Register new user account |
| `POST` | `/api/v1/auth/login` | Login with email and password |
| `POST` | `/api/v1/auth/refresh` | Rotate access & refresh tokens |
| `POST` | `/api/v1/auth/logout` | Revoke session & purge device tokens |
| `GET`  | `/api/v1/auth/me` | Fetch active user profile |
| `PATCH`| `/api/v1/auth/me` | Update display name, avatar, or presence status |
| `POST` | `/api/v1/auth/change-password` | Change password (e.g., when `must_change_password` is true) |

### Device Tokens & Push Notifications
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/notifications/device-token` | Register/upsert device push token (`token`, `platform: android|ios|web`) |
| `DELETE`| `/api/v1/notifications/device-token?token=...` | Remove device token for authenticated user |
| `GET`  | `/api/v1/notifications` | List user notifications (`limit=50`) |
| `PATCH`| `/api/v1/notifications/{id}/read` | Mark single notification as read |
| `POST` | `/api/v1/notifications/read-all` | Mark all notifications as read |

### Workspaces
| Method | Endpoint | Description |
|---|---|---|
| `GET`  | `/api/v1/workspaces` | List user workspaces |
| `POST` | `/api/v1/workspaces` | Create workspace |
| `GET`  | `/api/v1/workspaces/{id}` | Get workspace details |
| `GET`  | `/api/v1/workspaces/{id}/members` | List workspace members |
| `POST` | `/api/v1/workspaces/{id}/invites` | Create workspace invite code |
| `POST` | `/api/v1/workspaces/join/{code}` | Join workspace with invite code |
| `GET`  | `/api/v1/workspaces/{id}/presence` | List member presence statuses |

### Channels & Messaging (Cursor Pagination)
| Method | Endpoint | Description |
|---|---|---|
| `GET`  | `/api/v1/workspaces/{id}/channels` | List channels in workspace |
| `POST` | `/api/v1/workspaces/{id}/channels` | Create channel |
| `GET`  | `/api/v1/channels/{id}` | Get channel details |
| `POST` | `/api/v1/channels/{id}/join` | Join channel |
| `POST` | `/api/v1/channels/{id}/leave` | Leave channel |
| `GET`  | `/api/v1/channels/{id}/messages` | Paginated messages (`cursor`, `limit=30`) |
| `POST` | `/api/v1/channels/{id}/messages` | Send message to channel |
| `PATCH`| `/api/v1/messages/{id}` | Edit message content |
| `DELETE`| `/api/v1/messages/{id}` | Soft-delete message |

### Direct Messages (DMs)
| Method | Endpoint | Description |
|---|---|---|
| `GET`  | `/api/v1/workspaces/{id}/dms` | List direct message conversations |
| `POST` | `/api/v1/workspaces/{id}/dms` | Start or find 1:1 or group DM |
| `GET`  | `/api/v1/dms/{id}/messages` | Paginated messages in DM (`cursor`, `limit=30`) |
| `POST` | `/api/v1/dms/{id}/messages` | Send message in DM |

### Reactions, Pins, & Read States
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/messages/{id}/reactions` | Add emoji reaction (`body: {"emoji": "👍"}`) |
| `DELETE`| `/api/v1/messages/{id}/reactions?emoji=...` | Remove emoji reaction |
| `POST` | `/api/v1/messages/{id}/pin` | Pin a message |
| `DELETE`| `/api/v1/messages/{id}/pin` | Unpin a message |
| `GET`  | `/api/v1/channels/{id}/pins` | List channel pinned messages |
| `GET`  | `/api/v1/dms/{id}/pins` | List DM pinned messages |
| `POST` | `/api/v1/channels/{id}/read` | Mark channel read |
| `POST` | `/api/v1/dms/{id}/read` | Mark DM read |

### Files & Search
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/workspaces/{id}/files/upload` | Multipart file upload (25 MB max) |
| `GET`  | `/api/v1/files/{key}` | Download or serve uploaded file |
| `GET`  | `/api/v1/workspaces/{id}/search?q=...` | Full-text search across messages & files |

### Polls & Tasks (REST is source of truth, WS notifies)
| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/v1/polls` | Create interactive poll with options |
| `GET`  | `/api/v1/polls/{id}` | Get poll summary & user vote status |
| `POST` | `/api/v1/polls/{id}/vote` | Cast or change vote on an option |
| `POST` | `/api/v1/polls/{id}/close` | Close poll and finalize voting |
| `POST` | `/api/v1/tasks` | Create task (optionally linked to `message_id`) |
| `GET`  | `/api/v1/workspaces/{id}/tasks` | List workspace tasks (`status`, `assigned_to`) |
| `PATCH`| `/api/v1/tasks/{id}` | Update task details or assignment |
| `POST` | `/api/v1/tasks/{id}/complete` | Mark task as complete |

---

## 4. Consistent Error Format
All errors return the standardized structure:
```json
{
  "error": {
    "code": "ERROR_CODE_STRING",
    "message": "Human-readable explanation of error"
  }
}
```
Common error codes: `UNAUTHORIZED`, `INVALID_CREDENTIALS`, `INVALID_REFRESH_TOKEN`, `VALIDATION_FAILED`, `NOT_FOUND`, `FORBIDDEN`, `RATE_LIMITED`.

