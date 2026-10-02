# ATLAS INET Phase 2

Internal network asset and analysis application. The repository separates the React frontend and NestJS backend into `apps/frontend` and `apps/backend`.

## Run the full stack with Docker Compose

Requires Docker Compose. `.env.example` contains local-only values; copy it to `.env` and replace the password and Better Auth secret before use.

```powershell
Copy-Item .env.example .env
docker compose up --build
```

Open `http://localhost:8080`. Compose starts PostGIS, applies SQL migrations, starts the backend, then serves the frontend through Nginx. `/api/*` keeps the same public origin and is proxied to NestJS. Postgres data and uploaded files use named volumes.

Stop containers with `docker compose down`. This preserves database and file volumes. `docker compose down -v` deletes them.

## Local development (Docker database only)

For this mode, frontend and backend run on the host; Docker runs only PostGIS. This workspace has a local `.env` configured for Vite on port `5173` and PostGIS on `5433` (the machine already uses `5432`). `.env` is ignored by Git. When setting up another checkout, copy `.env.example` to `.env`, set a unique `POSTGRES_PASSWORD` and `BETTER_AUTH_SECRET`, set `BETTER_AUTH_URL=http://localhost:5173`, and keep the matching Vite origins in `TRUSTED_ORIGINS`.

Start only the database container:

```powershell
docker compose up -d db
docker compose ps db
```

Port `5433` is used because the current machine already has a PostgreSQL service on `5432`. Compose publishes the container only on `127.0.0.1`; `DATABASE_URL` in `.env` points the host backend to that port. If you change `POSTGRES_PORT`, change the port in `DATABASE_URL` to match.

In a backend terminal:

```powershell
Set-Location apps/backend
npm ci
npm run db:migrate
npm run start:dev
```

In another terminal, install the frontend dependencies once and run the frontend from the repository root:

```powershell
Set-Location apps/frontend
npm ci
Set-Location ../..
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api` to the local NestJS server on port `3000`. `.env` sets `BETTER_AUTH_URL` and `TRUSTED_ORIGINS` for this Vite origin. Backend commands load `apps/backend/.env` first, then the root `.env`.

Create an internal login account interactively; public signup stays disabled:

```powershell
Set-Location apps/backend
npm run user:create -- --email user@example.com --name "User Name"
```

The command prompts for a masked password and writes no credentials to logs. Use Node.js 22 or newer for local app commands. Stop local frontend/backend with `Ctrl+C`; stop only the database with `docker compose down` (this preserves its data volume).

For an all-in-Compose deployment, copy `.env.example` to `.env`; its `BETTER_AUTH_URL` is set for the web origin on port `8080`. If using the local `.env` with the full stack, change that value to `http://localhost:8080` first. Run the operator command inside the backend container:

```powershell
docker compose exec backend node dist/scripts/create-user.js --email user@example.com --name "User Name"
```

## Structure

```text
apps/
  frontend/
    src/app/                 # Router and providers
    src/components/          # Reusable cards, badges, empty states, and form status
    src/layout/              # AdminLTE application shell
    src/pages/               # Route pages
    src/shared/api.ts        # Shared Axios clients and all implemented API calls
    Dockerfile               # Vite build and Nginx runtime
  backend/
    src/config/              # Environment validation and loading
    src/common/              # API error response handling
    src/database/schema/     # Drizzle auth schema
    src/modules/auth/        # Better Auth handler, session guard, /me
    src/modules/health/      # Liveness/readiness endpoints
    src/database/migrate.ts  # Advisory-locked Drizzle migration runner
    drizzle/                 # Versioned SQL migrations
    src/scripts/             # Explicit operator commands
docs/
  architecture.md
```

Frontend components are presentation-focused and reusable across route pages. Add feature-specific components beside their page/feature rather than creating one large global component module. Backend features belong in separate Nest modules; keep HTTP/DTO handling in controllers, policies and orchestration in services, and SQL access in repositories. Database schema and ORM types stay server-side.

Frontend API URLs are cataloged in `apps/frontend/src/shared/api.ts` under `API_ENDPOINTS`, grouped from the Vite `VITE_API_BASE_URL` and `VITE_AUTH_BASE_URL` settings. The same file exports a reusable credentialed `axiosClient` and typed request wrappers. Authentication and health endpoints use the implemented backend; add business endpoints only after their server routes and policies exist.

## Current backend boundary

- `GET /api/v1/health/live` and `/api/v1/health/ready` provide liveness and PostGIS readiness.
- Better Auth serves `/api/auth/*`; email/password login is enabled, public signup is disabled, and `GET /api/v1/me` requires a valid session.
- All frontend application routes require a successful `/api/v1/me` session check; unauthenticated or unverifiable sessions are redirected to `/login`. This frontend gate is not a substitute for server-side authorization.
- Account creation is an explicit interactive operator command, not a public endpoint.
- No network, entity membership, booking, import, analysis, or reporting data/API exists yet. `/me` therefore returns empty entity and permission lists. Do not interpret that as role-based authorization being complete.
- Business routes must add server-enforced membership/permission checks, entity scoping, validation, audit, and transaction rules before they expose or mutate operational data.
- Geocoding, routing, business policy, and production access provisioning remain unconfigured until their decisions and trusted data sources are approved.

The current foundation is not production-ready by itself. Before deployment, set an HTTPS public URL, a unique secret, approved trusted origins, restricted proxy hops, backup/restore, and production database privileges. Production should separate migration and runtime database credentials.
