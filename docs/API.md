# API reference

Base URL for local development: `http://localhost:3000`. All routes except
`GET /health` require `Authorization: Bearer <Cognito ID token>`. The server
verifies the token's signature, expiry, issuer, `token_use=id`, and audience
against the configured web and Android app-client IDs. Admin routes require the
configured `COGNITO_ADMIN_GROUP` claim in that verified token. The group name is
case-sensitive. A missing or invalid token returns
401; an authenticated non-admin receives 403.

Errors use this shape (validation messages may be arrays):

```json
{"statusCode": 422, "error": "Unprocessable Entity", "message": "No active devices for this target", "requestId": "uuid"}
```

Each response has an `X-Request-Id` header. Default rate limiting is 100
requests per minute per IP; sends are limited to 5 per minute. Limits are local
to this one server process. A throttled request returns 429.

## Health and user

### `GET /health`

Public. Returns `200 {"status":"ok"}` when the PostgreSQL query succeeds, or
503 if the database is unavailable.

### `GET /me`

Creates or updates the local user from verified Cognito claims, refreshes their
email and role, and updates the last-login timestamp.

```json
{"id":"11111111-1111-4111-8111-111111111111","email":"user@example.com","role":"user"}
```

## Devices

### `POST /devices`

Registers a browser Firebase installation ID (`web`) or native FCM registration
token (`android`). The `token` field retains its original API name for both
types. Registration is idempotent, reassigns a shared token to the current
user, and keeps at most 20 active registrations per user.

```json
{"token":"DEVICE_REGISTRATION","platform":"web"}
```

Returns `201 {"registered":true}`. Empty, whitespace-containing, or oversized
registration values and invalid platforms return 400.

### `DELETE /devices`

```json
{"token":"DEVICE_REGISTRATION"}
```

Returns 204 even when the token is unknown or belongs to another user. Only the
caller's registration is deactivated. Offline sign-out is best effort.

## Admin users

### `GET /admin/users?search=&page=1&limit=25`

Searches locally known user emails. Pages start at 1 and `limit` is 1–100.

```json
{
  "items": [{"id":"11111111-1111-4111-8111-111111111111","email":"user@example.com","role":"user","lastLoginAt":"2026-11-01T00:00:00.000Z","webDevices":1,"androidDevices":0}],
  "total":1,"page":1,"limit":25
}
```

## Admin notifications

Targets are `{"type":"all"}`, `{"type":"platform","platform":"web"}`
or `android`, and `{"type":"users","userIds":["UUID"]}` (up to 1,000
unique selected IDs). A user is skipped if they have no active device matching
the target. Unknown selected user IDs produce 422. `skippedUsers` is an array
of local user IDs.

### `POST /admin/notifications/preview`

```json
{"target":{"type":"platform","platform":"android"}}
```

Returns a snapshot of matching devices and users with at least one matching
device. A preview can contain zero devices; sending with zero returns 422.

```json
{"totalDevices":2,"totalUsers":1,"skippedUsers":["22222222-2222-4222-8222-222222222222"]}
```

### `POST /admin/notifications`

The `Idempotency-Key` header is required, printable ASCII, 1–128 characters,
and scoped to the authenticated creator. Retrying with the same key returns
the existing record with 200 and never schedules a second send. A new valid
request returns 202 after the notification and pending deliveries have been
committed; the response is not proof of device display.

```json
{
  "title":"Hello",
  "body":"A notification from the dashboard",
  "imageUrl":"https://example.com/image.png",
  "clickAction":"/updates",
  "data":{"category":"demo"},
  "target":{"type":"all"}
}
```

```json
{"id":"33333333-3333-4333-8333-333333333333","status":"pending","totalDevices":2,"skippedUsers":[]}
```

`title` and `body` are trimmed, nonempty, and limited to 100 and 500 characters.
Optional image URLs must be HTTPS. Click actions must be HTTPS or a relative
path beginning with one `/`; `http://localhost` is allowed in development.
Custom data is limited to 10 string values (256 characters each), with keys
matching `^[A-Za-z_][A-Za-z0-9_]{0,63}$`. FCM-reserved names and prefixes,
`clickAction`, and `notificationId` are rejected. The serialized message must
fit the conservative 4,000-byte budget. Validation errors are 400 or 422; an
invalid target, unknown user, unsafe URL, reserved key, oversized payload, or
zero matching devices produces 422 without creating a notification.

### `GET /admin/notifications?page=1&limit=25`

Returns a paginated history with target summary, creator email, status,
timestamps, and aggregate `sent`, `failed`, and `pending` device counts.
`sent` means FCM accepted the request, not that the device displayed it.

```json
{"items":[{"id":"33333333-3333-4333-8333-333333333333","title":"Hello","targetType":"all","targetPlatform":null,"status":"completed","totalDevices":2,"createdAt":"2026-11-01T00:00:00.000Z","creatorEmail":"admin@example.com","sent":2,"failed":0,"pending":0}],"total":1,"page":1,"limit":25}
```

### `GET /admin/notifications/:id`

Returns the notification, its target, skipped users, and delivery records with
email, platform, status, error code, attempt count, sent time, and only the last
six registration characters (`tokenLast6`). An invalid UUID returns 400; an
unknown UUID returns 404. Raw registrations and bearer tokens are never returned.

```json
{"id":"33333333-3333-4333-8333-333333333333","title":"Hello","body":"A notification","status":"partial","deliveries":[{"id":"44444444-4444-4444-8444-444444444444","email":"user@example.com","platform":"web","status":"failed","errorCode":"messaging/registration-token-not-registered","errorMessage":"Registration is no longer valid","attempts":1,"sentAt":null,"tokenLast6":"ABCDEF"}]}
```

Per-device results are updated in chunks of up to 500. Dead registrations are
deactivated, invalid payload errors do not deactivate registrations, transient
errors are retried with backoff, and authentication/configuration failures stop
the remaining work. Restarted pending/sending jobs are marked interrupted.
