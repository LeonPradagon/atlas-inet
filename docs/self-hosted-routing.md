# Routing jalan internal

## Cakupan dan batas

Routing engine **GraphHopper 11.0** (Apache-2.0) memakai extract OSM dari Geofabrik. Permintaan lokasi tidak dikirim ke layanan routing publik. Setup nasional memerlukan Linux/Java **25+**, Node.js **20+**, minimal **16 GB RAM**, dan **80 GB ruang kosong** sebagai ambang awal konservatif; ukur ulang pada host produksi dan saat import. Proses graph build dapat lama dan membutuhkan ruang/RAM besar. Tidak ada provisioning cloud otomatis.

Jarak yang dihitung adalah rute jalan kendaraan dari lokasi input ke titik ODC/ODP tervalidasi pada segmen terdekat. Ini **bukan lintasan kabel**. `car_shortest` memakai GraphHopper custom `distance_influence: 1000` sebagai pembanding detour, bukan jaminan shortest-path matematis dan belum disahkan Engineering. Hasil tetap perlu survei.

## Setup di host routing yang disetujui

Jalankan dari checkout repository pada host yang memenuhi prasyarat. Default mengambil nasional; pilot bisa memakai extract Geofabrik wilayah yang lebih kecil. Setup memerlukan konfirmasi eksplisit dan memeriksa RAM/disk sebelum mengunduh:

```sh
ROUTING_SETUP_CONFIRM=INDONESIA npm run routing:setup
npm run routing:start
```

Untuk host kecil, script menyediakan profil `small`: heap Java dibatasi `512m–4g`, guard default menjadi **6 GB RAM** dan **20 GB disk**, serta extract nasional ditolak. Ini bukan jaminan import berhasil; gunakan extract regional yang benar-benar kecil, awasi penggunaan RAM/disk, dan pastikan host tidak sedang menjalankan beban lain. Pilih URL extract `.osm.pbf` yang tersedia di Geofabrik dan ukur ukurannya sebelum menjalankan:

```sh
ROUTING_PROFILE=small \
ROUTING_SETUP_CONFIRM=SMALL_PILOT \
ROUTING_OSM_PBF_URL='<URL regional .osm.pbf Geofabrik yang sudah diverifikasi>' \
ROUTING_DATASET_NAME=regional-pilot \
npm run routing:setup
```

URL wajib benar-benar tersedia. Untuk profil `small`, `ROUTING_MIN_FREE_DISK_GB` dan `ROUTING_MIN_RAM_GB` dapat diubah eksplisit setelah sizing; default profil `standard` tetap 80 GB/16 GB dan heap 2g–12g. Menurunkan guard hanya melewati pemeriksaan awal, bukan jaminan import selesai atau aman. Tidak ada unduhan yang dijalankan otomatis.

Setup mengambil GraphHopper JAR 11.0 pinned dan PBF pilihan, memvalidasi SHA-256 JAR serta checksum MD5 upstream PBF, lalu menyimpan SHA-256 dataset dan profil heap di `var/routing/active.json`. Import mengecualikan `footway`, `construction`, `cycleway`, `path`, dan `steps` untuk routing kendaraan. Data tidak masuk Git. Startup pertama membangun graph, baru kemudian gateway internal listen pada `127.0.0.1:2323/route`. Biarkan service tetap hidup. Tidak ada fallback ke provider publik.

Konfigurasi backend **dan worker**:

```dotenv
ROUTING_INTERNAL_URL=http://127.0.0.1:2323/route
```

Untuk Docker, `127.0.0.1` menunjuk ke container, bukan host routing. Gunakan alamat internal yang dapat dijangkau dari container. Bila gateway harus bind ke interface jaringan, set `ROUTING_GATEWAY_BIND` ke interface privat dan wajib batasi port 2323 dengan firewall/network ACL hanya untuk backend/worker. Gateway tidak menyediakan autentikasi atau TLS; jangan expose ke internet. Provisioning multi-host, firewall, TLS, supervision, backup, dan load test masih perlu ditetapkan.

## Estimasi kabel dan aktivasi

Backend memberi timeout routing 30 detik. Adapter memvalidasi geometry, jarak, versi policy, dan versi road dataset. Hasil menyertakan provenance routing. Namun estimasi panjang kabel tetap **null/nonaktif** sampai seluruh prasyarat tersedia:

1. Road graph telah terbangun dan service siap.
2. Data network segment serta relasi ODC/ODP tervalidasi dan published.
3. `connection_point_id` menunjuk ODC/ODP yang benar-benar terhubung ke segmen itu.
4. Engineering menyetujui metode detour dan formula slack/tambahan; policy approval dilakukan melalui alur pengaturan terpisah.
5. SIT/UAT menguji contoh rute lapangan representatif dan mengonfirmasi perilaku profile kendaraan.

Jangan menyetujui policy hanya untuk menghilangkan status belum tersedia. `car_shortest` baseline saat ini adalah proxy heuristik dan perlu evaluasi Engineering sebelum dijadikan dasar ambang detour produksi. Rute jalan bukan jalur duct/tiang aktual.

## Data, lisensi, dan pembaruan

OSM memerlukan attribution **© OpenStreetMap contributors · ODbL 1.0**. Tinjau kewajiban atribusi, distribusi derivative database, dan penggunaan output sebelum produksi. Geofabrik memperbarui extract; tiap instalasi menyimpan hash dataset agar hasil dapat ditelusuri. Tidak ada auto-update.

Jangan overwrite graph aktif untuk pembaruan. Siapkan instalasi/data versioned baru, build serta smoke-test terpisah, bandingkan rute lapangan, lalu cutover dengan rollback yang disetujui. Script saat ini sengaja menolak setup ulang bila `active.json` telah ada; prosedur blue-green/rollback otomatis belum dibuat.
