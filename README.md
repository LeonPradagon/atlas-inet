# ATLAS INET — Frontend

React + TypeScript + Vite frontend foundation based on the PRD.

## Run locally

```bash
npm install
Copy-Item .env.example .env
npm run dev
```

## Project structure

```text
src/
  app/        # Providers, router, query client
  layout/     # Shared application shell
  pages/      # One route page per file
  shared/
    api/      # Axios clients, interceptors, API status
    components/ # Reusable UI components
```

`apiClient` targets `VITE_API_BASE_URL`; `authClient` targets `VITE_AUTH_BASE_URL`. Both use shared request/response interceptors and cookies. Set the `VITE_*` values at build time for Docker; Vite does not inject them at container runtime.

## Docker

```bash
docker build -t atlas-frontend .
docker run --rm -p 8080:80 atlas-frontend
```

Open `http://localhost:8080`. To point the browser at an API, pass build args, for example `--build-arg VITE_API_BASE_URL=https://api.example.com/api/v1 --build-arg VITE_AUTH_BASE_URL=https://api.example.com/api/auth`. The image serves the SPA only; configure an API/reverse proxy separately.

## Current scope

- AdminLTE 4 responsive shell, route navigation, and Axios-based `/health/ready` status.
- Login screen using the Better Auth email sign-in endpoint contract.
- Dashboard, network map controls, address/coordinate analysis, and bulk `.xlsx` selection.
- Booking and waiting-list forms with client-side validation.
- Asset import selection, monitoring filters/export feedback, notifications, settings, and user/audit screens.
- Empty states do not fabricate operational records or network metrics.

Geocoding, road-routing, basemap, CRUD persistence, reporting data, and role permissions still require the backend. Forms validate and report the unavailable service; they do not claim a booking, import, or analysis succeeded. Route preference parameters and road-data source remain subject to the business decisions recorded in the PRD.
