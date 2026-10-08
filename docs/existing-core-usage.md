# Pencatatan kapasitas dan Used existing

## Tujuan dan cara pakai

Pemakaian fisik sebelum aplikasi digunakan tidak boleh dibuat sebagai booking palsu. Buka detail segmen pada booking, peta, atau Aset & Impor Jaringan, lalu gunakan **Catat kapasitas dan Used existing yang belum tercatat**. Dibutuhkan izin `network.write` dan `allocations.write` pada entitas pemilik; daftar alokasi membutuhkan `network.read`.

1. Verifikasi total core fisik dan ledger Used yang sudah tercatat.
2. Isi **Used existing belum tercatat** saja, bukan Used keseluruhan. Isi 0 hanya jika benar-benar diverifikasi tidak ada pemakaian yang belum tercatat.
3. Isi referensi inventaris/survei dan alasan; konfirmasi hasil verifikasi.
4. Sistem menyimpan kapasitas tervalidasi dan alokasi existing dalam satu transaksi. Total 24, existing Used 6, lalu booking 2 menghasilkan Available 16.
5. Daftar alokasi menandai **Used existing** vs **Aktivasi booking**. Penutupan alokasi membutuhkan alasan, menyimpan histori, dan mengembalikan Available. Jangan tutup alokasi yang masih digunakan secara fisik hanya untuk membuka kapasitas booking. Untuk koreksi inventaris, hentikan penerimaan booking sementara dan lakukan rekonsiliasi terkontrol; fitur ini bukan workflow survei/approval lengkap.

Data fisik tidak diisi otomatis. Kolom kosong tetap perlu diverifikasi oleh tim jaringan. Penamaan dan metadata lain tidak diubah.

## Invariant dan API

- `POST /api/v1/network/segments/:id/existing-usage`: `If-Match` versi segmen dan `Idempotency-Key` wajib. Body: `installedCoreCount`, `existingCoreCount`, `operationalReference`, `reason`, `verified: true`.
- Total tidak boleh di bawah Used tercatat + Booked aktif + existing belum tercatat. Segment row lock yang sama dengan booking memastikan transaksi bersamaan tidak overbook. Versi stale ditolak. Permission diperiksa sebelum replay.
- Retry identik tidak membuat alokasi/audit ganda; payload berbeda dengan key sama ditolak. Hanya satu alokasi existing aktif per segmen, diperkuat unique index database. Existing=0 tidak membuat alokasi core nol.
- Existing memakai `core_allocations.source_booking_id = NULL`. Alokasi dari booking tetap memiliki source ID, foreign key, dan keunikan yang sama. Semua pembaca kapasitas existing menjumlahkan alokasi aktif sehingga monitoring/nearest/detail/booking memakai ledger yang sama.
- `GET /api/v1/network/segments/:id/allocations` menampilkan alokasi aktif dengan pagination maksimal 100. Penutupan memakai endpoint deallocate existing, bukan menghapus histori.

## Migration, preservation, rollback

Migration `0014_existing_core_usage` hanya melepas NOT NULL pada source booking dan menambah partial unique index untuk existing aktif. Tidak mengisi nilai kapasitas, membuat alokasi, mengubah booking existing, atau menghapus data.

Urutan rollout: backup source/image/database → build → jalankan migration → deploy API/worker/web. Pembaca lama tetap menghitung Used existing dengan benar karena menjumlahkan seluruh alokasi aktif tanpa join booking. Jalur aktivasi booking lama tidak berubah.

Rollback aplikasi dapat memakai image sebelum deployment sambil **mempertahankan schema yang diperluas**. Jangan mengembalikan NOT NULL jika ada alokasi existing (termasuk histori yang sudah ditutup). Reversal schema hanya boleh dilakukan setelah membuktikan tidak ada row source booking NULL; jangan menghapus data untuk memaksa rollback. Backup database bukan instruksi untuk me-restore dan membuang transaksi yang terjadi setelah deployment.

## Verification

- Backend full suite **116/116** lulus di container PostGIS terpisah: total/Used/Available, monitoring, tanpa booking palsu, race dengan booking, retry, audit, zero usage, permission isolation, dan migration rerun yang mempertahankan ledger.
- Frontend **52/52** lulus: input/verifikasi mandatory, request capacity+Used direct, refresh counter, dan tidak memanggil booking.
- Typecheck frontend/backend dan build frontend/backend lulus. Tes menggunakan data sintetis; bukan bukti kapasitas fisik server telah lengkap.
- Deploy server berhasil dan API/web sehat. Browser booking menunjukkan form existing dengan total/Used/referensi/alasan wajib serta checkbox verifikasi; submit kosong dinonaktifkan. GET ledger authenticated HTTP 200. Schema server terbukti nullable dan partial unique index terpasang. Existing allocation server tetap 0: smoke tidak mengisi nilai fisik sintetis. Backup source/image/database tersedia di `/opt/atlas-backups/existing-usage-20261008` dengan directory root-only; image rollback bertag `atlas-existing-*-rollback:20261008`.
