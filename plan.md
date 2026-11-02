# ROLE

You are a principal engineer with 20+ years at Google/Microsoft-class companies. You are an expert in NestJS, React, React Native/Expo, AWS Cognito, PostgreSQL, Docker and Firebase Cloud Messaging (FCM). You write production-grade, modular, well-tested code, and you think about edge cases, security and failure modes before writing code. This is a learning project, so keep the code readable and add short comments explaining *why* at the non-obvious FCM, auth and concurrency points.

# GOAL

Build a push-notification system to learn FCM end to end:
- A React web app (single page) and an Expo React Native Android app (single screen). Both show "Hello World" plus notification controls.
- Users sign up and sign in with AWS Cognito, grant notification permission, and their device token is registered with the server.
- A single admin (a Cognito group) uses a dashboard inside the same web app (role-based view) to send custom notifications to web and app users: all users, selected users, or by platform.
- A NestJS server stores everything in a local PostgreSQL running in Docker: users, device tokens, every notification sent, to whom, and per-device delivery results.

The admin dashboard and the server's send pipeline are the focus. The user web page and the app screen stay deliberately minimal.

# HARD CONSTRAINTS

- Repo has exactly three code folders: `client_web/`, `server/`, `client_app/`. Plus root `docker-compose.yml`, `README.md`, `.gitignore`, and `docs/`.
- Server: NestJS + TypeScript (strict). Web: React + Vite + TypeScript (strict). App: React Native + Expo + TypeScript (strict).
- Everything modular: feature modules, small files, no god-files, clear boundaries (controller → service → repository).
- NO ORM and NO query builder (no Prisma/TypeORM/Drizzle/Knex/Sequelize). Use the `pg` driver with parameterized raw SQL only, via thin repository classes. Never build SQL by string concatenation (for lists use `= ANY($1::uuid[])`).
- Migrations: plain numbered `.sql` files plus a small runner script. A `schema_migrations` table records applied files, and each migration runs in a transaction.
- No Redis, queue, or extra infrastructure. Auth is Cognito only. Push goes through Firebase Admin SDK (FCM HTTP v1) only.
- No heavy UI component library. Tailwind CSS is fine.
- Verify library APIs against current official docs (NestJS, firebase-admin, Firebase JS SDK, Expo SDK, expo-notifications, aws-amplify v6, aws-jwt-verify, EAS), not memory. Use current stable versions and pin them. If something here conflicts with current docs, follow the docs and record it in `docs/DECISIONS.md`.
- Never commit secrets. Never invent credentials. Use placeholders in `.env.example` files and read real values from `.env` files that I fill in.

# VALUES I WILL PROVIDE (create .env.example files listing them; tell me where each goes)

- Server: PORT, DATABASE_URL, CORS_ORIGINS (comma-separated), COGNITO_REGION, COGNITO_USER_POOL_ID, COGNITO_APP_CLIENT_ID, FIREBASE_SERVICE_ACCOUNT_PATH
- Web: VITE_API_URL, VITE_COGNITO_REGION, VITE_COGNITO_USER_POOL_ID, VITE_COGNITO_CLIENT_ID, VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID, VITE_FIREBASE_STORAGE_BUCKET, VITE_FIREBASE_MESSAGING_SENDER_ID, VITE_FIREBASE_APP_ID, VITE_FIREBASE_VAPID_KEY
- App: EXPO_PUBLIC_API_URL, EXPO_PUBLIC_COGNITO_REGION, EXPO_PUBLIC_COGNITO_USER_POOL_ID, EXPO_PUBLIC_COGNITO_CLIENT_ID, Android package name (must match the Firebase Android app), and `google-services.json` placed in `client_app/` (gitignored; provide `google-services.json.example`)
- Cognito has an `admin` group. Admins are created only by adding a user to this group in the AWS console; there is no admin-creation API.

# WORKING AGREEMENT

- Work in the phases below, in order. After each phase run build, lint and tests, then print a short status: what was built, how to verify it, and any decisions made.
- Stop and ask me only if you need a credential/config value or hit a decision not covered here. Otherwise decide, and log it in `docs/DECISIONS.md` (one line each: decision + reason).
- Do not skip edge cases. Each edge case below must be handled in code and, where practical, covered by a test.

# PHASE 0: Repo and Docker

1. Create the folder structure, root `.gitignore` (node_modules, .env*, service account JSON, google-services.json, build output, Docker volumes), root README skeleton.
2. `docker-compose.yml`: PostgreSQL (current stable major) with a named volume, healthcheck, credentials from env, port bound to `127.0.0.1` only. Add Adminer under a compose profile `tools`. In the README explain: `up -d`, `down`, `down -v`, `logs`, `psql` via `docker exec`, and what volumes do.
3. ESLint + Prettier configured per package. npm scripts: `dev`, `build`, `lint`, `test`.

# PHASE 1: Server foundation and auth

Modules: `config`, `database`, `auth`, `users`, `health`.

- `config`: validated env (zod or joi). Fail fast at boot with a clear message listing missing vars.
- `database`: injectable `pg` Pool; helper for transactions; graceful shutdown (`enableShutdownHooks`, `pool.end()`); migration runner (`npm run migrate`).
- Migration 001 (UUID PKs via `gen_random_uuid()`, `timestamptz` everywhere, FKs, CHECK constraints, indexes):
  - `users`: id, cognito_sub (unique), email, role ('user'|'admin'), last_login_at, created_at, updated_at. Index on lower(email).
  - `device_tokens`: id, user_id → users (cascade), token (unique), platform ('web'|'android'), user_agent, is_active, deactivated_reason, last_seen_at, created_at, updated_at. Partial index on (user_id) WHERE is_active.
  - `notifications`: id, created_by → users, idempotency_key (unique together with created_by), title, body, image_url, click_action, data jsonb, target_type ('all'|'users'|'platform'), target_user_ids uuid[], target_platform, status ('pending'|'sending'|'completed'|'partial'|'failed'), total_devices, created_at, started_at, completed_at.
  - `notification_deliveries`: id, notification_id → notifications (cascade), user_id (set null), device_token_id (set null), platform, status ('pending'|'sent'|'failed'), fcm_message_id, error_code, error_message, attempts, sent_at, created_at. Unique (notification_id, device_token_id). Index on (notification_id, status).
- `auth`:
  - Global `JwtAuthGuard` using `aws-jwt-verify`'s Cognito verifier. Verify signature, issuer, expiry, client ID and token_use. Clients send the Cognito **ID token** as `Authorization: Bearer` (it carries email and `cognito:groups`; note the tradeoff in the README).
  - `@Public()` decorator for open routes (only `/health`). `RolesGuard` + `@Roles('admin')`. The role comes ONLY from the verified token's `cognito:groups`. Never trust a role from the client or from the DB alone.
  - 401 for missing/invalid/expired token, 403 for authenticated but not admin. Do not leak verification internals in error messages.
- `users`: `GET /me` upserts the user by `cognito_sub` (atomic `INSERT ... ON CONFLICT DO UPDATE`), syncs email and role from the token, updates last_login_at, returns `{ id, email, role }`.
- `health`: `GET /health` checks the DB with `SELECT 1`.
- Global: ValidationPipe (whitelist, forbidNonWhitelisted, transform), `helmet`, CORS restricted to `CORS_ORIGINS`, `@nestjs/throttler` default limits, consistent error shape `{ statusCode, error, message, requestId }`, request-ID middleware, structured logging that never logs JWTs, full FCM tokens, or service-account contents (mask tokens to the last 6 chars).
- Tests: guard behavior (no token / expired / wrong client / non-admin / admin), `/me` upsert idempotency (two concurrent calls produce one row).

# PHASE 2: Devices, Firebase and the notification pipeline (core of the project)

Modules: `devices`, `firebase`, `notifications` (+ `admin/users` listing).

**devices**
- `POST /devices` `{ token, platform }`: idempotent upsert on `token`. If the token already belongs to a different user (shared browser/device), reassign it to the current user and set `is_active = true`. Update `last_seen_at`.
- `DELETE /devices` with body `{ token }`: deactivates (or deletes) only if the token belongs to the caller. Deleting an unknown token returns 204 (idempotent).
- Validate token length and platform; a user may have many tokens (cap at e.g. 20 active per user; oldest deactivated first).

**firebase**
- Initialize `firebase-admin` from `FIREBASE_SERVICE_ACCOUNT_PATH`. Fail fast if missing or invalid. Wrap messaging behind an interface so it can be mocked in tests.

**admin users listing**
- `GET /admin/users?search=&page=&limit=` (admin only): id, email, role, active device counts per platform, last_login_at. Limit max 100.

**notifications (admin only)**
- `POST /admin/notifications` with header `Idempotency-Key` (required):
  - Body: `title`, `body`, optional `imageUrl`, optional `clickAction`, optional `data` (string key/value map), `target: { type: 'all' | 'users' | 'platform', userIds?: uuid[] (max 1000), platform?: 'web' | 'android' }`.
  - Validation:
    - title ≤ 100 chars, body ≤ 500 chars, trimmed, non-empty.
    - `data`: ≤ 10 keys; key regex `^[A-Za-z_][A-Za-z0-9_]{0,63}$`; values are strings ≤ 256 chars. Reject reserved keys: `from`, `notification`, `message_type`, anything starting with `google` or `gcm`, plus our own `clickAction` and `notificationId`.
    - `clickAction`: only `https://` URLs (allow `http://localhost` when NODE_ENV=development) or a relative path starting with a single `/`. Reject `javascript:`, `data:`, protocol-relative `//`, and anything else. `imageUrl`: https only.
    - Reject if the serialized FCM message would exceed ~4000 bytes (FCM limit is 4096), with a 422 and a clear message.
  - Resolve target tokens: only `is_active` tokens for the target. Unknown userIds → 422 listing them. Users with no active devices are skipped and reported as `skippedUsers`. If total devices = 0 → 422 "no active devices for this target", and nothing is stored or sent.
  - In ONE transaction, insert the notification (status `pending`) plus one `pending` delivery row per token. Then respond **202** with `{ id, status, totalDevices, skippedUsers }` and process in the background (in-process async, errors caught and logged).
  - Idempotency: if (created_by, Idempotency-Key) already exists, return the original notification (200) and do NOT resend.
- Background sender:
  - Set status `sending`, `started_at`. Process tokens in chunks of 500 using `sendEachForMulticast` (confirm in current docs). Sequential chunks, not unbounded concurrency.
  - Message shape: top-level `notification` {title, body, imageUrl}; `data` {notificationId, clickAction (if any), ...custom, all strings}; `webpush.fcmOptions.link` = clickAction; `webpush` headers TTL (e.g. 24h); `android` priority high, ttl 24h, `notification.channelId = 'default'`.
  - Per-token result → update the delivery row (`sent` + fcm_message_id, or `failed` + error_code/message).
  - Error handling by code:
    - `messaging/registration-token-not-registered` and `messaging/invalid-registration-token`: mark delivery failed AND deactivate the token (`deactivated_reason`).
    - `messaging/invalid-argument`: mark failed, do NOT deactivate (our bug, log loudly).
    - Transient (`messaging/server-unavailable`, `messaging/internal-error`, `messaging/quota-exceeded`, network errors): retry only the failed tokens, up to 3 attempts with exponential backoff + jitter, honoring retry-after if available.
    - `messaging/third-party-auth-error`/auth/config failures: fail the whole notification quickly with a clear logged cause; do not hammer FCM.
  - Final status: all sent → `completed`; some → `partial`; none → `failed`. Set `completed_at`.
  - On server boot, mark notifications stuck in `sending` from a previous process as `failed` (reason: interrupted) so the UI never shows them as eternally sending.
- `GET /admin/notifications?page=&limit=`: history with sent/failed/pending counts (computed by aggregate query), status, target summary, creator email.
- `GET /admin/notifications/:id`: full details + deliveries (user email, platform, status, error_code, attempts, sent_at). Mask tokens (last 6 chars only). 404 for unknown ids; reject non-UUID ids with 400.
- Throttle `POST /admin/notifications` more tightly than other routes.
- Scheduled cleanup (`@nestjs/schedule`, daily): deactivate tokens with `last_seen_at` older than 60 days.
- Tests (unit with mocked Firebase, plus a few e2e against the Docker Postgres):
  - Chunking at 500/501 tokens; error classification; deactivation of dead tokens; partial vs failed vs completed status; idempotent replay; zero-device target; reserved data keys; clickAction rejection cases; payload-size rejection; token reassignment between users; 403 for a non-admin on every admin route.

# PHASE 3: Web client (React, single page)

Structure by feature: `features/auth`, `features/push`, `features/admin/{compose,targets,history}`, `lib/api`, `lib/firebase`, `lib/auth`. No router needed. The page renders conditionally: unauthenticated → auth card; authenticated → dashboard by role (role comes from `GET /me`; the server is the authority).

- Auth (aws-amplify v6 Auth, or `amazon-cognito-identity-js` if Amplify gives trouble; log in DECISIONS.md): sign up (email + password with visible password rules), confirm with code, resend code, sign in, sign out. Handle `UserNotConfirmedException` (route to the confirm step), wrong password, user exists, expired/incorrect code, and network errors with clear messages. API client: attach the ID token; on 401, refresh the session once and retry, otherwise sign out cleanly.
- **User view**: "Hello World" + a notification card with these states: `unsupported` (no Notification/ServiceWorker/PushManager, e.g. iOS Safari not installed to the home screen: explain), `default` (an "Enable notifications" button; request permission ONLY from a click, never on page load), `granted & registered`, `denied` (explain how to re-enable in browser settings; don't keep re-prompting), `registration failed` (retry button). Also a "Disable on this device" button (FCM `deleteToken` + `DELETE /devices`). Show the last 10 foreground messages (in memory) as a learning aid.
- Token lifecycle: after the user clicks Enable, `getToken` with the VAPID key and the registered service worker, then `POST /devices`. On every load when permission is already `granted`, silently re-fetch the token and re-register (refreshes last_seen_at and catches rotation). If permission is no longer `granted` but a token was stored locally, call `DELETE /devices` and clear it. On logout: `DELETE /devices` BEFORE signing out, and still sign out if that call fails.
- Service worker `public/firebase-messaging-sw.js`: initialize Firebase from config passed through the registration URL query string (config is public, not secret), using a pinned Firebase SDK version. Background messages with a `notification` payload are displayed by the SDK, and the click opens `fcmOptions.link`. Also handle `notificationclick` to focus an existing tab if one is open. Explain in comments why the SW can't use Vite env directly.
- Foreground: `onMessage` → in-app toast + list entry (render as plain text; never `dangerouslySetInnerHTML`).
- **Admin view** (single page, sections top to bottom):
  1. Header: email, role badge, sign out.
  2. "Enable notifications on this device" card, the same component as the user view, so the admin can test on their own device.
  3. Compose: title, body (character counters), optional image URL, optional click URL, custom data key/value rows (≤ 10, with validation matching the server), a live payload-size indicator, and a preview of how the notification will look.
  4. Targets: radio for All users / Specific users / By platform. For "Specific users": searchable, paginated user list (debounced search), checkboxes, per-user badges for web/android device counts, users with no devices shown but flagged "no devices".
  5. Send: a confirm dialog stating "This will send to N devices across M users". The button is disabled while sending. Generate the `Idempotency-Key` per compose session (new key after a successful send). Handle 422 (show the server message), 429 (rate limit), network failure (a retry with the SAME key), and 202 (show the result card).
  6. History: table (title, target, status, sent/failed counts, time) with an expandable row showing deliveries and error codes. Auto-poll every 2s while any visible notification is `pending`/`sending`, stop when finished, and stop polling when the tab is hidden.
- All views: loading, empty and error states; keyboard accessible; labels on inputs; responsive layout.

# PHASE 4: Expo Android app (single screen)

- Expo (current SDK), TypeScript, `expo-dev-client`, `expo-notifications`, `expo-device`, `expo-build-properties`, AsyncStorage for the auth session. Note in the README that Expo Go can't be used for push; a development build is required.
- One screen with conditional views: auth (sign in / sign up / confirm, same Cognito pool) → "Hello World" + push status card. No navigation library.
- Android flow, in this order:
  1. Require a physical device (`Device.isDevice`); show a message otherwise. iOS: show "unsupported in this project".
  2. Create the notification channel `default` (high importance) BEFORE requesting permission. On Android 13+ the permission prompt doesn't appear without a channel.
  3. `requestPermissionsAsync` only from a button tap. If denied with `canAskAgain === false`, show a button that opens app settings via `Linking.openSettings()`.
  4. `getDevicePushTokenAsync()` returns the native FCM token on Android. `POST /devices` with platform `android`.
- Token lifecycle: re-register on app start and on foreground (AppState) when permission is granted; `addPushTokenListener` to re-register on rotation; on logout: `DELETE /devices` first, then sign out (still sign out if the call fails).
- Notifications: `setNotificationHandler` so foreground notifications show a banner (use the field names of the installed SDK). Handle taps with `addNotificationResponseReceivedListener` AND `getLastNotificationResponseAsync()` for cold start, and show the last tapped notification's `data` on screen (there is no navigation, so just display/log `clickAction` and custom data).
- Config: `app.json`/`app.config.ts` with `android.package`, `android.googleServicesFile`, the notification channel/icon config, `usesCleartextTraffic` only for dev builds via expo-build-properties. Document the dev-device networking gotchas: `localhost` doesn't reach the dev machine from a phone, so use the LAN IP or an https tunnel, and release builds block cleartext HTTP.
- `eas.json` profiles: `development` (dev client, internal, APK), `preview` (internal, APK). Document the exact steps for: `eas init`, supplying the gitignored `google-services.json` to EAS builds (use EAS file-type environment variables/secrets per current docs), building the APK, installing it, and testing.

# PHASE 5: Hardening, docs, stretch

- README (root): architecture diagram (ASCII), prerequisites, one-command-per-step setup for Firebase + Cognito values, how to run each package, how to build the APK, the manual end-to-end test script below, troubleshooting, and a "what I'd do for production" section (queue such as SQS/BullMQ instead of in-process sending, managed DB such as RDS, secrets manager, observability, FCM topics, token cleanup tuning, Cognito group-change propagation delay up to the token lifetime).
- `docs/DECISIONS.md` and `docs/API.md` (every endpoint, request/response examples, error cases).
- Stretch (only after everything else passes): data-only messages for web (service worker builds the notification itself) as a comparison to notification messages; scheduled sends; a server Dockerfile (multi-stage) plus compose service under profile `full`; forgot-password flow.

# EDGE CASES CHECKLIST (all must be handled)

Permissions/tokens: permission denied/dismissed/revoked later; unsupported browser; HTTP (non-secure) origin; service worker registration failure; token rotation; same token used by two accounts on one browser; logout while offline; app reinstall (new token, old one expires); user with multiple devices; token never refreshed (60-day cleanup).
Delivery: zero recipients; some users with no devices; dead tokens; invalid payload; FCM outage (retry + backoff); quota errors; 500+ recipients; double-click/duplicate submit/retry after network drop (idempotency); server restart mid-send (stuck-sending reconciliation); very large `data`; non-string data values (rejected client- and server-side).
Auth/security: missing/expired/forged/wrong-audience token; non-admin hitting admin routes; admin removed from the group (effective after token expiry; documented); XSS via notification content; malicious `clickAction`; SQL injection (parameterized only); CORS; rate limiting; secrets and tokens in logs; token masking in admin responses.
UX: slow networks; polling cleanup; tab hidden; empty states; long titles/bodies; unconfirmed Cognito accounts; 401 mid-session.

# MANUAL END-TO-END TEST SCRIPT (put it in the README)

1. Sign up and confirm a normal user on web, enable notifications, check a row in `device_tokens`.
2. Sign in on the Android dev build with a second user, enable notifications, check the `android` token row.
3. Admin sends to "All": web gets it in the foreground (toast) and background (system notification, click opens the URL); the app gets it in the foreground, background and killed states, and tapping shows the data.
4. Admin sends to a single user, then to platform=android only. Verify only the right devices received it.
5. Revoke the web permission in the browser, send again, and confirm the failure/deactivation path in the history view and DB.
6. Log out on web, send, and confirm no delivery to that token.
7. Double-submit the same send: only one notification is created.
8. A non-admin calls an admin endpoint: 403.

# DEFINITION OF DONE

All phases built; lint/build/tests pass in all three packages; migrations run on a fresh Docker DB; the manual E2E script passes on a real browser and a real Android device; README lets a new developer run everything; no secrets in git; DECISIONS.md and API.md complete.

Start with Phase 0 and report back.