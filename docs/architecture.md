# Backend architecture

## Runtime boundary

The browser talks to one public origin. Nginx proxies `/api/*` without rewriting the path to the NestJS Express server. Nest serves business routes under `/api/v1`; Better Auth owns `/api/auth/*`. The server is the only application component that can connect to Postgres.

The applications are isolated in `apps/frontend` and `apps/backend`. Each owns its package manifest, lockfile, Dockerfile, and Docker ignore rules; root `docker-compose.yml` coordinates them. Reusable frontend presentation elements live in `apps/frontend/src/components`; API clients and health-query state remain under `src/shared/api`.

## Server modules

- `config`: validates environment once and supplies typed configuration.
- `database`: owns the `pg` pool and typed Drizzle connection. Readiness checks PostGIS, not only TCP connectivity.
- `auth`: owns the Better Auth configuration/handler and session verification. Public self-registration is disabled.
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

## Deliberately not implemented yet

No worker, booking transaction, entity/role model, network dataset, file import, geocoding adapter, or report/export route is included in this foundation. These require validated policies, real datasets, or a durable job design. Add each as a domain module with matching migrations and tests rather than extending auth/health services.
