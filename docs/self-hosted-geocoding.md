# Geocoding internal Indonesia

## Pilihan dan batas

Photon **1.3.0**, OpenSearch embedded, [dump khusus Indonesia](https://download1.graphhopper.com/public/asia/indonesia/index.html). Tidak memakai endpoint demo/public. API/worker hanya mengirim alamat ke layanan lokal, bukan nama customer/PIC/contact. Download software/dataset membutuhkan internet; pencarian alamat tidak.

Instalasi lokal 3 Oktober 2026 berhasil mengimpor **1.267.812 dokumen**. Dump stabil dipublikasikan 28 September 2026; `/status` menyatakan tanggal data **2026-09-26T22:59:05Z**. Tanggal publikasi, tanggal sumber dan tanggal instalasi berbeda. OSM tidak menjamin kelengkapan/kemutakhiran seluruh alamat Indonesia.

Versi sumber lokal: `photon-indonesia:sha256:9cda1074875700354e2a099d1d84da670c812092b9135228f21cc7ec42ad270a`. Jangan memakai hash ini untuk dump lain. Provenance disimpan dalam hasil analisis/bulk atau preview import dan audit konfirmasi, bukan ditambahkan palsu pada aset existing.

## Menjalankan lokal

Prasyarat: Java 21+, Node.js dengan `createZstdDecompress` (Node 24+ direkomendasikan), internet saat setup, disk untuk JAR/dump/JSONL/index. Teruji pada Java 26/Node 26. Heap Photon **1 GB**, bukan batas seluruh penggunaan RAM. Ini sizing pengembangan, belum load-test produksi. Import lokal sempat menerima 429 internal OpenSearch dan berhasil setelah retry.

Dari root repository:

```powershell
npm run geocoding:setup
# Terminal terpisah; tetap berjalan.
npm run geocoding:start
```

Setup mengunduh JAR pinned (~98 MB), memverifikasi SHA-256 release, mengunduh dump (~176 MB), memverifikasi MD5 upstream dan merekam SHA-256 dump. Import hanya ke direktori **baru** `var/geocoding/indonesia-*`. `active.json` dibuat eksklusif setelah import berhasil. Setup ulang mempertahankan instalasi aktif; kegagalan tidak mengaktifkan index parsial. `var/` dan `.env` tidak masuk Git.

Konfigurasi `.env` API **dan** worker:

```dotenv
PHOTON_INTERNAL_URL=http://127.0.0.1:2322
GEOCODING_DATASET_VERSION=photon-indonesia:sha256:<SHA-256-dump-yang-benar>
```

Jangan aktifkan `GEOCODING_INTERNAL_URL` bersama `PHOTON_INTERNAL_URL`; konfigurasi ditolak. Adapter lama dipertahankan untuk kompatibilitas. Tidak ada fallback publik.

Untuk **development individual saja**, `PHOTON_PUBLIC_DEV_URL=https://photon.komoot.io` mengaktifkan Photon publik Komoot. Opsi ini ditolak saat `NODE_ENV=production`, tidak boleh digabung dengan provider lain, dan sengaja tidak dipakai job bulk maupun lookup import. Query individual mengirim alamat ke internet; gunakan alamat sintetis/non-customer. Photon menyatakan penggunaan ekstensif dapat di-throttle dan tidak menjamin availability. Hasil menandai provider `PHOTON_PUBLIC_DEV` dan atribusi OpenStreetMap. Jangan memakai endpoint publik ini untuk SIT/UAT ber-volume atau produksi; gunakan instance Photon self-hosted.

```powershell
npm run dev:backend
# Terminal lain, setelah kompilasi/API listening selesai:
npm --prefix apps/backend run worker
# Frontend di terminal lain:
npm run dev
```

Watch Nest membersihkan `dist` saat startup. Worker yang dimulai bersamaan dapat gagal `ERR_MODULE_NOT_FOUND`; jalankan ulang setelah kompilasi selesai. Jangan menjalankan dua watcher yang membersihkan output yang sama. Worker perlu restart setelah perubahan kode/config.

Health: `http://127.0.0.1:2322/status`. Photon bind loopback 2322; OpenSearch embedded harus tetap loopback 9201/9300. Jangan expose index/OpenSearch ke LAN/internet. Produksi multi-host, firewall/TLS, supervision, sizing, backup dan retensi log belum ditetapkan. Geocoder belum menjadi service Compose; `127.0.0.1` dari container bukan host Windows.

## Pemakaian

1. Login, pilih entitas berizin, buka **Analisis**, pilih **Alamat**, isi alamat lengkap. Native query dibatasi Indonesia/maksimal 5 kandidat; timeout 5 detik, response 1 MB, redirect ditolak.
2. Kandidat ambigu atau satu titik tanpa house number tetap memerlukan konfirmasi. Tidak diam-diam memakai titik kota/jalan sebagai alamat tepat. Photon tidak memiliki confidence score terkalibrasi. Label/precision bukan sertifikasi lokasi; `needsSurvey` selalu true.
3. **Bulk**: unggah KML/KMZ dengan satu Point atau address-only Placemark per lokasi. `ExtendedData` dapat menyediakan `reference_id`, `customer_name`, `address`, `notes`, optional UUID `connection_point_id` bersama `connection_point_type` (`ODC`/`ODP`). Point bypass geocoding; alamat saja diproses melalui provider internal.
4. Setujui proses setelah preview. Download Results/Errors/Summary sebagai XLSX memuat koordinat hasil, provider/versi, kandidat ambigu, status rute dan estimasi yang tersedia. Kandidat alamat ambigu dapat diverifikasi lalu dikirim ulang sebagai Placemark Point berkoordinat eksplisit di KML/KMZ baru.
5. **Import aset titik**: sheet `Assets`, NODE/POLE/ODC/ODP boleh memakai `address` tanpa geometry. Klik **Cari koordinat** per baris lalu **Konfirmasi kandidat**. Lookup sendiri belum menyelesaikan row/publish. Lookup stale/index invalid ditolak. POLE tetap wajib tinggi 7/9 m. Error UI dipaginasi 25 baris/halaman.
6. KML tanpa geometry boleh memakai `<address>` dengan kind/ID/code eksplisit; mapping kind tetap wajib. Geometry/koordinat existing tidak di-geocode. Geometry invalid tidak diganti diam-diam lewat alamat.

**SEGMENT tetap memerlukan garis jalur nyata**. Alamat tidak menentukan lintasan kabel. Geocoding bukan routing, validasi lokasi aset, kapasitas, standar naming atau formula engineering. Nearest/booking memerlukan jaringan; estimasi kabel memerlukan titik sambung, routing dan formula approved.

Attribution: © [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) · ODbL 1.0. Review kewajiban distribusi ODbL, termasuk hasil Excel, sebelum produksi.

## Update dan rollback

Belum ada auto-update. Operator harus memeriksa tanggal dump/cakupan berkala; frekuensi bisnis perlu disepakati. Photon `import` mereinisialisasi index: **jangan import ke index aktif**.

Update manual: download/verify ke direktori baru, import index baru, jalankan kandidat di port loopback berbeda, periksa `/status` dan alamat representatif. Setelah lulus, hentikan service lama, arahkan manifest aktif ke instalasi baru dan restart. Sinkronkan `GEOCODING_DATASET_VERSION` API/worker. Simpan manifest/index lama untuk rollback. Automasi blue-green belum tersedia; jangan menghapus index lama untuk memaksa `setup` berjalan.

Rollback: hentikan API/worker, kembalikan manifest/config sebelumnya lalu restart. Hasil tersimpan mempertahankan versi saat dihitung. Menghapus konfigurasi menghasilkan `GEOCODING_NOT_CONFIGURED`, bukan fallback publik/koordinat nol. Tidak perlu migrasi turun database.

## Bukti dan blocker

- Pencarian Photon dan adapter lokal untuk **Monumen Nasional Jakarta** menghasilkan kandidat nyata termasuk monumen/halte; adapter memberi `AMBIGUOUS_ADDRESS`, tidak memilih halte diam-diam.
- Backend **82/82**, frontend **26/26** tes lulus; typecheck/build lulus. Tes workflow memakai PostGIS/database sementara dan provider mock. Browser authenticated memerlukan login ulang (sesi saat smoke memberi 401). Ini bukan SIT/UAT/load-test.
- Booking/release/expiry/FIFO/notifikasi diuji dalam database sementara, bukan booking operasional nyata. Dataset jaringan utama/checker independen belum tersedia; tidak menanam data operasional contoh untuk melewati blocker.
