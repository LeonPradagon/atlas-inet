# FR-01–04 — implementation and verification

Date: 8 October 2026. Scope: individual analysis, nearest/cable calculation, Excel bulk option alongside KML/KMZ, and XLSX results. No operational capacity, topology or engineering approvals are fabricated.

## Delivered

- Excel `.xlsx` bulk input shares the existing persisted preview → explicit approval → durable worker → results workflow. KML/KMZ remain supported. Network asset import remains KML/KMZ; Excel asset import is outside this change.
- Authorized `GET /api/v1/analysis/template?entityId=<UUID>` downloads an empty `Input` sheet and `Instructions` sheet. Template creation does not create a job.
- `Input` headers: `reference_id`, `customer_name`, `address`, `latitude`, `longitude`, `notes`, `connection_point_id`, `connection_point_type`. Optional reference defaults to the actual Excel row number. At the user's request, maximum Excel input is now **50,000 non-header sheet rows / 50 MB**; KML/KMZ retain their 20 MB / 20,000-Placemark limit. ZIP safety limits remain: 100 MB total expanded archive and 64 MB per entry; oversized/unsafe archives are still rejected.
- Each row needs an address or both WGS84 coordinates. Coordinates take precedence over an address. Duplicate references, malformed/out-of-range/incomplete coordinates, oversized fields and formula/hyperlink/complex cells are rejected per row. Invalid workbook structure, missing/duplicate/unknown headers, empty input and excessive rows reject the file. Only explicitly approved valid rows are processed; invalid rows remain in the result/errors export.
- Ambiguous geocoding remains an explicit result requiring human verification. It is never silently resolved. Customer name/contact is not sent to the geocoder.
- Individual empty coordinates cannot submit as `0,0`. Explicit numeric zero remains valid.
- A selected ODP no longer inherits the first linked ODC's type. Export uses the actual selected/automatically chosen connection point, not only input metadata.
- Compose now passes the internal Photon URL and dataset version to both API and worker. Geocoder setup supports Node 22 with the installed `zstd` executable, preserving checksum verification and exclusive activation. The optional systemd unit binds Photon only to the private Docker bridge.

## Verification

- Frontend: 44/44 tests pass; frontend/backend typechecks and frontend production build pass.
- Backend: 109/109 tests pass against a dedicated temporary PostGIS container, not the operational database. Integration tests exercise authenticated template download, Excel preview, approval, worker checkpoints, mixed address/coordinate input, nearest lookup, approved test-only cable formula, XLSX Results/Errors and tenant isolation. Route/geocoding providers in integration tests are mocked.
- Test-only formula case: route 1,000 m, 10% slack and 20 m extra produces 1,120 m. This policy exists only in the isolated test database; it is not a company-approved production rule.
- A deployment regression was found and fixed: Compose supplies an empty optional `GEOCODING_DATASET_VERSION`; configuration now treats an empty value as absent rather than aborting API/worker startup. After this fix, the focused parser/adapter suite passes 25/25, including a new startup regression test. The earlier full integration suite passes 109/109. Automated tests do not constitute SIT/UAT approval.

## Server/browser smoke

- API and worker images are deployed on `atlas-inet`; API is healthy. Operational database schema, capacities, network links and engineering policies were not modified.
- The authenticated local frontend downloads the authorized Excel template (HTTP 200), uploads `atlas-fr0104-smoke.xlsx`, previews 2 valid rows and 1 deliberately invalid row, then explicitly approves the worker job.
- Job `3a62a0f6-d759-4d29-a983-2209aa6b8310` finishes `COMPLETED_WITH_ERRORS`: 3/3 processed, 2 successful nearest analyses, 1 expected validation error (latitude 91). Test artifacts are clearly prefixed `TEST-FR0104`; no booking or customer request was created.
- The browser downloaded the 9,033-byte XLSX. ExcelJS reopened and verified `Results`, `Errors`, `Summary`; successful rows contain nearest segment IDs and distances 0 m / 16.98623124 m. The invalid row is `VALIDATION_ERROR`. Cable values stay empty with `NO_VALIDATED_CONNECTION_POINT`, as required when topology is absent.
- Internal Indonesia geocoder provisioning remains in progress; FR-01 live address smoke is pending. Do not interpret the passing mocked provider tests as production geocoding proof.

## Deployment preservation / rollback

Original files, optional-config supplemental files and the original private `.env` are saved under `/opt/atlas-backups/fr0104-20261008` (root-only). Previous API/worker images are tagged `atlas-fr0104-backend-rollback:20261008` and `atlas-fr0104-worker-rollback:20261008`. No database migration was needed. Rollback restores the backed-up source/config and selects the previous image tags; stop the new geocoder unit if reverting its configuration. Do not delete operational data or revert unrelated changes.

## Excel limit follow-up

- User approved 50 MB / 50,000 rows for bulk Excel. Asset import, KML/KMZ, monitoring export and coordinate validity are unchanged.
- Multipart interceptor, file validation, Excel parser, template instructions and local UI agree on the new limits. Nginx allows 52 MB including multipart overhead only for `/api/v1/analysis/uploads`; other routes retain the 22 MB proxy body limit.
- Focused backend tests: 27/27 pass, including all 50,000 rows accepted, 50,001 rows rejected, exactly 50 MB accepted by the file validator, 50 MB + 1 byte rejected, and old 20 MB KML/asset limits preserved. Frontend tests: 45/45 pass, including the file-size button/error boundary. Both typechecks and builds pass.
- A row with latitude 91 is still invalid; increasing workbook size must not make invalid geography valid. Jobs process rows incrementally at the existing worker/provider interval; increased input capacity is not a throughput/SLA guarantee.

## Core booking and full preview follow-up

- Naming-policy work is deferred. No naming validation is removed or bypassed.
- Segment detail on booking/map now offers a dedicated capacity-only editor for `network.write` users. It sends only installed core count and capacity validation with the current version. Cable naming, road side, cable type and topology are unchanged. User must explicitly confirm physical total and existing usage verification; the system does not invent these values.
- Core visualization shows Used / Booked / Available and refreshes after local transactions and every 15 seconds while viewing detail. Booking reserves Available; activation moves Booked to Used; release/expiry returns Available. Unknown capacity still blocks booking. Metadata completeness is separate from booking eligibility.
- The Presales PIC selected in the booking form is now actually sent; previously the form always sent the logged-in user.
- All bulk preview rows are accessible through authenticated, owner-only `GET /api/v1/analysis/uploads/:id/rows`, up to 1,000 per request. The UI automatically loads every page into the existing clustered network-map component; the table pages locally at 100 rows without truncating the dataset. Address-only and invalid rows stay in the table, not as fabricated map locations. A map button fits all loaded visible locations.
- Preview pagination errors display a retry action; preview browsing never submits a processing job. Network capacity metadata and operational data are not auto-filled by these changes.
- Regression proof covers more than 100 preview locations, owner/anonymous rejection and bounded pagination, capacity-only edits without renaming, booking counter refresh, selected Presales PIC, and full Booked → release / Used → deallocate transitions on isolated data.
- Verification: full backend suite 114/114 and frontend suite 48/48 pass; typechecks/builds pass. API, worker and web deployed healthy. Browser smoke shows 150/150 coordinate rows loaded with the clustered map present, no error, and the table limited to 100 rows per page (not 100 rows total). This smoke saved a clearly labeled `TEST-ALL-PREVIEW` upload only; it did not create a job, booking or network metadata.

## Table pagination and job display

- Preview, job result rows and analysis history offer 10/25/50/100 rows per page, reset to page 1 on size change, and bounded numbered / first / previous / next / last navigation. Preview table size does not reduce map locations. Job/history page size is sent to the existing bounded API.
- Job execution was already asynchronous. The flicker was caused by including `completed` in the table query key, destroying the active table snapshot on every progress update. The query now uses stable user/entity/job/page/size identity and refreshes rows in the background when progress/status changes, including completion.
- Existing rows stay mounted during background fetching. Previous-page placeholders are reused only within the same user/entity/job; never across scope or jobs. Errors and session rejection are still surfaced rather than hidden by stale-data fallback.
- Regression tests verify DOM row identity during a delayed progress refresh, size/page API parameters, page reset, and preview sizing independent of map feature count. Capacity still requires physically verified total and recorded existing Used; booking changes the reservation ledger, not physical metadata.
- Verification: frontend 51/51 tests pass, frontend production build and frontend/backend typechecks pass. Web-only deployment is healthy; API/worker were not restarted. Backend behavior/schema is unchanged in this follow-up.

## Remaining production conditions

FR-02 and FR-04 still require validated segment–ODC/ODP links and an independently approved engineering policy to populate cable length. Existing server data has neither. Road distance/geometric nearest distance must not be represented as installed cable length. FR-01 accuracy remains dependent on OSM address coverage and explicit confirmation of coarse/ambiguous candidates.

Using the earlier equal-weight rubric, FR-01–04 are 75% operational requirement coverage (FR-01 and FR-03 complete; FR-02/FR-04 partial), subject to successful geocoder deployment. Overall mandatory FR coverage becomes 86.4% (8 complete, 3 partial out of 11), not production readiness or stakeholder acceptance.
