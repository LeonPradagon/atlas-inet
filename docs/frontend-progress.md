# Integrasi frontend ATLAS Phase 2

Status 3 Oktober 2026: UI terhubung ke kontrak backend melalui katalog `API_ENDPOINTS` / `atlasApi` terpusat. Tidak ada seed operasional, grant otomatis, pola nama, koordinat, rute atau sukses penyimpanan rekaan.

## Alur tersedia

| Halaman | Integrasi |
| --- | --- |
| Shell | Sesi fail-closed, pemilihan entitas `/me.entityAccess`, menu/halaman/aksi menurut permission entitas, cache user+entitas |
| Dashboard | Summary seluruh entitas dari backend; kapasitas unknown tetap ditampilkan sebagai belum diketahui |
| Peta | GeoJSON viewport/pagination, layer ODC/ODP/tiang/segmen terpisah, style Liberty/Bright/3D, pencarian fitur termuat, popup dan detail segmen |
| Analisis | Alamat/koordinat, pilihan kandidat geocoding, ID titik sambung opsional, hasil/rute/meter hanya dari API, histori pribadi |
| Bulk Excel | Template, upload/preview, persetujuan baris valid, polling job, cancel, retry kegagalan sementara dan download XLSX |
| Booking / waiting list | Form PIC lengkap, ID segmen/picker paginated, kapasitas, idempotent create, filter status, release/Used/deallocation, promosi/cancel manual |
| Aset | Template KML/XLSX, source identity/mapping, staging/preview, alamat-only titik dengan lookup/konfirmasi kandidat sebelum publish, daftar segmen, edit metadata If-Match, histori nama dan master tipe kabel immutable |
| Monitoring | Snapshot as-of, tabel kapasitas/antrean paginated, export async melalui worker dan download hasil |
| Notifikasi / audit | Notifikasi sendiri, mark-read API, filter unread halaman, audit entitas paginated |
| Pengaturan | Booking/naming/analysis policy versioned; submit pending, independent approve/reject/cancel, comparison/history dan alasan wajib; konflik versi tanpa klaim aktif |

Create booking/promotion mempertahankan `Idempotency-Key` saat retry payload sama. Pergantian entitas mereset form/hasil melalui remount; cache scope sebelumnya dibatalkan/dihapus. Backend tetap menentukan permission dan scope resource ID pada setiap mutasi. Lookup detail segmen/job di UI menolak hasil milik entitas lain meskipun akun memiliki grant di keduanya.

## Batas yang terlihat

- Peta memuat maksimal 1.000 fitur per viewport; jumlah lebih besar diberi peringatan zoom. Pencarian hanya fitur termuat, bukan pencarian seluruh dataset. Basemap memerlukan koneksi OpenFreeMap/WebGL.
- Picker segmen membutuhkan `network.read`; ID resource dapat dimasukkan langsung. PIC Presales memakai user ID; administrasi/direktori akun belum tersedia. ID allocation diperoleh dari hasil aktivasi untuk deallocation.
- Editor metadata mencakup nama, kapasitas/validasi, tipe kabel, metode instalasi, sisi jalan dan status. Editor topology/node interaktif belum tersedia; perubahan relasi memakai import tervalidasi atau API terotorisasi.
- Preview import menampilkan 100 baris pertama; error dipaginasi 25 baris/halaman. Bulk preview 100 baris sesuai kontrak backend. Staging/lookup berhasil **bukan** publish. Photon Indonesia tersedia lokal, kandidat coarse/ambigu memerlukan konfirmasi; routing/policy belum tersedia tetap ditampilkan jujur. Bulk mengekspor kandidat untuk koreksi/reupload koordinat, bukan memilih diam-diam.
- Job dapat dibuka ulang dengan ID; tidak ada API daftar semua job. Worker harus berjalan terpisah, polling browser tidak menjalankan worker. Download mengikuti retensi server 30 hari.
- Filter unread hanya berlaku pada halaman notifikasi yang dimuat. Monitoring periode historis, account/role CRUD, cross-entity sharing dan naming sequence resmi belum tersedia.

## Bukti verifikasi

```powershell
npm --prefix apps/frontend test
npm --prefix apps/frontend run typecheck
npm --prefix apps/frontend run build
npm --prefix apps/backend test
npm --prefix apps/backend run typecheck
```

- Frontend **26/26 tes lulus** (Vitest/jsdom + React Testing Library). Proof: per-entity permission tanpa Admin/wildcard/union bypass, user/entity keys, remount saat scope berubah, cache/session reset pada 401, retry key booking, domain error tanpa sukses palsu, dashboard summary/null, mark-read, dependency analisis, explicit bulk/import approval, versi policy, batas viewport, async export, FIFO conflict, create master, proposal pending/key retry dan independent approval/type-specific/self-decision rules. Tambahan proof: lookup tidak otomatis menyelesaikan staging, konflik konfirmasi tetap memblokir publish, dan analisis hanya memakai kandidat yang dipilih eksplisit.
- Tes client memeriksa multipart, paging/scope/AbortSignal, cookie credentials, If-Match, Idempotency-Key dan error envelope. Tes UI menggunakan mock API dan mock MapLibre; ini **bukan** full browser end-to-end atau proof provider produksi.
- Backend **82/82 tes lulus** memakai PostGIS nyata/database sementara; summary di luar halaman, known/unknown/empty scope, concurrency/FIFO/import/worker/Origin serta policy request/DB approval guards tetap lulus. Alamat-only bulk/import, connection point bulk dan export provenance juga lulus. Tidak ada fixture masuk database utama.
- Typecheck/build frontend/backend lulus. Frontend dependency audit production: 0 vulnerability. Build memberi warning chunk MapLibre >500 kB, bukan kegagalan.
- Smoke awal membuktikan akun bernama Admin tanpa grant tidak mempunyai bypass. Atas permintaan berikutnya, pengguna menyetujui entitas ATLAS-DEV dan akun Admin diberi role administrator dengan 27 permission eksplisit; semua menu terlihat dan reads domain berizin HTTP 200. Tidak membuat akun/password baru atau data operasional contoh. Detail maker–checker: [policy-approvals.md](policy-approvals.md).

Geocoder nyata/adapter lokal berhasil mencari Monumen Nasional Jakarta; sesi browser untuk smoke authenticated sekarang memberi 401 dan perlu login ulang. Setup/status/update: [self-hosted-geocoding.md](self-hosted-geocoding.md). Dataset/Used baseline, role matrix, official naming, topology/routing/engineering policy, load/security, backup/restore dan SIT/UAT masih menjadi gate produksi. Perubahan belum dikomit.
