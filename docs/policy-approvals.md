# Approval kebijakan — rekomendasi awal

Lingkup: perubahan booking-policy, naming-policy dan analysis-policy. Bukan approval setiap booking, import atau analisis; lifecycle domain tersebut tetap mengikuti business flow sebelumnya.

## Alur maker–checker

1. Pengaju berizin `settings.read`/`settings.write` membaca kebijakan aktif dan mengisi usulan lengkap beserta alasan.
2. Submit memakai `If-Match` versi aktif dan `Idempotency-Key`; pengajuan tersimpan `PENDING`. Kebijakan aktif **belum berubah**.
3. Pemeriksa pada **entitas yang sama** membandingkan nilai sebelum/usulan dan menulis alasan keputusan. Booking/naming memerlukan `settings.approve-operational`; radius/formula memerlukan `settings.approve-engineering`.
4. Approve menghasilkan `APPROVED` dan satu versi aktif baru dalam transaksi yang sama. Reject menghasilkan `REJECTED` tanpa mengubah kebijakan aktif. Pengaju dapat withdraw menjadi `CANCELLED`; pengajuan tidak diedit/dihapus. Koreksi memakai pengajuan baru.
5. Pengaju **tidak boleh approve atau reject pengajuannya sendiri**, termasuk Administrator. Approver yang permission-nya dicabut tidak dapat mengambil keputusan; requester yang kehilangan `settings.write` tidak dapat diaktifkan pengajuannya.

Request stale (baseVersion tidak lagi sama dengan kebijakan aktif) tidak bisa diapprove. Batalkan/tolak lalu ajukan berdasarkan versi terbaru. Dua approval bersaing diserialisasi dengan advisory lock kebijakan dan row lock request; tidak ada lost update. Replay keputusan sama oleh aktor sama/alasan sama tidak menggandakan versi/audit/outbox.

Checkbox naming/formula di form menyatakan **usulan aktivasi setelah approval**, bukan bukti pengaju telah menyetujui kebijakan. Pola nama/parameter engineering tidak diisi otomatis. Kebijakan baru tidak mengubah expiry booking existing atau otomatis mengganti nama aset.

Audit menyimpan pengaju, pemeriksa, alasan, waktu, baseVersion/approvedVersion dan resource ID. Notifikasi in-app memakai transactional outbox/worker untuk pengaju dan approver terkait; tim `notifications.receive` tetap menerima event sesuai kontrak existing. Payload notifikasi tidak memuat nilai kebijakan/kontak. UI Pengaturan mempunyai queue/status/history; Notifikasi menyediakan tautan ke Pengaturan.

## Rekomendasi role sementara

Authorization memakai permission, **bukan nama role**. Profile CLI merupakan set izin eksplisit; role code boleh disesuaikan dengan istilah perusahaan.

| Profile contoh | Tugas / izin |
| --- | --- |
| `administrator` | Semua 27 permission domain yang tersedia, termasuk kedua jenis approve dan jobs.read/manage, pada entitas yang dipilih. Tidak melewati self-approval atau scope resource pribadi. |
| `policy-requester` | Mengajukan/membatalkan usulan sendiri; settings.read/write dan notifications.read |
| `policy-approver-operational` | Pemeriksa booking/naming; settings.read/approve-operational, notifications.read, audit.read |
| `policy-approver-engineering` | Pemeriksa radius/formula; settings.read/approve-engineering, notifications.read, audit.read |

Untuk administrator produksi, tetap perlukan sign-off role matrix. Tidak ada wildcard, grant otomatis saat login/startup, global tenant bypass, atau akses otomatis ke entitas yang dibuat kemudian.

Contoh CLI dari `apps/backend` (email dan entitas wajib benar):

```powershell
npm run access:grant -- --email akun@example.com --entity-code ENTITY_CODE --entity-name "Nama entitas" --role-code administrator --profile administrator
npm run access:grant -- --email pemeriksa@example.com --entity-code ENTITY_CODE --entity-name "Nama entitas" --role-code reviewer-operational --profile policy-approver-operational
npm run access:grant -- --email engineering@example.com --entity-code ENTITY_CODE --entity-name "Nama entitas" --role-code reviewer-engineering --profile policy-approver-engineering
```

Pilih `--profile` **atau** `--permissions`, bukan keduanya. CLI tidak mengubah permission role existing diam-diam. Jika nama role berubah, grant profile yang sama dengan role code baru, verifikasi akses lalu revoke code lama; ini tidak mengubah histori approval atau identitas aktor. Jangan mencabut seluruh approver sebelum pengganti berizin tersedia.

## API

- `GET /settings/:key?entityId=...`: kebijakan aktif; kontrak pembaca tetap.
- `POST /settings/:key/requests?entityId=...`: `{ value, reason }`, header `If-Match`, `Idempotency-Key`; HTTP 202, pending request. Retry identik memberi ID/status existing; payload berbeda/key sama memberi 409.
- `GET /settings/requests?entityId=...&page=...&pageSize=...&key=...&status=...`: settings.read, pagination, nilai usulan dan baseValue historis. Filter key/status opsional.
- `POST /settings/requests/:id/approve` atau `/reject`: `{ reason }`, settings.read + approve permission sesuai jenis kebijakan, checker berbeda.
- `POST /settings/requests/:id/cancel`: `{ reason }`, settings.read/write dan pemilik pengajuan saja.
- `PATCH /settings/:key` lama: **409** untuk writer berizin. Tidak lagi mengaktifkan perubahan langsung. Klien lama harus memakai flow request/decision baru.

Foreign/private request ID memberi 404 bila tidak memiliki settings.read pada entitas pemilik. Missing session memberi 401; self-decision/wrong approval permission memberi 403. Alasan kosong/invalid policy ditolak sebelum staging. Semua mutasi tetap memerlukan trusted Origin.

## Migrasi / rollback

`0004_rich_junta.sql` additive: tabel request dan reference nullable pada settings. Nilai/ID/versi kebijakan lama, akun, memberships, grants dan aset dipertahankan; tidak dibuat histori approval palsu untuk data lama. Reference null menandai versi legacy.

Trigger PostgreSQL membuat versi settings immutable dan mengizinkan insert baru hanya dari request APPROVED yang cocok entity/key/value/version/checker. Request submitted/terminal juga immutable. **Binary lama tidak bisa menulis kebijakan langsung setelah migrasi**, meskipun rollout API tumpang tindih; reader/worker tetap membaca nilai aktif existing.

Urutan: backup → migrate → deploy API/UI terbaru → verifikasi reads/submit/independent decision. Rollback binary tidak menghapus schema/history: reader lama tetap bekerja, tetapi write policy lama tetap fail-closed. Jangan menonaktifkan trigger/downgrade SQL untuk memulihkan bypass; jika UI approval bermasalah, hentikan perubahan policy sementara dan forward-fix. Restore hanya melalui prosedur backup yang disetujui.

## Status lokal dan proof

- Pengguna menyetujui entitas **ATLAS-DEV / ATLAS Development** khusus pengembangan. Akun Admin existing diberi role `administrator` dengan 27 permission melalui provisioner transaksional/audit. Password dan akun tidak diganti; ini bukan seed startup.
- Migrasi lokal telah diterapkan. Database utama tetap memiliki 1 akun, 0 segmen dan 0 pengajuan kebijakan setelah provisioning; tidak ada standar engineering/nama atau usulan contoh dipublish.
- `/me` pada backend terbaru mengembalikan role/entitas/27 permission; reads settings/requests/reports/bookings/waiting-list/notifications/audit pada entitas ini memberi HTTP 200. Menu seluruh domain terlihat.
- Database utama hanya memiliki Admin. Untuk menjalankan maker–checker secara nyata, siapkan **akun pemeriksa berbeda** dan berikan profile operasional/engineering yang sesuai. Tidak dibuat akun/password pemeriksa rekaan dan tidak diaktifkan self-approval.
- Backend **76/76 tes lulus**: upgrade dari schema 0003 dengan legacy settings/grants terjaga, migration replay, pending/replay, reason validation, own/foreign/type-specific checks, rejection/cancellation, immutable history/DB legacy-write guard, competing approval/stale conflict, requester/reviewer revoke, audit/outbox dan seluruh domain existing.
- Frontend **24/24 tes lulus**, termasuk proposal version/key retry, pending bukan active, self-approval tersembunyi walau Admin, independent approve/reject dengan mandatory reason, serta batas approver engineering. Tests UI memakai mock API; bukan sign-off stakeholder.

Baseline memakai satu checker sesuai jenis policy, bukan chain bertingkat, SLA escalation, assignment pemeriksa individual atau integrasi eksternal. Ubah flow hanya setelah kebutuhan bisnis berikutnya disepakati.
