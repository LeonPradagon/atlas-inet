# Backend architecture

## Runtime boundary

The browser talks to one public origin. Nginx proxies `/api/*` without rewriting the path to the NestJS Express server. Nest serves business routes under `/api/v1`; Better Auth owns `/api/auth/*`. The server is the only application component that can connect to Postgres.

The applications are isolated in `apps/frontend` and `apps/backend`. Each owns its package manifest, lockfile, Dockerfile, and Docker ignore rules; root `docker-compose.yml` coordinates them. Reusable frontend presentation/domain elements live in `apps/frontend/src/components`; the endpoint catalog, Axios client, domain wrappers and transport-only types live under `src/shared`. Health-query state lives in `src/shared/api`.

Frontend `EntityScopeProvider` selects effective grants from `/me.entityAccess`, never the permission union or role names. React Query domain keys contain both user ID and entity ID. Entity changes remount domain workspaces and cancel/remove the previous scope's queries. Logout/private 401 clears domain cache; 401 resets session identity before revalidation. These UI checks do not replace server authorization. Maps fetch paginated GeoJSON for their current viewport with an explicit 1,000-feature display cap; exceeding it asks the user to zoom rather than claiming full coverage. See `docs/frontend-progress.md` for covered workflows and testing boundaries.

## Server modules

- `config`: validates environment once and supplies typed configuration.
- `database`: owns the `pg` pool and typed Drizzle connection. Readiness checks PostGIS, not only TCP connectivity.
- `auth`: owns the Better Auth configuration/handler and session verification. Public self-registration is disabled.
- `access`: owns entity-scoped roles, memberships, effective permissions, entity APIs and explicit local provisioning. `/me` exposes per-entity access; permissions are checked again server-side on each entity request. See `docs/backend-progress.md` for scope and commands.
- `network`: owns published viewport/GeoJSON/detail reads with canonical capacity snapshots. PostGIS validates geometry and owner/dataset relations.
- `capacity`: owns segment row locks, booking/Used/release/deallocation/expiry, idempotency and strict manual FIFO.
- `assets`, `imports`, `settings`: own metadata version checks, approved naming/history, immutable policy versions with independent maker–checker requests, and atomic KML/Excel merge publication. Only a permissioned non-requester can activate a matching current policy version; PostgreSQL guards also block legacy direct writes. Imports never delete missing assets or replace operational records.
- `analysis`: owns geodesic nearest queries and optional approved internal adapters. Missing providers/formula approval produce explicit incomplete results, not fabricated estimates.
- `jobs`: owns durable bulk/export, quota, lease fencing, cancellation, selective retry, row checkpoints and authorized XLSX results. Input/output snapshots are persisted in PostgreSQL for this baseline.
- `notifications`, `reports`, `audit`: own transactional outbox delivery/dedup, utilization snapshots and entity-scoped change history.
- `health`: exposes liveness and dependency-aware readiness.
- `common`: normalizes Nest exceptions into the API error envelope and request ID.

When adding domain features, create focused modules with controller, service, repository, DTOs and policies as needed. Controllers own transport concerns; services own domain invariants and transaction boundaries; repositories own queries. Do not place business behavior in controllers or share Drizzle schema with the frontend.

## Database lifecycle

`drizzle/` contains versioned SQL and generated metadata. The migration process takes a Postgres advisory lock on one connection before invoking Drizzle, then releases the lock even after migration failure. Compose does not start the server until migration succeeds. PostGIS is installed by a migration and provided by the `postgis/postgis` image.

The local Compose database user is shared by migration and runtime for convenience only. Production must use separate credentials and grant DDL/extension privileges only to the migrator.

## API and security rules

- Business responses use `{ data, meta? }`; errors use `{ error: { code, message }, requestId }`.
- Cookie-authenticated unsafe business methods require an allowed `Origin`; Better Auth validates its own trusted origins.
- Auth cookies are HttpOnly; Secure cookies are enabled when production uses an HTTPS public URL. Do not store session tokens in browser storage.
- The frontend redirects users without a valid `/me` session to `/login` before rendering application routes. This is a navigation guard, not an authorization boundary; backend guards and per-entity policies remain mandatory for every protected API.
- Trust proxy hops must match the actual proxy topology. Do not use wildcard trusted origins or expose the server port publicly.
- Entity IDs and client filters are never authorization. Domain endpoints must authorize scope on the server.
- Do not add example operational rows to make empty screens look populated.

## Worker and operational limits

`src/worker.ts` starts a separate Nest application context; it does not listen for HTTP. Run it through npm alongside the API, with Docker providing only PostGIS locally. A PostgreSQL advisory singleton lock serializes expiry, outbox and one job-row checkpoint per tick; a 30-second job lease and token fence reject stale writes. API/worker share domain services and must share the database. Worker pool size must be at least 2.

This is a correctness-first baseline, not a throughput SLA. Bulk provider calls are paced by `WORKER_INTERVAL_MS`; individual requests are not included in that quota. Reports are snapshotted on submit, exports currently cap at 10,000 segments. XLSX ZIP inspection bounds archive entries, compressed/expanded content, disallows external links/entities/encryption; input formulas/hyperlinks are rejected. No untrusted file path is written to disk.

Access administration remains CLI-based; cross-entity sharing, real operational data, official naming, provider/road data approval, production rate limits/retention/observability, backup/restore and SIT/UAT remain open. Download expires after 30 days, but persisted row cleanup is not automatic yet. See `docs/backend-progress.md` and `docs/operations-api.md`; do not treat fixture success as production sign-off.
