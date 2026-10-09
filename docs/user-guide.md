# Panduan Pengguna ATLAS

> Panduan ringkas untuk pengguna yang baru pertama kali memakai ATLAS. Nama menu dan tombol dapat berubah; menu yang terlihat bergantung pada izin akun.

## Mulai

1. Buka alamat ATLAS dari administrator.
2. Masuk dengan email kerja dan password akun yang sudah diaktifkan. Jika belum punya akun atau login gagal, hubungi administrator—pendaftaran mandiri tidak tersedia di aplikasi.
3. Pastikan Anda berada pada entitas kerja yang benar sebelum membaca atau mengubah data. Saat ini aplikasi menggunakan entitas pertama yang diberikan ke akun dan belum menyediakan pemilih entitas. Jika entitasnya salah, berhenti dan minta administrator memperbaiki akses.
4. Gunakan navigasi di sisi kiri. Menu yang tidak muncul biasanya berarti akun belum memiliki izin untuk fitur itu.

## Alur kerja umum

### 1. Lihat jaringan di Peta Jaringan

- Buka **Jaringan & Analisis → Peta Jaringan**.
- Gunakan **Tampilan peta** untuk memilih Liberty, Bright, Satelit, atau 3D.
- Centang layer yang ingin ditampilkan: segmen, tiang, ODC, ODP, POP, area referensi, atau placemark KML.
- Peta memuat data untuk area yang sedang terlihat. Setelah menggeser peta, tekan **Muat data area ini**. Jika area yang sama perlu dimuat ulang, tekan **Perbarui data peta**.
- Mengubah checkbox layer dapat memuat ulang data. Pada dataset besar, peta mungkin sementara kosong; tunggu sampai status pemuatan selesai. Jika tetap kosong, periksa layer yang aktif dan muat ulang area.
- Jika semua layer dimatikan, seluruh fitur jaringan memang tidak ditampilkan. Basemap tetap terlihat.

### 2. Cari jaringan terdekat lewat Analisis Lokasi

- Buka **Jaringan & Analisis → Analisis Lokasi**.
- Pilih **Koordinat GPS** dan masukkan lintang/bujur, atau pilih **Alamat** dan masukkan alamat selengkap mungkin.
- Tekan **Cari jaringan terdekat**. Jika alamat menghasilkan beberapa kandidat, pilih dan verifikasi lokasi yang benar sebelum analisis dilanjutkan.
- Hasil menunjukkan jaringan terdekat, jarak garis lurus, rute jalan, dan estimasi kabel jika datanya tersedia. Jarak garis lurus bukan panjang kabel; estimasi tetap perlu verifikasi survei.
- Analisis lokasi tidak membuat booking.

### 3. Ajukan Booking Core

- Buka **Booking & Kapasitas → Booking Core**.
- Pilih segmen, lalu isi nama customer, PIC customer, kontak, PIC Presales, jumlah core, dan alasan kebutuhan. Referensi customer bersifat opsional.
- Periksa status kapasitas sebelum mengirim. Booking hanya dapat diterima jika total core sudah diisi dan divalidasi serta Available mencukupi.
- Tekan **Konfirmasi booking core**, lalu periksa notifikasi hasil dan tabel **Status dan riwayat booking**.
- Booking menahan kapasitas sesuai masa berlaku kebijakan. Catat status dan tanggal berlaku; gunakan aksi **Release** bila booking dibatalkan. Aksi tertentu hanya tersedia bagi akun berizin.

### 4. Gunakan Daftar Tunggu

- Jika kapasitas belum tersedia, buka **Booking & Kapasitas → Daftar Tunggu**.
- Pilih segmen dan isi data customer, PIC, jumlah core, serta alasan seperti saat membuat booking.
- Permintaan masuk antrean FIFO dan belum mengalokasikan core sampai dialokasikan. Pantau statusnya di tabel waiting list.
- Aksi alokasi atau pembatalan memerlukan izin tertentu. Alokasi waiting list akan memakai kapasitas yang tersedia.

### 5. Lihat Laporan dan Notifikasi

- **Monitoring → Laporan & Ekspor** menampilkan snapshot utilisasi: total, Used, Booked, Idle, Available, dan Waiting. Klik segmen untuk membuka detail.
- Jika memiliki izin ekspor, tekan **Buat snapshot export**, pantau job, lalu unduh XLSX saat selesai.
- **Monitoring → Notifikasi** menampilkan pemberitahuan milik akun. Buka notifikasi untuk menuju konteks terkait; tandai dibaca bila sudah ditindaklanjuti.

## Fitur untuk peran tertentu

- **Aset & Impor Jaringan** menerima KML/KMZ. Preview memberi ringkasan sebelum ditinjau. Import dapat menerbitkan fitur yang lolos klasifikasi/validasi otomatis dan menggabungkan data—import tidak menghapus aset atau booking. Pastikan entitas dan file benar sebelum upload. Kapasitas, tinggi tiang yang tidak ada di sumber, dan topologi tidak ditebak otomatis.
- **Analisis banyak lokasi** menerima template XLSX, KML, atau KMZ. Upload memvalidasi dan menampilkan preview. Tombol **Setujui proses baris valid** memulai job analisis massal; ini bukan persetujuan kebijakan. Pantau job lalu unduh hasil XLSX.
- **Pengaturan** digunakan untuk mengajukan perubahan kebijakan. Pengajuan baru berstatus Pending dan belum mengubah kebijakan aktif sampai pemeriksa berbeda menyetujuinya. Approval memerlukan izin sesuai jenis kebijakan.
- **Administrasi → Buat Akun** hanya tersedia bagi akun dengan izin `accounts.manage` pada entitas aktif. Pilih Booking User untuk membuat/melihat booking atau Booking Manager untuk menambah release dan konversi ke Used. Password awal ditetapkan admin dan dibagikan melalui kanal terpisah; pendaftaran mandiri tetap ditutup.
- **Audit Log** menampilkan riwayat aksi yang berhasil pada entitas. Detail dibatasi agar tidak menampilkan data customer atau kontak.

## Istilah penting

- **Available** adalah kapasitas yang tersedia menurut data tervalidasi dan pencatatan di sistem; bukan verifikasi kondisi fisik jaringan.
- **Used** adalah pemakaian yang dicatat pada ledger. Jangan mencatat pemakaian existing dua kali.
- **Idle** mencakup core Booked. Waiting List belum mengurangi Available sampai dialokasikan.
- **Estimasi kabel/rute** bersifat awal dan bukan pengganti survei lapangan.
- Nama role bukan penentu akses; izin fitur pada entitas yang dipilih yang menentukan menu dan aksi.

## Jika ada kendala

- **Menu/aksi tidak ada atau akses ditolak:** hubungi administrator untuk memeriksa entitas dan izin akun.
- **Data kosong:** pastikan entitas benar, filter status tidak membatasi hasil, dan area peta sudah dimuat.
- **Peta kosong setelah mengubah layer:** tunggu status pemuatan. Aktifkan kembali layer yang diperlukan; bila perlu muat ulang area.
- **Kapasitas belum diketahui atau booking ditolak:** jangan menebak kapasitas. Minta tim jaringan memverifikasi total core dan pencatatan kapasitas terlebih dahulu.
- **Job atau upload terlihat gagal tetapi hasil belum jelas:** periksa status/history terlebih dahulu sebelum mencoba ulang, agar tidak membuat pemrosesan ganda.

Untuk prosedur pemeriksaan dan dukungan, hubungi administrator ATLAS atau tim operasi yang bertanggung jawab atas entitas Anda.
