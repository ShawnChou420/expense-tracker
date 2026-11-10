# Expense Tracker API

Spring Boot 4, Spring Security, Flyway and PostgreSQL. Vue never connects to PostgreSQL directly. Every private API derives its owner from the bearer token, not a client-supplied user ID.

## Database status

Before the 2026-09-29 upgrade, the inspected `public` schema had six tables and no migration history: `user_info`, `salary_setting_info`, `work_shift_info`, `expense_record`, `sal_job_rate_info`, and `sal_shift_txn`. The first four are reused; the two `sal_*` tables remain untouched because their UUID owner model does not match `user_info.seq`. All six were empty at inspection time. Existing unowned rows, if later found, must be reviewed separately and are never assigned to a new account automatically.

`V1__legacy_foundation.sql` creates the four reused tables on a new database. Existing six-table databases must pass the explicit `baselineExisting` schema check, be baselined at V1, and then run V2 onward. V2 adds member-owned ledger tables and columns. V3 adds trip charge status. V4 enforces one salary setting row per member. `baseline-on-migrate` is disabled; startup must not silently adopt an unknown schema.

The confirmed local development database `expense_tracker` was explicitly baselined at V1 and migrated through V4 on 2026-09-29. All four Flyway entries succeeded. The pre-upgrade backup is at `/Users/choushaoyu/Documents/ExpenseTrackerBackups/expense_tracker_before_upgrade_20260929_180339.dump` (owner-only permissions). The original six tables were retained. V5 adds member-owned leave blackout dates; it has not been verified against the local database because PostgreSQL was unavailable during implementation.

## Local development

Use Java 21 and PostgreSQL. Set environment variables without committing their values:

| Variable | Meaning |
| --- | --- |
| `DB_URL` | JDBC URL for the intended database |
| `DB_USER` | PostgreSQL role |
| `DB_PASSWORD` | Optional database password; omit when local trust auth is used |
| `API_PORT` | API port, default `8080` |
| `CORS_ORIGINS` | Comma-separated exact frontend origins; production must use its own HTTPS origin |
| `DATABASE_URL` | Cloud-style `postgresql://user:pass@host:port/db` URL (e.g. Neon, entered in the Render dashboard). Used only when `DB_URL` is unset |
| `PORT` | Port injected by Render (default `10000`); takes precedence over `API_PORT` |
| `DB_POOL_SIZE` | Maximum JDBC pool size, default `5` |
| `VITE_API_BASE_URL` | Frontend API base URL. Web dev uses `/api` proxy when unset; native app requires a reachable HTTPS URL ending in `/api` |

For a **new empty development database**, run `bash backend/gradlew bootRun` from the repository root after setting `DB_URL` and `DB_USER`; Flyway applies V1 onward. In another terminal run `npm run dev`. The Vite proxy forwards `/api` to `127.0.0.1:8080`.

For the **already migrated local database**, start the Java API from the repository root:

```sh
DB_URL=jdbc:postgresql://localhost:5432/expense_tracker DB_USER=choushaoyu bash backend/gradlew bootRun
```

Then run `npm run dev` for Vue if it is not already running. Browser requests go from Vue to `/api`, through the Vite development proxy, to Java on port 8080; only Java connects to PostgreSQL. The backend must remain running while using member features. Restarting the app does not require another baseline or migration.

For an **existing six-table development database**, first verify its schema and make a backup, then set `DB_URL` and `DB_USER` for the specific database and run `bash backend/gradlew baselineExisting`. Only after inspecting its output, run `bash backend/gradlew bootRun` to apply V2 onward. Do not run this against an unconfirmed or production database. A destructive change or data reassignment requires separate review.

Run checks with `bash backend/gradlew test`, `npm run test`, `npm run lint`, `npm run typecheck`, `npm run format:check`, and `npm run build`.

## API and security

`POST /api/auth/register`, `POST /api/auth/login`, `POST /api/auth/logout`, and `GET /api/auth/me` provide email/password membership. The API issues a random 12-hour bearer credential; only its SHA-256 digest is stored in `auth_session`. Logout revokes it. Passwords use Spring Security's delegating password encoder. The frontend keeps the credential in memory only and does not use cookies or `localStorage`; reloading requires login again. Because authentication is through an explicit Authorization header and cookies are omitted, CSRF is disabled. CORS uses an exact allowlist.

Member APIs: `/api/work-records`, `/api/leave-blackouts`, `/api/salary-rates`, `/api/salary-deposits`, `/api/passengers`, `/api/trips`, `/api/expenses`, `/api/dashboard-settings`; trip charges and expenses also have payment endpoints, and dashboard settings include display currency. Leave blackouts are separate from work shifts and never change salary calculations. Monetary data is integer AUD cents or precise legacy decimal. Work date, trip date, settlement date, and salary deposit date remain distinct. Partial trip payments are summed once and cannot exceed the agreed fare. Recurring expense templates and actual payments are separate. The expense page groups due items by due week; the Dashboard uses actual payment dates for cash flow.

Guest payroll simulation continues without login, only in memory. Signing in offers to import the current guest data and skips matching client IDs; the import is not yet an atomic batch. Member records persist in PostgreSQL. Signing out restores the isolated guest view. Do not use guest data or an estimated `grossPay` as actual deposited salary.

## Deployment

Render deployment (Blueprint `render.yaml`, `backend/Dockerfile`, health check `GET /api/health`) is documented in `backend/DEPLOY_RENDER.md`.

## Before production

Email verification, password reset through a real mail provider, distributed login rate limiting, HTTPS hosting, secure database credentials, backups/restore drill, audit monitoring, and a reviewed deployment-specific CORS allowlist are still needed. Android login is unavailable until `VITE_API_BASE_URL` points to a reachable HTTPS API and the app is rebuilt/synced. Do not distribute a build with a development API URL.
