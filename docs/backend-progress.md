# Progres backend ATLAS Phase 2

Acuan utama: BRD ATLAS INET Phase 2 v2.0 (25 Agustus 2026), dengan PRD v1.1 sebagai elaborasi teknis. Alur tetap import → peta → analisis → booking → monitoring → notifikasi. Status berikut adalah implementasi backend, bukan sign-off SIT/UAT. Integrasi UI dicatat terpisah di [frontend-progress.md](frontend-progress.md).

## Tahap yang dikerjakan

| Domain | Status | Batas saat ini |
| --- | --- | --- |
| Auth, health, database | Fondasi tersedia | Better Auth, session guard, Drizzle/PostGIS |
| Role dan entitas | Fondasi akses backend tersedia | Grant/revoke CLI lokal; belum ada UI/API administrasi pengguna/role |
| Aset dan jaringan | API baca, edit, naming dan import tersedia | KML/Excel preview/publish atomik, ID stabil, tiang 7/9 m, ODC/ODP, histori nama; pola resmi/dataset masih wajib disediakan |
| Analisis individual/bulk | Koordinat/PostGIS, job Excel dan Photon Indonesia tersedia lokal | Alamat-only individual/bulk, kandidat/provenance; routing/dataset jaringan/formula nyata masih diperlukan |
| Kapasitas dan antrean | Transaksi domain tersedia | Booking, Used, release/deallocation, expiry worker, FIFO ketat dan promosi manual penuh |
| Pelaporan/notifikasi | Monitoring, snapshot export, outbox dan audit tersedia | Notifikasi dalam aplikasi; tidak ada email/integrasi eksternal |
| Pengaturan | Policy versioned + maker–checker tersedia | Booking/naming checker operasional; radius/formula checker engineering; self-approval ditolak termasuk Admin |
| SIT/UAT/pilot | Belum selesai | Load, backup/restore dan persetujuan stakeholder |

## Hasil tahap akses

- Migrasi `0001_clever_krista_starr.sql` menambahkan entities, roles, permissions, memberships, role_permissions, membership_roles, dan access_audit. Tabel/data auth tidak dihapus atau diubah.
- Role terikat pada satu entitas. Composite foreign key menolak pemasangan role entitas lain ke membership.
- Membership, entitas, dan role nonaktif tidak menghasilkan permission. Nama pengguna/role `Admin` tidak memberikan bypass; tidak ada permission wildcard.
- `GET /api/v1/me` mempertahankan `user`, `entities` (array ID), dan `permissions`; menambahkan `entityAccess` berisi ID/kode/nama entitas, role dan permission masing-masing. Union `permissions` hanya informasi, bukan dasar izin lintas entitas.
- `GET /api/v1/entities?page=1&pageSize=50` mengembalikan entitas dengan `entities.read`, urutan kode, dan `meta: { page, pageSize, total }`. Batas pageSize 100; parameter lain ditolak.
- `GET /api/v1/entities/:entityId` memerlukan sesi dan `entities.read` pada entitas tersebut. ID malformed menghasilkan 400; sesi tidak valid 401; ID tanpa grant/tidak dikenal 403 tanpa membocorkan keberadaan entitas.
- `EntityPermissionGuard` dapat digunakan domain berikutnya setelah `AuthSessionGuard`. Parameter route `entityId` dan metadata `RequireEntityPermission(...)` wajib; policy yang hilang tidak mengizinkan akses.
- Grant/revoke CLI transaksional, idempotent, dan diaudit bersama perubahan. Role existing tidak diubah diam-diam. Tidak ada akun/grant/data operasional yang di-seed.

## Menjalankan lokal

Jalankan dari `apps/backend`. Gunakan `.env` root yang sudah dikonfigurasi; jangan membagikan secret.

```powershell
# Docker hanya untuk PostGIS pada alur pengembangan lokal.
docker compose --project-directory ../.. up -d db
npm run db:migrate
npm run start:dev
# Terminal terpisah setelah build; expiry dan job tidak dijalankan oleh browser/API.
npm run worker
# Alternatif pengembangan worker dengan watch:
npm run worker:dev
```

Pada terminal lain, buat akun melalui `npm run user:create` jika belum ada. Setelah cakupan dan izin disetujui, berikan grant eksplisit:

```powershell
# Contoh parameter; bukan data perusahaan atau role produksi yang telah disetujui.
npm run access:grant -- --email operator@example.com --entity-code ENTITY_CODE --entity-name "Nama entitas yang disetujui" --role-code entity-reader --permissions entities.read

# Mencabut role ini saja; role lain dan akun tetap dipertahankan.
npm run access:grant -- --action revoke --email operator@example.com --entity-code ENTITY_CODE --role-code entity-reader
```

Permission memakai format `resource.action`. CLI tidak otomatis memberi permission domain yang belum diimplementasikan. Grant pertama membuat entitas/role/membership jika belum ada; nama entitas dan set permission role existing harus sama. Entitas/role/membership nonaktif tidak diaktifkan kembali oleh grant. Revoke tidak menghapus entitas, membership, definisi role atau histori audit. Audit `source` mencatat identitas OS operator lokal; ini bukan API audit lengkap PRD.

Migrasi ini additive: rollback aplikasi ke versi sebelumnya tidak memerlukan penghapusan tabel akses. Untuk mencabut izin, gunakan revoke; jangan menghapus tabel/data auth atau melakukan migrasi turun destruktif. Backup tetap diperlukan sebelum migrasi produksi.

## Hasil tahap jaringan — slice baca

- Migrasi `0002_keen_lenny_balinger.sql` menambahkan master kabel, dataset, segmen/node, poles, odcs, odps dan tiga tabel relasi aset. Tidak mengubah tabel/data auth atau memberikan grant/dataset contoh.
- Geometry PostGIS 4326 tervalidasi, GiST viewport index, kapasitas known integer positif, tiang 7/9 m dan foreign key scope owner/dataset.
- API `GET /network/segments`, `GET /network/segments/:id`, dan `GET /network/map` di bawah `/api/v1`; semuanya memerlukan sesi dan permission `network.read` per entitas.
- Viewport/pagination server-side, GeoJSON ODC/ODP terpisah, clipping segmen untuk tampilan, draft/archived tidak tampil. Detail mengembalikan geometry asli dan relasi aset.
- Metadata incomplete/kapasitas null diberi status eksplisit. Tidak menghitung Available/Used/Booked rekaan; belum ada domain booking.
- Kontrak, query, permission, error dan keterbatasan: `docs/network-api.md`.

## Bukti pengujian

Verifikasi lokal 3 Oktober 2026: `npm run test:access` **20/20 lulus**, typecheck frontend/backend lulus, generator Drizzle tidak menemukan drift schema, dan `npm run db:migrate` berhasil pada PostGIS lokal. Migrasi lokal tidak memberikan grant otomatis kepada akun existing.

Verifikasi slice jaringan pada tanggal yang sama: `npm test` **41/41 lulus** (20 akses + 21 jaringan), typecheck frontend/backend lulus, generator Drizzle tanpa drift, dan migrasi `0002` berhasil di PostGIS lokal. Fixture jaringan hanya dimasukkan ke database sementara untuk tes; data operasional, grant dan akun existing tidak di-seed atau diubah.

```powershell
npm run test:access
npm run test:network
# Menjalankan regresi kedua domain dalam database sementara masing-masing.
npm test
```

Pengujian menggunakan PostgreSQL/PostGIS nyata, membuat database sementara bernama unik `atlas_access_test_*`, lalu menghapus hanya database yang dibuatnya. User database pengujian perlu izin CREATE DATABASE dan extension PostGIS; jangan menjalankan dengan credential produksi. Akun pada database utama tidak diubah.

Skenario: upgrade schema dari auth existing, migrasi ulang, grant ulang/bersamaan, role permission immutable saat bootstrap, wildcard ditolak, composite FK lintas entitas, HTTP tanpa sesi, `/me`, isolasi entitas, nama Admin tanpa grant, UUID/pagination invalid, role/membership/entitas nonaktif, revoke, session expiry, dan kompatibilitas penghapusan akun/audit.

## Hasil implementasi domain Phase 2

- Keputusan pengembangan: 1 bulan kalender, Asia/Jakarta, clamp akhir bulan; Idle = Total − Used; Available = Total − Used − Booked. Tidak ada partial release/conversion, perpanjangan booking atau bypass FIFO.
- Migrasi additive `0003_low_riptide.sql` menambahkan ledger booking/allocation/waiting list, idempotency, policy/history, staging import, job/row, analysis, outbox/notifikasi dan audit. Menambahkan composite FK segmen-owner dan geography GiST. Tidak mengubah migrasi `0000`–`0002`.
- Semua perubahan kapasitas menggunakan lock row segmen yang sama. Expiry efektif dikecualikan saat read bahkan sebelum worker materialisasi. Konversi Used mengecek expiry lagi pada write. Replay submit/alokasi tidak menggandakan reservasi.
- Import adalah **merge** per entity/source, bukan replace/delete. Dataset canonical mempertahankan ID, version diperbarui atomik; preview lama ditolak jika sumber berubah. Metadata yang tidak disertakan tidak menimpa existing. Publish gagal tidak mengubah jaringan/booking. Histori preview dan audit menyimpan provenance, tetapi bukan mesin temporal query dataset lama.
- Naming default belum approved. Publish/rename membutuhkan regex resmi yang disetujui melalui `settings.write`; RE2 tidak menjalankan regex backtracking arbitrer. ID segmen tidak berubah karena rename.
- Bulk mempunyai preview per-row, persetujuan valid rows, counter durable, lease 30 detik dan fencing, pemulihan restart/stale lease, cancel checkpoint, dan retry eksplisit hanya kegagalan sementara. Kuota 2 job aktif/user; 10.000 baris/20 MB. Download `.xlsx` bertipe text untuk teks `=1+1`.
- Worker PostgreSQL singleton memakai advisory lock untuk membatasi panggilan bulk melalui `WORKER_INTERVAL_MS`; tidak perlu Redis. Queue/outbox/expiry diproses walau tidak ada browser terbuka. Provider mungkin dipanggil ulang jika crash terjadi sebelum checkpoint commit.
- Untuk baseline, input/output job dan snapshot berada di PostgreSQL, bukan filesystem. Download diserialisasi dari snapshot persisted. Download dibatasi 30 hari; pembersihan fisik/retensi PII masih memerlukan kebijakan operasional. Export monitoring saat ini maksimum 10.000 segmen/job, ditolak eksplisit jika melebihi batas.
- Nearest geodesik memakai geometri canonical, bukan viewport clipped. Tidak menganggap proyeksi ke tengah kabel sebagai titik sambung. Routing memerlukan relasi ODC/ODP, adapter terkonfigurasi, dan policy detour; panjang kabel hanya dihitung jika slack/extra/formula approved. Seluruh hasil tetap `needsSurvey: true`.
- Detail/list jaringan kini memuat `capacity` canonical tanpa PIC customer. Data PIC booking hanya melalui endpoint dengan `bookings.read`/`waiting-list.read`. Audit/outbox/notifikasi ditulis dalam transaksi dan dedup event-recipient.
- Kontrak domain, permission, file dan batas implementasi: [operations-api.md](operations-api.md).

Verifikasi terakhir: **82/82 tes lulus** menggunakan PostGIS nyata dan database sementara. Tambahan proof mencakup concurrency booking, replay, calendar clamp, policy immutable, FIFO, Used/deallocation, expiry/outbox dedup, nearest index, unsafe file/input, publish rollback, topology/tiang/ODC/ODP, formula gated, worker restart/lease fencing, selective retry, quota/revoke, snapshot Excel, summary seluruh entitas (termasuk unknown/empty), bootstrap HTTP asli (Origin JSON/multipart/session), serta lifecycle approval/migrasi legacy/DB write guard. Geocoding tambahan: Indonesia-only adapter, coarse/ambiguous, alamat-only assets/bulk, owner/stale lookup/konfirmasi/publish, connection point bulk dan export provenance. Workflow provider pada tes dimock; pencarian Photon nyata dibuktikan terpisah. Fixture hanya ada dalam database tes, tidak dalam database utama.

Migrasi `0003` diterapkan ke PostGIS lokal tanpa perubahan jumlah akun, membership atau segmen existing. Tabel booking/job/notifikasi baru tetap kosong; tidak ada seed/grant otomatis. Typecheck frontend/backend dan generator Drizzle tanpa drift lulus. Docker Compose memiliki worker untuk deployment penuh; pengembangan lokal tetap menjalankan **db saja** melalui Docker dan API/worker melalui npm.

Dependency baru ExcelJS memakai override `uuid ^11.1.1` untuk memperbaiki advisory transitif; XLSX/KML dan export tetap lulus regresi. Audit masih melaporkan 4 moderate pada rantai tooling Drizzle/esbuild lama; tidak menjalankan `npm audit fix --force` atau downgrade migrator. Review dependency/build image tetap gate produksi.

## Belum dianggap selesai

Photon 1.3.0 Indonesia telah diinstal lokal dan config API/worker dihubungkan; dump 1.267.812 dokumen, tanggal sumber 26 September 2026 UTC. Tidak ada fallback publik atau jaminan kelengkapan seluruh alamat. Import titik mencari/konfirmasi per row; segmen tetap wajib jalur nyata. Setup/update/batas: [self-hosted-geocoding.md](self-hosted-geocoding.md). Routing/data jalan, dataset jaringan, titik sambung dan formula engineering nyata masih blocker; geocoding bukan bukti estimasi kabel selesai. Smoke browser authenticated perlu login ulang.

Tambahan scope atas permintaan pengguna: migrasi `0004` mempertahankan policy lama dan menambahkan pending request/independent approval, alasan, audit/outbox dan DB trigger tanpa bypass binary lama. Frontend Pengaturan terhubung ke request/decision/history. Setelah pengguna memilih entitas pengembangan ATLAS-DEV, akun Admin existing diberikan seluruh 27 permission pada entitas tersebut secara eksplisit melalui provisioner; tidak ada seed runtime, wildcard atau hak lintas entitas otomatis. Akun pemeriksa berbeda belum disediakan. Rekomendasi role/provisioning/rollback: [policy-approvals.md](policy-approvals.md).

D-10 dan matriks role masih perlu persetujuan. CRUD administrasi akses melalui API, aktivasi/nonaktivasi akun dan perlindungan admin terakhir, serta berbagi aset antarentitas (`network_access_grants`) belum termasuk baseline ini. Frontend kini mempunyai menu berbasis izin dan pemilihan entitas melalui `/me.entityAccess`. Provisioning tetap eksplisit melalui CLI. User tanpa grant dapat login ke shell kosong; endpoint domain tetap fail-closed.

Dataset minimum, sumber Used existing, pemilik entitas, mapping topology/titik sambung, pola nama resmi, provider internal, parameter engineering dan kebijakan sharing masih perlu disediakan/divalidasi. Ledger Used hanya mencatat allocation aplikasi, bukan klaim utilisasi fisik historis yang belum dimigrasikan. Frontend domain telah dihubungkan ke API; ini bukan sign-off UAT. Load/security hardening (termasuk rate limit individual yang diselaraskan dengan kuota provider), observability, retention cleanup, backup/restore, SIT/UAT dan approval tetap gate sebelum produksi.
