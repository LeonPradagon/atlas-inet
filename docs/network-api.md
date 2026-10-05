# API baca jaringan

Implementasi backend berdasarkan PRD v1.1 bagian 6.4, 10, dan 11. Bukan implementasi lengkap import/publish atau transaksi kapasitas.

## Akses

Semua endpoint memerlukan sesi Better Auth dan permission `network.read` pada entitas pemilik aset. Entitas/role/membership harus aktif. Tidak ada bypass Admin atau berbagi jaringan antarentitas secara otomatis. Permission global hasil union `/me.permissions` bukan otorisasi.

`GET /api/v1/me` menyediakan `entityAccess`. Grant lokal diberikan melalui CLI akses setelah scope disetujui; jangan mengubah role existing dengan permission berbeda:

```powershell
# Contoh operator dan entitas; tidak membuat akun atau dataset jaringan.
npm run access:grant -- --email operator@example.com --entity-code ENTITY_CODE --entity-name "Nama entitas yang disetujui" --role-code network-reader --permissions entities.read,network.read
```

## Endpoint

| Endpoint | Hasil |
| --- | --- |
| `GET /api/v1/network/segments` | List segmen terotorisasi yang berpotongan dengan viewport, geometry dipotong untuk tampilan |
| `GET /api/v1/network/segments/:id` | Detail segmen dengan geometry asli, topology IDs/nodes, kabel, kapasitas installed, provenance dan relasi aset |
| `GET /api/v1/network/map` | GeoJSON FeatureCollection untuk segmen, tiang, ODC dan ODP dalam viewport |
| `GET /api/v1/network/search` | Cari nama/kode segmen/kabel dan kode tiang/ODC/ODP pada seluruh dataset published entitas; hasil GeoJSON siap untuk navigasi peta |

List/map hanya membaca dataset `PUBLISHED`. `DRAFT` dan `ARCHIVED` tidak ditampilkan. Import/publish kini tersedia melalui domain import; lihat `docs/operations-api.md`. Tidak ada dataset contoh yang ditambahkan oleh migrasi.

### Query list dan map

| Parameter | Aturan |
| --- | --- |
| `entityId` | UUID wajib; izin diperiksa server-side |
| `bbox` | Wajib: `west,south,east,north`; longitude -180..180, latitude -90..90; west < east dan south < north |
| `page` | Integer 1..1.000.000, default 1 |
| `pageSize` | Integer 1..100, default 25 |
| `status` | List segmen saja: opsional `ACTIVE` / `INACTIVE`; tanpa filter keduanya dapat tampil |
| `layers` | Map saja: daftar dipisahkan koma, `segments,poles,odc,odp`; default semua, duplikat dihapus |

Parameter lain ditolak. Viewport yang melintasi antimeridian harus dibagi menjadi dua request; bbox terbalik tidak dianggap sebagai wrap. Polygon viewport bukan kontrak endpoint ini.

### Query pencarian

`GET /api/v1/network/search?entityId=<UUID>&q=<teks>&limit=15` menerima `q` 2–120 karakter dan `limit` 1–25 (default 15). Pencarian mencakup `segmentCode`, `cableName`, serta kode pole/ODC/ODP yang berada pada dataset published di entitas tersebut. Hasil diurutkan exact/prefix match dahulu; wildcard `%` dan `_` diperlakukan sebagai teks biasa. Respons berisi GeoJSON FeatureCollection-style features dengan geometry canonical, `matchType`, dan total hasil. Tidak memerlukan bbox, jadi dapat menemukan aset di luar viewport saat ini. Client memilih hasil untuk menggeser peta ke geometry. Alamat customer bukan target pencarian ini.

Contoh URL (ganti `<entity UUID>` dengan grant nyata):

```text
/api/v1/network/segments?entityId=<entity UUID>&bbox=106.7,-6.4,107,-6&pageSize=25
/api/v1/network/map?entityId=<entity UUID>&bbox=106.7,-6.4,107,-6&layers=odc,odp
```

List mengurutkan `segmentCode,id`; map mengurutkan `layer,id`. Pagination dihitung setelah scope, dataset dan viewport. `meta` berisi `page`, `pageSize`, `total`, `geometryClipped: true`; map juga menyertakan `layers`. Page kosong tetap menyertakan total. Untuk mengambil semua halaman viewport, client perlu meneruskan pagination; request tunggal bukan seluruh dataset nasional.

Segment geometry pada list/map dipotong menggunakan PostGIS terhadap bbox dan dinormalisasi menjadi LineString/MultiLineString. Interseksi yang hanya menyentuh sudut bbox tanpa panjang garis tidak ditampilkan sebagai marker. Point aset tidak diubah. Detail mengembalikan geometry asli. Geometry viewport adalah data tampilan, bukan sumber nearest-distance/engineering.

### Data segmen

Data menyertakan ID stabil, `ownerEntityId`, `datasetId`, `datasetVersion`, `segmentCode`, `cableName`, master `cableType`, `installedCoreCount`, `capacityValidated`, `installationMethod`, `roadSide`, pasangan `startNodeId/endNodeId`, status, row version, geometry, assetCounts dan provenance.

`roadSide` relatif arah start → end. Detail menyediakan `nodes.start/end` dan `assets.poles/odcs/odps`. Pole memiliki `heightM` 7 atau 9. ODC dan ODP mempunyai kode, koordinat, relasi dan array berbeda; tidak dijadikan kapasitas core segmen atau kapasitas port.

Metadata yang belum tersedia tetap nullable. `completeness` berisi `status: COMPLETE | INCOMPLETE` dan `missingFields`. Field yang diperiksa: tipe kabel, kapasitas tervalidasi, metode pemasangan, topology, sisi jalan; AERIAL juga ditandai incomplete jika tanpa relasi tiang. BURIAL tidak memerlukan tiang. `COMPLETE` hanya indikator metadata; bukan sertifikasi kelayakan fisik atau jaminan booking tersedia.

Detail dan list sekarang memuat `capacity`: Total, Used, Booked, Idle, Available, waitingCount/waitingCores, expiryPendingCount dan asOf. Nilai berasal dari ledger allocation/booking canonical, bukan angka sementara. `Idle = Total − Used`; `Available = Total − Used − Booked`; booking expired tidak dihitung walaupun worker belum mengubah status. Kapasitas tidak diketahui/tidak tervalidasi tetap `null`. Data PIC tidak disertakan dalam API `network.read`. ID tetap saat rename; mutasi/history memerlukan kontrak/izin pada `docs/operations-api.md`.

### Data peta

`data` adalah GeoJSON FeatureCollection. Feature properties wajib: `id`, `name`, `layer`, `ownerEntityId`, `datasetId`, `datasetVersion`. Feature ID berformat `layer:UUID` untuk mencegah bentrok antartabel. Layer ODC memakai `odc`, ODP memakai `odp`; `odcOdp` tidak diterima. Pole menambahkan heightM; segmen menambahkan segmentCode/status/capacityValidated.

## Validasi schema

- PostGIS WGS84/SRID 4326 dan geometry 2D, nonempty, valid, koordinat dalam rentang.
- Segmen hanya LineString/MultiLineString dengan panjang geometris positif; aset/node berupa Point.
- Kapasitas known integer positif, status/method/road-side enum, node start/end berpasangan.
- Composite foreign key mengikat dataset, topology dan relasi aset ke owner/dataset yang sama.
- Kode segmen/aset unik per owner; identitas source `(owner, sourceSystem, externalId)` unik jika externalId tersedia. Ini constraint dasar, bukan implementasi deduplikasi/import-upsert.
- Master tipe kabel tidak di-seed. Provenance mencatat sumber/system/file/external ID serta pencipta dan waktu.
- GiST pada geometry dipakai oleh predicate viewport. Target p95/100.000 segmen PRD belum di-load-test.

## Error

- 400: UUID/bbox/pagination/layer/filter tidak valid.
- 401: sesi tidak valid/kedaluwarsa.
- 403: list/map diminta untuk entitas tanpa `network.read`.
- 404: detail tidak ditemukan, dataset tidak published, atau aset di luar scope. Respons sama agar keberadaan aset lain tidak bocor.

Respons mengikuti envelope bisnis `{ data, meta? }` dan error `{ error: { code, message }, requestId }` yang sudah tersedia.

## Batas tahap ini

PATCH metadata, master cable-type, naming/history dan staging/publish KML/Excel tersedia di domain operations dengan authorization, row locks, version/audit dan rollback transaksi. Permanent delete, rekonsiliasi otomatis endpoint/geometri dan temporal query geometry historis belum tersedia. Pola nama resmi, dataset dan topology tetap memerlukan persetujuan stakeholder; tidak dibuat dari contoh PRD.

Frontend belum memanggil endpoint ini; pilihan layer yang sudah ada tetap menggunakan fitur kosong sampai integrasi data tahap berikutnya. Tidak ada grant atau dataset lokal yang dibuat otomatis. Pengujian `npm run test:network` menggunakan fixture sintetis hanya dalam database sementara yang dihapus setelah selesai.

Migrasi jaringan additive. Rollback aplikasi sebelumnya dapat mempertahankan tabel jaringan; tidak memerlukan drop tabel atau perubahan auth/access. Publish/contract destruktif bukan bagian tahap ini; ambil backup sebelum migrasi produksi.
