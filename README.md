# Household Garage

A self-hosted garage for one household: vehicle records, service history and receipts, fuel and MPG, maintenance reminders, tires and tread depth, and recorded costs. Built for phone use with a desktop import workflow.

Next.js, TypeScript, SQLite with Drizzle, and passkey sign-in. Each installation has its own database and household accounts. No personal records, credentials, receipts or original development history are included.

## Run locally

Use Node.js 24 and npm. SQLite's native dependency may need a compiler toolchain if a prebuilt binary is unavailable for your platform.

```sh
git clone https://github.com/devinlucashughes-sudo/household-garage.git
cd household-garage
npm ci
npm run user:add -- alex "Alex Example"
npm run auth:link -- alex
npm run dev
```

Open the setup link printed by `auth:link` at `http://localhost:3000` and create a passkey using a compatible browser and passkey provider. The link is a secret: it works once and expires after 24 hours. Do not paste it in issues or logs. Use `localhost`, not a LAN IP address, for local passkey setup. Use the same origin for setup and sign-in.

Add your first car through the app. Add another household member with `user:add` followed by `auth:link`. Everyone in an installation sees and edits the same garage. This is a single-household app, not a service that isolates several households. There is no public registration. Server access is required to create accounts and recovery links.

Local development creates `./data/garage.db`; no cloud services or credentials are required. To customize settings, copy `.env.example` to `.env.local`. Existing environment values override file values. No demo records are automatically inserted. Tests use synthetic fixtures.

## Data and integrations

- Vehicles, receipts, service records, fuel, maintenance and authentication state live in SQLite. Uploaded receipt bytes are included in database snapshots.
- Entering or retrying a VIN lookup sends that VIN to NHTSA vPIC. A lookup failure does not prevent saving a car.
- Google Drive backups are optional. Supply your own Google OAuth client and connect your own account in Settings. No original owner's account or shared Drive folder is used.
- Web push reminders are optional and require your own VAPID keys. Notifications pass through the browser's push provider.
- Desktop imports accept reviewed JSON and original files. Extraction happens outside this app; the app has no AI API dependency. See [desktop imports](docs/desktop-imports.md).
- Cost-only budget fuel history accepts a normalized JSON batch on stdin with `npm run import:budget-fuel -- --check` or `--apply`. See [budget imports](docs/budget-imports.md). It does not connect to a budgeting account.

## Host your own instance

Use a persistent Node.js server, Node 24, and writable disk storage. This app uses a local SQLite file and in-process reminder/backup scheduling; ephemeral serverless storage and multiple independent replicas are unsuitable. Run one application process against the database.

1. Set `DATABASE_PATH` to an absolute path on a persistent volume, such as `/data/garage.db`.
2. Set `APP_ORIGIN` to the exact public HTTPS origin, such as `https://garage.example.com`, and `TZ_NAME` to your household's IANA time zone.
3. Run `npm ci` and `npm run build`, then `npm start`. The server honors `PORT`.
4. Run `user:add` and `auth:link` on the server against the same database and origin. Open the generated link to register your production passkey.

Do not reuse a local passkey or database as a deployment shortcut. Passkeys belong to the origin where they were created. Keep `.env*`, databases, backup files, receipts and setup links private. The app migrates its database at startup; take a backup before upgrades.

### Optional Drive backups

Create your own Google OAuth web client with redirect URI `<APP_ORIGIN>/api/google/callback`. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` privately, restart, and connect Drive in Settings. Google account consent and application publishing requirements must be handled in your own Google Cloud project. Use an account/consent configuration that permits lasting refresh access if you rely on scheduled backups.

The app requests `drive.file`, creates `Household Garage Backups`, and retains `household-garage-latest.db` and `household-garage-previous.db`. A running production server checks weekly backup eligibility. Use Settings to back up on demand. Verify a backup with `npm run backup:check`. To restore, run `npm run restore:stage`, then restart the server. Staging does not replace the live database until restart; the old database is moved into a recovery directory. Changes since the selected backup will be lost. Keep an independent backup before restoring.

Backups contain vehicle data, receipts and authentication state, including any Drive refresh token. Treat them as secrets. This public edition has a separate migration lineage from the original private app; do not import its private production database or backups.

### Optional reminders

Generate keys with `npx web-push generate-vapid-keys`. Store `VAPID_PUBLIC_KEY` and `VAPID_PRIVATE_KEY` in your server environment; `VAPID_SUBJECT` optionally supplies a contact URL or `mailto:` address. Restart, then enable reminders in Settings on each device. Changing keys requires re-enabling reminders. On supported iPhones, install the app on the Home Screen first. Production scheduling requires the process to remain running.

## Development checks

```sh
npm run typecheck
npm run lint
npm test
npm run build
```

CI runs these checks on pull requests and pushes. Edit `src/lib/schema.ts` and use `npm run db:generate -- --name description` for schema changes. Commit generated SQL and migration metadata together. Do not rewrite published migrations.

## License and support

MIT, copyright Devin Hughes. The bundled Figtree font retains its [SIL Open Font License](src/app/fonts/LICENSE.md). This is a personal project shared as-is. See [SECURITY.md](SECURITY.md) for reporting concerns and [CONTRIBUTING.md](CONTRIBUTING.md) for changes. Do not submit household data or credentials in issues or pull requests.
