# BRD ATLAS Phase 2 v2.0 — FR traceability

Baseline: BRD supplied by user (25 Aug 2026), code reviewed 5 Oct 2026. “Implemented” means application workflow/code exists; it does **not** claim operational data, stakeholder acceptance, or SIT/UAT completion.

## Navigasi sidebar menurut alur BRD

| Kelompok menu | Menu | Kebutuhan terkait |
| --- | --- | --- |
| Jaringan & Analisis | Analisis Lokasi, Peta Jaringan, Aset & Impor Jaringan | FR-01–04, FR-10, FR-12 |
| Booking & Kapasitas | Booking Core, Daftar Tunggu | FR-05–07, FR-09 |
| Monitoring | Laporan & Ekspor, Notifikasi | FR-04, FR-06, FR-08 |
| Administrasi | Pengaturan, Pengguna & Audit | FR-11 dan kontrol akses/audit lintas fitur |

| ID | Status | Evidence / remaining condition |
| --- | --- | --- |
| FR-01 | Implemented with data caveat | Individual address geocoding uses self-hosted Photon; ambiguous/coarse candidates require explicit confirmation. OSM coverage is not guaranteed. `AnalysisPage.tsx`, `InternalAdapters`. |
| FR-02 | **Partial / blocked for production** | Nearest published network and geometric distance are calculated. Cable route/length requires running internal routing, published network topology, a validated ODC/ODP, and Engineering-approved detour/slack/additional-length policy. Cable estimate deliberately remains null otherwise. `analysis.service.ts`, `self-hosted-routing.md`. |
| FR-03 | Implemented | KML/KMZ bulk point/address placemarks; preview markers, approval, durable processing, cancel/retry. Results export as XLSX. `jobs`, `imports` modules. |
| FR-04 | Partial, follows FR-02 | Excel result/export includes nearest network and route/estimation status. Estimated cable length is null until FR-02 dependencies are approved and operational. |
| FR-05 | Implemented | Booking creates capacity hold per segment with idempotency and expiry policy. `capacity.service.ts`. |
| FR-06 | Implemented | Segment/report capacity exposes used, idle, booked, available, and waiting-list count/core totals. Unknown capacity remains explicit. `network.repository.ts`, `reports.service.ts`. |
| FR-07 | Implemented | Booking/release/activation update ledger transactionally; expiry worker materializes expiry. Reads calculate effective availability from ledger. |
| FR-08 | Implemented as in-app notification | Release writes an outbox event; worker delivers to users with entity notification permission and the booking Presales PIC when authorized. No email/external channel; external integration is out of scope. `capacity.service.ts`, `notifications.service.ts`. |
| FR-09 | Implemented, manual FIFO | Capacity becoming available triggers notification. Authorized operator allocates full FIFO head only when capacity suffices; allocation is not automatic. This matches current business rule; confirm if BRD intended automatic promotion. |
| FR-10 | Implemented | Segment detail/map exposes cable type/core count/install method/road side/poles/ODC/ODP and capacity. Values missing from source remain incomplete, not fabricated. |
| FR-11 | Implemented as configurable gate | Naming policy supports approved RE2 pattern and blocks publish until set. **Company naming rule must be supplied and approved** before production imports. |
| FR-12 | Implemented for network identifiers (optional) | Entity-wide search finds cable name, segment code and pole/ODC/ODP codes across published datasets, then focuses selected result on map. Address search is not part of this endpoint. `GET /network/search`. |

## Related BRD conditions

- Excel/KML import, network map, segment detail, utilization reporting and export workflows exist. Data accuracy still depends on validated company network, capacities, topology and source Used allocations.
- FR-02 needs the routing host/data, but OSM road routes are only a proxy for construction route; OSM does not describe actual ducts/poles/cable path. The current shortest-route comparator is heuristic pending Engineering validation.
- NFR performance/availability/scalability need target values and load/availability tests. Security controls and entity scoping are implemented, but production security/compliance review remains.
- Acceptance criterion SIT/UAT and stakeholder sign-off remain open. Automated tests are not business acceptance.

## Next implementation order

1. Configure a bounded regional OSM routing pilot and verify representative routes with Operations/Engineering; keep cable formula disabled until signed off.
2. Supply/approve company cable naming regex, representative network data, Used baseline and ODC/ODP topology; run end-to-end BR-01–FR-11 against that data.
3. Decide whether FR-09 promotion stays manual FIFO or changes to automatic, and confirm notification recipients/channel.
4. If required, implement entity-wide FR-12 search/navigation; requirement is explicitly optional in BRD.
5. Agree NFR targets, run SIT/UAT/load/restore checks, record approval.
