# Notification Lab

Learn Firebase Cloud Messaging (FCM) with a React admin dashboard, a NestJS API,
and an Expo Android app. Users authenticate with Amazon Cognito; notification
records, device registrations, and delivery attempts are stored in PostgreSQL.

```text
 React web + service worker ---- Cognito ID token ----+
    Firebase installation ID                           |
                                                        v
 Expo Android development build -- Cognito ID token --> NestJS API
    Native Android FCM token                            |       |
                                                        v       v
                                                PostgreSQL    Firebase Admin
                                                 (Docker)      SDK -> FCM
```

The server verifies tokens from the configured web and Android Cognito app
clients. Admin access comes only from the verified token's configured Cognito group claim.
Users appear in the dashboard after their first authenticated API request.

## Prerequisites

- Node.js 24, npm, and Docker with the Compose plugin.
- A Cognito user pool with email sign-up and two **public** app clients (no
  client secrets), one for web and one for Android.
- One Firebase project containing a web app and an Android app, plus its Admin
  service-account JSON. Enable the FCM HTTP v1 API and FCM Registration API.
- An Expo account and a physical Android device for the end-to-end mobile test.
  Expo Go cannot receive Android remote notifications for this SDK; use a
  development build. iOS is intentionally unsupported.

## Configuration

Each directory has an `.env.example` with a comment for each value. Local `.env`
files and Firebase JSON files are ignored by Git. Copy an example when starting
from a fresh checkout; do not put service-account keys in source control or
paste them into chat.

| File | What to supply |
| --- | --- |
| `.env` | `POSTGRES_USER`, `POSTGRES_PASSWORD`, database name, and localhost ports. |
| `server/.env` | `DATABASE_URL`, exact `CORS_ORIGINS`, Cognito region/pool, allowed app-client IDs, exact `COGNITO_ADMIN_GROUP`, and `FIREBASE_SERVICE_ACCOUNT_PATH`. |
| `client_web/.env` | API URL, web Cognito client ID and Firebase web config, and the **public** Web Push VAPID key. Analytics is not enabled. |
| `client_app/.env` | LAN-reachable API URL, Android Cognito client ID, and the Android package registered in Firebase. `EAS_PROJECT_ID` is filled after EAS initialization. |
| `client_app/google-services.json` | Download the Android app configuration from the same Firebase project. |

Use a dedicated local database password. For example, after setting the root
values, `DATABASE_URL` has this shape (URL-encode special characters in the
username/password):

```text
postgresql://USERNAME:PASSWORD@127.0.0.1:5432/notifications
```

For the server credential, in Firebase Console open **Project settings → Service
accounts → Generate new private key**. Save the JSON as
`server/.secrets/firebase-service-account.json`, or set
`FIREBASE_SERVICE_ACCOUNT_PATH` to its private local path. The server reads this
file on startup and fails clearly if it is absent or invalid. It is different
from `google-services.json`; never upload the Admin key to the mobile app or EAS.
Restrict the Firebase web API key to your intended web origins where applicable.

In Cognito, enable self-service email sign-up, email verification, and the
password/SRP authentication flow for both public app clients. Allow the `email`
attribute to be read by the clients. Set `COGNITO_ADMIN_GROUP` to the exact,
case-sensitive group name (`ADMIN` in the supplied setup) and add the intended
administrator in the AWS console. Sign out and back in after
changing groups. The clients use Amplify's Cognito API flow, so the console's
managed-login quick-start code, callback URLs, and example token display are not
required for this implementation.

Web sign-up requires a phone number and a matching password confirmation. A
10-digit Indian number is sent to Cognito with the `+91` country code; other
numbers must include their international country code. The web Cognito app
client must have permission to write `phone_number`. Cognito chooses whether
the sign-up code goes by email or SMS according to the user-pool verification
settings; the form shows the channel returned by Cognito.

## Start PostgreSQL

From the repository root, after filling in `.env`:

```sh
docker compose up -d
```

```sh
docker compose ps
```

```sh
docker compose logs -f postgres
```

To start the optional Adminer UI on `http://localhost:8080`:

```sh
docker compose --profile tools up -d
```

Adminer connects to the host `postgres` using the root `.env` database values.
To use `psql`, find the container name with `docker compose ps`, then replace
the placeholders:

```sh
docker exec -it <postgres-container> psql -U <POSTGRES_USER> -d notifications
```

Stopping services keeps the named volume and its data:

```sh
docker compose down
```

The following **deletes the local database volume and all its data**:

```sh
docker compose down -v
```

PostgreSQL 18 stores its version-specific data under the named volume mounted at
`/var/lib/postgresql`; restarting or recreating the container preserves it.

If Docker Compose cannot access the daemon in a restricted environment but
`docker run` can, the local fallback container is named
`notifications-postgres-dev` and stores its data in the separate
`notifications_learning_pgdata` volume. Manage it with `docker start` and
`docker stop`. Stop it before starting the Compose service on port 5432; Compose
uses a different volume, so data does not move automatically between them.

## Run the API and web app

In a server terminal:

```sh
cd server
```

```sh
npm ci
```

```sh
npm run migrate
```

```sh
npm run dev
```

The migration runner applies numbered SQL files once, each in a transaction.
The unauthenticated `GET http://localhost:3000/health` checks PostgreSQL.

In a separate web terminal:

```sh
cd client_web
```

```sh
npm ci
```

```sh
npm run dev
```

Open `http://localhost:5173`. Browsers require HTTPS or localhost for service
workers and push; a plain HTTP LAN address is not a secure web origin. Add any
additional exact web origins to `CORS_ORIGINS` in `server/.env`.

## Android development build

In a separate terminal:

```sh
cd client_app
```

```sh
npm ci
```

Set `EXPO_PUBLIC_API_URL` in `client_app/.env` to the computer's LAN address,
for example `http://192.168.1.20:3000`, and keep the phone and computer on a
reachable network. `localhost` on the phone means the phone, not your computer.
The API listens on all interfaces for this reason; allow only the access you
intend through your firewall. Release/preview builds do not allow cleartext
HTTP, so configure an HTTPS API/tunnel for the preview profile.

Sign in to Expo and initialize or link a project:

This workspace currently has no accessible Git repository. If you are using it
without Git, enable EAS's No VCS workflow in the app terminal before the EAS
commands. `client_app/.gitignore` excludes the local env and Android JSON from
that upload; the EAS file variable supplies the JSON to the builder.

```sh
export EAS_NO_VCS=1
```

```sh
npx eas-cli@27.2.0 login
```

```sh
npx eas-cli@27.2.0 init
```

If EAS cannot edit the dynamic `app.config.ts`, copy the project ID it reports
into `EAS_PROJECT_ID` in `client_app/.env`. Also set the same plain-text value in
the EAS `development` and `preview` environments. In each EAS environment set
`ANDROID_PACKAGE_NAME` and the four `EXPO_PUBLIC_*` variables from the app's
`.env`; use an HTTPS `EXPO_PUBLIC_API_URL` for preview. Public app variables are
embedded in the app and must never contain secrets.

Upload the gitignored Android Firebase file as an EAS **file** variable for each
profile, rather than committing it:

```sh
npx eas-cli@27.2.0 env:set development --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret
```

```sh
npx eas-cli@27.2.0 env:set preview --name GOOGLE_SERVICES_JSON --type file --value ./google-services.json --visibility secret
```

Build and install the development APK using the link or QR code returned by EAS:

```sh
npx eas-cli@27.2.0 build --platform android --profile development
```

Start Metro and open the installed development build:

```sh
npm run dev
```

An internal preview APK can be built separately:

```sh
npx eas-cli@27.2.0 build --platform android --profile preview
```

## Tests

Run `npm run build`, `npm run lint`, and `npm test` in each of `server`,
`client_web`, and `client_app`. The web browser test is:

```sh
npm run test:e2e
```

It uses local Chrome if available; otherwise install Playwright's Chromium or
set `CHROME_PATH`. PostgreSQL integration tests need a **dedicated test
database** with `TEST_DATABASE_URL`; they create and remove only their own
records, apply migrations, and use a mocked Firebase sender:

```sh
npm run test:integration
```

Alternatively, pass an isolated Compose-style env file containing
`POSTGRES_USER`, `POSTGRES_PASSWORD`, `POSTGRES_DB`, and `POSTGRES_PORT`:

```sh
npm run test:integration -- /path/to/test-compose.env
```

## Manual end-to-end check

1. Sign up and confirm a normal web user. Enable notifications and inspect the
   `device_tokens` table for an active `web` registration.
2. Install the Android development build on a physical device. Sign in with a
   second user, enable notifications, and inspect its active `android` row.
3. Sign in as an administrator, enable notifications, and send to **All**.
   Verify the browser system notification while the page is open; send again with the tab backgrounded and
   verify the system notification and its click action. Check Android in the
   foreground, background, and normally terminated states; tapping shows data.
4. Send to one selected user, then to Android only, and verify the recipients.
5. Revoke browser permission and revisit the app; verify it attempts to
   deactivate the stored registration. A revoked browser permission does not
   guarantee an immediate FCM invalid-token response; the mocked integration
   test covers the invalid-registration deactivation path.
6. Sign out on web, send again, and verify that registration is inactive.
7. Retry a send with the same idempotency key and verify only one notification
   exists. A non-admin request to any admin endpoint must return 403.

## Troubleshooting and limits

- A missing configuration value or service-account file stops API startup.
  Check `server/.env`, the private JSON path, and the PostgreSQL health check.
- Verify the device's Firebase project, package name, public VAPID key, FCM
  APIs, service worker, notification permission, and network access if no push
  arrives. Android force-stopped from system settings must be reopened.
- A device can be offline or block notifications after FCM accepts a request.
  `sent` means **accepted by FCM**, not confirmed display. FCM does not
  guarantee delivery order. A network failure after acceptance can still cause
  a duplicate on retry despite request idempotency.
- Device deletion on offline sign-out is best effort: the server may retain a
  registration until the same user reconnects, it is reassigned, or it is
  deactivated as stale after 60 days. Do not put sensitive content in pushes.
- Cognito group changes take effect when a new ID token is issued; existing
  tokens can retain old group claims until expiry. ID tokens are used here for
  the email and group claims; production APIs should carefully evaluate the
  access-token/scopes authorization model.
- The in-process worker, in-memory rate limiter, and startup reconciliation
  assume **one server process**. On restart pending/sending jobs are marked
  interrupted rather than silently resent. The Admin SDK may retry internally
  in addition to the application's three attempts.

For production, use a durable queue such as SQS or BullMQ, a managed database
such as RDS, a secrets manager, shared rate limiting, observability and alerts,
delivery analytics, carefully designed FCM topics, and a token-retention policy
suited to the application.

The most recent `npm audit --omit=dev` found no web production advisories after
the scoped gRPC override. It also reported moderate `glob`/`minimatch`
advisories in Firebase Admin's optional, unused Firestore dependency tree and
in Expo's build tooling. The app does not use Firestore. Recheck advisories as
upstream packages change; avoid forcing incompatible major versions into the
Expo SDK or using its build tools on untrusted project files.
