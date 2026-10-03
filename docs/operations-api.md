# Backend Phase 2 API

Base `/api/v1`; session Better Auth wajib. Permission berlaku **per entitas**, tidak berasal dari nama Admin/union `/me`. Semua JSON memakai `{ data, meta? }`; error memakai envelope standar. ID asing/tidak ada pada resource private memberikan 404. Mutasi HTTP memerlukan trusted Origin di bootstrap API.

## Endpoint dan permission

| Endpoint | Permission entitas |
| --- | --- |
| `POST /bookings` | `bookings.create` |
| `GET /bookings` | `bookings.read` |
| `POST /bookings/:id/release` | `bookings.release` |
| `POST /bookings/:id/activate`, `/allocations/:id/deallocate` | `allocations.write` |
| `POST /waiting-list`, `GET /waiting-list` | `waiting-list.create`, `waiting-list.read` |
| `POST /waiting-list/:id/allocate`, `/:id/cancel` | `waiting-list.allocate`, `waiting-list.cancel` |
| `GET /network/segments/:id/capacity`, `/:id/name-history` | `network.read` |
| `PATCH /network/segments/:id` | `network.write` |
| `GET /network/cable-types` | `network.read` |
| `POST /network/cable-types` | `network.master-write` |
| `GET /settings/:key`, `GET /settings/requests` | `settings.read` |
| `POST /settings/:key/requests`, `POST /settings/requests/:id/cancel` | `settings.write`; cancel pengaju sendiri |
| `POST /settings/requests/:id/approve`, `/:id/reject` | `settings.read` + `settings.approve-operational` (booking/naming) atau `settings.approve-engineering` (analysis); checker berbeda |
| `POST /analysis` | `analysis.create` |
| `GET /analysis` | `analysis.read`; histori sendiri |
| `POST /analysis/uploads`, `POST /analysis/jobs` | `analysis.bulk`; submit juga `analysis.create` |
| `POST /imports`, `GET /imports/:id`, `POST /imports/:id/publish` | `imports.write`; pemilik preview |
| `POST /imports/:id/rows/:rowNumber/geocode`, `.../confirm-coordinates` | `imports.write`; pemilik preview |
| `GET /reports/utilization` | `reports.read` |
| `POST /reports/exports` | `reports.export` |
| `GET /notifications`, `POST /notifications/:id/read` | `notifications.read`; notifikasi sendiri |
| `GET /audit-logs` | `audit.read` |

List menggunakan `entityId`, `page` (default 1), `pageSize` (default 25; maksimal 100). Booking/waiting list menerima tambahan `segmentId` dan enum `status`. Filter status memakai status persisted; detail jaringan menyertakan `capacity.expiryPendingCount` saat expiry belum dimaterialisasi worker. `name-history` dan `jobs/:id/rows` menggunakan pagination tanpa `entityId`; scope berasal dari resource.

`GET /imports/template` dan `/analysis/template` memberikan template XLSX kosong, session wajib. Format contoh berikut hanya bentuk kontrak; bukan standar nama/data perusahaan.

### Booking dan waiting list

Create menerima `segmentId`, `customerName`, optional/null `customerReference`, `customerPicName`, `customerPicContact`, `presalesUserId`, `coreCount` integer positif, dan `reason`. PIC presales harus memiliki membership aktif dan `bookings.create` di entitas pemilik. Header `Idempotency-Key` wajib pada create dan promosi waiting list; key sama/payload berbeda menghasilkan 409.

Release/cancel/deallocation menerima `{ "reason": "..." }`. Activate menerima `{ "operationalReference": "..." }`. Konversi/release seluruh jumlah; tidak ada edit expiry, partial atau override FIFO. Waiting list tidak mengurangi Available; head yang tidak muat tidak boleh dilewati, termasuk melalui booking langsung. Promosi manual memulai masa berlaku baru dari policy aktif.

Kapasitas: `total` nullable jika belum tervalidasi; `used`, `booked`, `idle`, `available`, `waitingCount`, `waitingCores`, `asOf`. `Idle = Total − Used`, `Available = Total − Used − Booked`. Used berasal dari allocation aktif, bukan booking histori berstatus USED. Expiry efektif memakai waktu database walaupun worker belum mengubah status.

### Settings dan edit aset

GET menerima `?entityId=...`; default version 0. Perubahan melalui **maker–checker**, bukan PATCH langsung: `POST /settings/:key/requests?entityId=... { value, reason }` wajib `If-Match: "<version>"` (angka unquoted juga diterima) dan `Idempotency-Key`, menghasilkan HTTP 202/PENDING tanpa mengubah policy aktif. Checker berbeda melakukan approve/reject dengan alasan wajib; pengaju dapat cancel. Booking/naming memakai permission approve-operational, radius/formula memakai approve-engineering. Self-decision dilarang termasuk Admin; approval stale ditolak. PATCH lama memberi 409 dan DB trigger menolak direct write dari binary lama. Detail kontrak, rekomendasi role dan rollback: [policy-approvals.md](policy-approvals.md). Histori policy immutable di DB/audit; perubahan hanya memengaruhi operasi berikutnya.

- `booking-policy`: `{ duration: positiveInteger, unit: "DAY" | "MONTH" }`; default satu bulan kalender, timezone Asia/Jakarta. Akhir bulan diklem; timestamp UTC.
- `naming-policy`: `{ approved: boolean, pattern: string | null, uniquePerEntity: true }`; regex RE2 compatible, full match, bukan JS backtracking regex. Default unapproved/null. Tidak ada pola resmi atau sequence otomatis rekaan.
- `analysis-policy`: `{ radiusM: integer, formulaApproved: boolean, slackPercent: number | null, extraLengthM: number | null, maxDetourPercent: number | null }`; default radius usulan 5000 m, formula belum approved. Approval memerlukan seluruh parameter.

PATCH segmen menerima subset: `cableName`, `cableTypeId`, `installedCoreCount`, `capacityValidated`, `installationMethod`, `roadSide`, paired `startNodeId/endNodeId`, `status`. Wajib If-Match versi segmen. Kapasitas tidak boleh lebih kecil dari Used + Booked efektif. Topologi yang berubah dengan roadSide existing memerlukan konfirmasi roadSide eksplisit. FK menolak node lintas entity/dataset. Tidak menyediakan permanent delete.

Master kabel bersifat global/immutable pada baseline. POST menerima `{ entityId, code, name }` dengan grant khusus `network.master-write`; replay kode/nama sama mengembalikan existing, nama berbeda ditolak. Tidak otomatis membuat tipe dari input import.

### Analisis individual

`POST /analysis`: `{ entityId, latitude?, longitude?, address?, connectionPointId? }`. Koordinat harus berpasangan, number WGS84, longitude −180..180 / latitude −90..90; jika ada koordinat lengkap, alamat hanya metadata. HTTP 200 untuk hasil domain, termasuk kondisi tidak ditemukan/dependency belum tersedia.

Hasil memuat status, coordinates/source, radius/policy version, nearest canonical segment/dataset/capacity snapshot, distance meter, estimasi/metode/time. Jarak geometric ke kabel **bukan** panjang rute jalan. Tidak ada booking otomatis. `needsSurvey` tetap true.

Geocoding adapter `GEOCODING_INTERNAL_URL` menerima POST `{ address }`, memberi `{ candidates: [{ latitude, longitude, label }] }`. Status dibedakan: `GEOCODING_NOT_CONFIGURED`, `GEOCODING_UNAVAILABLE`, `ADDRESS_NOT_FOUND`, `AMBIGUOUS_ADDRESS`, `NO_NETWORK_IN_RADIUS`, `OK`. Koreksi/kandidat dikirim ulang sebagai koordinat eksplisit; belum ada editor provenance multi-step.

Pilihan lokal **Photon self-hosted Indonesia**: `PHOTON_INTERNAL_URL`, native GET `/api?q=...&countrycode=ID&limit=5`. Kedua config geocoding tidak boleh aktif bersamaan. Lebih dari satu kandidat atau titik tanpa house number tetap membutuhkan konfirmasi; precision bukan confidence score. Hasil memuat provider/dataset/attribution; `GEOCODING_DATASET_VERSION` harus sesuai dump. Koordinat lengkap bypass geocoding; tanpa fallback publik. Setup/freshness/update: [self-hosted-geocoding.md](self-hosted-geocoding.md).

Routing adapter `ROUTING_INTERNAL_URL` menerima POST `{ from: { latitude, longitude }, to: GeoJSONPoint }`; memberi `{ distanceM, shortestFeasibleDistanceM, policyVersion, roadDatasetVersion, geometry: GeoJSONLineString }`. Internal provider bertanggung jawab atas kelayakan/kelas jalan. Backend menolak redirect, invalid/besar response, timeout (5 detik), dan rute di luar detour policy. Rute memerlukan ODC/ODP yang terhubung ke nearest segment; proyeksi segmen tidak menjadi titik sambung. `estimatedCableLengthM = ceil(distanceM × (1 + slackPercent/100) + extraLengthM)` hanya jika formula approved. Tidak ada provider publik, road dataset atau standar engineering yang diasumsikan.

### Import jaringan

Multipart `POST /imports`: `file`, `entityId`, `sourceSystem`, optional JSON-text `mappings`. Ekstensi `.kml` atau `.xlsx`, maksimal 20 MB/10.000 rows. Preview persist berisi rows/errors dan fingerprint source; belum publish. Validasi struktur terjadi di preview, domain/naming/topology/kapasitas dicek ulang secara atomik saat publish.

KML: namespace/folder didukung; satu geometry per Placemark: Point, LineString, atau MultiGeometry LineStrings. Altitude diabaikan untuk geometry 2D; entities/DOCTYPE dan geometry mixed/zero length ditolak. Placemark `id` adalah external ID; `ExtendedData/Data name="code"` atau id menjadi code. Point membutuhkan mapping kind eksplisit (`NODE`, `POLE`, `ODC`, `ODP`). `mappings` keyed berdasarkan nomor Placemark 1-based dan dapat melengkapi externalId/code/metadata/relasi. KML tanpa identitas memerlukan mapping eksplisit; tidak menebak ID dari nama kabel.

XLSX aset: sheet `Assets`, kolom `kind`, `external_id`, `code`, `cable_name`, `geometry` (GeoJSON JSON-text), `cable_type_code`, `installed_core_count`, `capacity_validated` (boolean), `installation_method`, `road_side`, `start_node_code`, `end_node_code`, `height_m`, `segment_codes` (comma-separated). Nilai kosong mempertahankan metadata existing. Untuk mengosongkan relasi secara eksplisit gunakan mapping KML `segmentCodes: []` atau edit terotorisasi berikutnya; blank Excel tidak menghapus relasi. POLE wajib 7/9 m; ODC dan ODP terpisah.

Publish `POST /imports/:id/publish { version }`: merge source ke dataset canonical satu entity/source, ID aset stabil berdasarkan `(owner, sourceSystem, externalId)`. Version baru wajib untuk update; replay preview published mengembalikan dataset yang sama. Tidak menghapus aset yang absen, memindahkan aset ke owner lain, menimpa booking/allocation, atau menciptakan core/tipe kabel rekaan. Preview stale / code/nama duplicate / kapasitas tidak cukup ditolak. Source dengan beberapa dataset memerlukan migrasi/mapping eksplisit, tidak dipilih diam-diam. Histori preview menyimpan batch, bukan snapshot temporal seluruh dataset.

Kolom aset tambahan `address`, `latitude`, `longitude`: aset titik tanpa geometry dapat memakai koordinat numerik berpasangan atau alamat saja. Alamat-only menjadi error staging `ADDRESS_NEEDS_GEOCODING` dengan sourceRow. KML `<address>` tanpa geometry juga didukung untuk kind titik eksplisit. Segmen wajib garis aktual; geometry malformed tidak di-geocode sebagai fallback. Provenance `geocoding` server-owned, bukan input mapping.

`POST .../geocode` menyimpan candidates/lookupId baru, belum menghasilkan row valid/publish. `POST .../confirm-coordinates { lookupId: UUID, candidateIndex: integer 0..19 }` mengambil koordinat hanya dari kandidat tersimpan terkini, menambahkan row/provenance actor/time/provider/dataset dan audit atomik. Lookup stale/preview published 409; kandidat tidak tersedia 422. Publish mengecek ulang rows/errors setelah lock; semua error harus terselesaikan.

### Bulk dan jobs

Multipart `POST /analysis/uploads`: `file`, `entityId`. Sheet `Input`; kolom `reference_id`, `customer_name`, `address`, `latitude`, `longitude`, `notes`, optional UUID `connection_point_id`. Template lama tetap valid. Alamat saja diproses geocoder internal oleh worker; koordinat lengkap bypass geocoding. Number koordinat wajib number Excel; reference kosong memakai nomor baris; duplicate ditandai error. Formula/hyperlink/complex cell ditolak. Preview maksimal 100 baris dengan total valid/invalid.

`POST /analysis/jobs { uploadId, processValidRows: true }` → HTTP 202 `{ data: { id } }`; approval false ditolak. Baris invalid tetap tersimpan sebagai error; seluruh baris dapat ditelusuri. Submit ulang upload mengembalikan job existing.

- `GET /jobs/:id`: state/counter/error/attempts/time, tanpa raw input besar.
- `GET /jobs/:id/rows?page=...&pageSize=...`: input/result/error per row.
- `POST /jobs/:id/cancel`: cancellation persisted, worker berhenti di checkpoint berikutnya.
- `POST /jobs/:id/retry`: 202 job baru dengan `previousJobId`; hanya baris `GEOCODING_UNAVAILABLE`/`DEPENDENCY_UNAVAILABLE`, bukan sukses/ambigu/input-invalid/not-configured.
- `GET /jobs/:id/result`: XLSX untuk COMPLETED/COMPLETED_WITH_ERRORS, maksimal 30 hari sejak create. Bulk memiliki Results/Errors/Summary; monitoring Results/Summary. Teks `=...` tetap text, bukan formula.

Pemilik tetap memerlukan permission dasar `analysis.bulk` atau `reports.export` saat read/download. User lain membutuhkan permission dasar **dan** `jobs.read` di entitas sama; cancel/retry user lain membutuhkan `jobs.manage`. Worker mengecek grant aktif; revoke menggagalkan job/download, tidak memberikan bypass service account. Persisted records belum dipurge otomatis.

Bulk export menyertakan `connection_point_id`, `coordinate_source`, `geocoding_provider`, `geocoding_dataset_version`, `geocoding_candidates` (JSON-text), `route_status`, `route_distance_m`, `formula_version`, `needs_survey`. Ambiguous tetap error tanpa koordinat pilihan palsu; kandidat dapat diverifikasi lalu dikirim sebagai koordinat pada template Input baru. Geocoding sukses tidak menjamin tersedia jaringan/rute/estimasi.

Worker claim memakai lease 30 detik dan token fence. Setiap row/counter commit atomik; restart melanjutkan rows pending. Crash sesudah provider call sebelum commit dapat memanggil provider lagi; tidak mengklaim exactly-once external request. Maksimal 3 failed lease attempts sebelum FAILED. Dua active jobs/user, upload 10.000 baris, ZIP expanded-content/entry limits. Baseline serial memprioritaskan correctness, bukan SLA throughput.

### Monitoring, notifikasi dan audit

`GET /reports/utilization`: satu snapshot scoped, counts kapasitas dan antrean per segmen, `asOf`. `meta.summary` mengagregasi **seluruh** segmen published di entitas, bukan hanya halaman: `segmentCount`, `unknownCapacityCount`, `total`, `used`, `booked`, `idle`, `available`, `waitingCount`, `waitingCores`. Jika ada total belum tervalidasi, agregat total/idle/available tetap null; scope kosong memberi count/sum nol. `POST /reports/exports { entityId }` → 202; snapshot dibekukan saat submit, sehingga perubahan setelah submit tidak tercampur. Maksimal 10.000 segmen/job saat ini; tidak silently truncate.

Event release/expiry/capacity available/promosi ditulis transactional outbox. Worker mendeliver dalam aplikasi, dedup `(eventId, recipientId)`. Penerima tim membutuhkan `notifications.receive`; PIC dengan `notifications.read` pada entitas sama juga menerima event sendiri. Read hanya milik recipient yang masih berizin. Tidak ada email/CRM/WhatsApp. Retry tick setelah kegagalan mempertahankan event pending; belum ada backoff per-event/poison queue khusus.

Audit menggabungkan access_audit dan domain audit, terotorisasi `audit.read`. Tidak mengirim raw kontak customer ke outbox/ringkasan network. Domain mutasi mencatat actor/resource/time; log error API tidak membocorkan SQL, FK atau secrets.

## Batas readiness

Endpoint backend dan integrasi frontend domain tersedia; batas UI/proof tercatat pada [frontend-progress.md](frontend-progress.md). Role matrix, real dataset/Used baseline, pola nama, adapter internal, data jalan dan parameter engineering memerlukan validasi stakeholder. API administrasi akun/role, cross-entity sharing, generation sequence nama resmi, historical report period, automated retention cleanup, production rate limits/metrics, load/security, backup/restore dan SIT/UAT belum selesai. Tidak ada klaim siap produksi atau sign-off bisnis.
