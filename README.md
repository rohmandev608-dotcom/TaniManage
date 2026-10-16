# TaniManage — autentikasi dan RBAC

Aplikasi ini menggunakan Node.js native (tanpa framework/dependensi eksternal) dan SQLite bawaan Node.js. Jalankan dengan Node.js 22.13+ atau versi lebih baru:

```sh
npm start
```

SQLite membuat database `data/fmis.sqlite` otomatis dari [database/schema.sql](./database/schema.sql). Tabel `users` menyimpan `id`, `name`, `email`, `password_hash`, `role`, dan waktu pembuatan. Nilai `password_hash` berisi hash scrypt, bukan password asli. Session opaque disimpan di tabel `sessions`; browser hanya menerima token acak di cookie HttpOnly, SameSite=Lax.

## Pembuatan akun dan peran

Pendaftaran publik menyediakan peran `farmer` (default) atau `worker`. Peran `admin` tidak bisa dipilih saat mendaftar. Untuk membuat admin pertama pada database kosong, tetapkan semua variabel berikut sebelum menjalankan server:

```text
BOOTSTRAP_ADMIN_NAME
BOOTSTRAP_ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD
```

Password bootstrap wajib minimal 12 karakter. Admin yang sudah masuk dapat mengubah peran akun dari dashboard admin. Variabel bootstrap hanya membuat admin jika database belum memiliki pengguna.

## Hak akses

- `farmer`: rute `/farmer`; untuk modul pertanian berikutnya, selalu gunakan ID pengguna dari session sebagai kunci pemilik ketika mengambil atau mengubah data.
- `worker`: hanya rute `/worker` dan `/worker/tasks`, serta API `/api/worker/*`. Buruh hanya menerima lahan/musim tanam yang ditugaskan dan riwayat aktivitasnya sendiri selama penugasan masih aktif. Modul keuangan, inventaris owner, dan route farmer ditolak oleh `requireRoles`.
- `admin`: `/admin` dan `/api/admin/users` untuk pengelolaan akun. Data password tidak pernah dikirim melalui API admin.
- Middleware `requireAuth`, `requireRoles(...)`, `requireOwner(...)`, dan `requireCsrf` tersedia di [app/middleware/auth.js](./app/middleware/auth.js). Contoh API pemilik data: `GET /api/farmer/users/:userId`, yang membandingkan ID rute dengan ID session sebelum membaca record.

## CRUD lahan petani

Controller `app/controllers/LandController.js` dan model database menyediakan daftar, detail, tambah, ubah, dan hapus lahan. Halaman daftar ada di `/farmer/lands`; setiap operasi database menggunakan ID pemilik dari sesi, dan semua perubahan memakai token CSRF.

- `GET /farmer/lands` — halaman daftar lahan
- `GET /api/farmer/lands` dan `GET /api/farmer/lands/:id` — baca daftar atau detail milik sendiri
- `GET /farmer/lands/new` dan `POST /farmer/lands` — formulir dan penyimpanan lahan
- `GET /farmer/lands/:id/edit` dan `POST /farmer/lands/:id/update` — formulir dan pembaruan lahan
- `POST /farmer/lands/:id/delete` — hapus lahan milik sendiri

## Keuangan berbasis lahan

Tabel `financial_transactions` menyimpan nominal sebagai bilangan Rupiah utuh (`amount_rupiah`), `field_id` opsional, dan `crop_cycle_id` yang diisi backend saat transaksi dikaitkan ke lahan. Route `/farmer/finance` menampilkan filter lahan dan musim tanam, ringkasan pemasukan/pengeluaran/laba/margin, formulir transaksi, dan riwayat. Endpoint `GET /api/farmer/finance?fieldId=<id|unassigned>&cropCycleId=<id>` menerima filter lahan dan/atau satu musim tanam; tanpa filter akan mengembalikan seluruh transaksi petani. Saat membandingkan halaman keuangan dan rekap musim tanam, pilih siklus yang sama agar periode perhitungan setara. Kedua laporan menggunakan perhitungan ringkasan yang sama; pembelian stok gudang dikecualikan dari pengeluaran operasional. Endpoint `POST /api/farmer/finance` memvalidasi kategori, tanggal, nominal, CSRF, serta memastikan lahan terpilih adalah milik pengguna aktif dan memiliki musim tanam aktif.

## Musim tanam (crop cycles)

Musim tanam merupakan induk laporan aktivitas dan keuangan per periode budidaya:

- `/farmer/crop-cycles` menyediakan formulir mulai siklus, riwayat, rekap aktivitas/transaksi, dan aksi penyelesaian.
- `GET /api/farmer/crop-cycles` menampilkan siklus dan lahan milik petani; `POST /api/farmer/crop-cycles` memulai siklus.
- `GET /api/farmer/crop-cycles/:id/report` mengembalikan siklus, ringkasan laba/rugi, transaksi, dan aktivitas. `POST /api/farmer/crop-cycles/:id/complete` menutup siklus dan menyimpan snapshot final.
- Partial unique index SQLite menjamin maksimal satu siklus `active` per lahan. Siklus selesai menyimpan pemasukan, pengeluaran, laba akhir, dan tanggal tutup; laporan memakai snapshot tersebut sehingga tetap terkunci.
- Backend mencari siklus aktif berdasarkan `user_id` dan `field_id`, tidak menerima `crop_cycle_id` dari browser. Aktivitas lapangan, pemakaian inventaris, dan transaksi keuangan yang terikat lahan harus memiliki siklus aktif. Tanpa siklus aktif, permintaan ditolak dengan HTTP 409. Pembelian stok gudang tetap berupa pengeluaran umum tanpa lahan/siklus; biaya operasional masuk ke laporan saat bahan digunakan.
- Pemakaian inventaris mengikat aktivitas, mutasi stok, dan transaksi biaya ke siklus yang sama dalam satu transaksi SQLite. Migrasi startup menambahkan kolom `crop_cycle_id` pada database lama; data historis yang belum memiliki relasi tetap bernilai `NULL`.
- Lahan yang sudah memiliki riwayat musim tanam tidak dapat dihapus, agar laporan historis dan foreign key tetap terjaga.

## Tim buruh, undangan QR, dan aktivitas pekerja

- `/farmer/workers` adalah halaman owner untuk mengundang, melihat, menugaskan, atau mengeluarkan buruh. Role `farmer` pada aplikasi ini bertindak sebagai owner.
- `owner_workers` menyimpan relasi many-to-many dengan primary key `(owner_id, worker_id)`. Satu akun worker dapat bergabung ke banyak owner.
- QR memuat URL dengan kode undangan acak berentropi 256-bit dari `owner_invites`, bukan ID owner yang dapat ditebak. Tautan diproses hanya oleh user ber-role `worker`; keanggotaan berulang bersifat idempoten.
- `owner_worker_assignments` menghubungkan anggota ke lahan dan siklus tanam aktif tertentu. Foreign key komposit menjaga konsistensi owner–lahan–siklus; pengeluaran worker menghapus penugasan milik owner tersebut.
- `/worker` menyediakan dashboard sederhana, scan QR kamera, daftar penugasan, dan formulir aktivitas. Worker hanya dapat memilih assignment ID; backend menentukan owner, lahan, dan siklus dari assignment yang masih aktif.
- `POST /api/worker/field-activities` memvalidasi keanggotaan, assignment, siklus aktif, jenis/tanggal aktivitas, dan stok. Penggunaan bahan mengurangi inventaris owner, membuat mutasi stok serta transaksi biaya pada lahan/siklus yang sesuai dalam satu transaksi SQLite. Jika stok tidak cukup, seluruh perubahan di-rollback.
- Aktivitas pekerja tidak mengirim nominal biaya atau jumlah stok ke dashboard worker. Riwayat kerja hanya ditampilkan selama worker masih memiliki assignment aktif terkait. Owner dapat melihat identitas pelapor di riwayat aktivitas lahan.
- Endpoint utama: `GET /api/farmer/workers`, `POST /api/farmer/workers/assign`, `POST /api/farmer/workers/:workerId/remove`, `POST /api/worker/join`, `GET /api/worker/assignments`, dan `POST /api/worker/field-activities`. Semua perubahan memakai CSRF.
- Halaman menggunakan Tailwind CDN, QRCode.js, dan html5-qrcode versi terpin. Izin kamera memerlukan localhost atau HTTPS; untuk deployment production, pertimbangkan menyajikan library secara lokal dan menerapkan CSP sesuai kebijakan deployment.

## Inventaris, aktivitas lahan, dan biaya bahan

- `/farmer/inventory` dan `POST /api/farmer/inventory/purchases` mencatat stok masuk. Pembelian membuat pengeluaran kas `Pembelian Inventaris` tanpa `field_id`, mutasi stok gudang, dan memperbarui biaya rata-rata bergerak.
- `/farmer/activities` dan `POST /api/farmer/activities` mencatat aktivitas pada lahan milik sendiri. Jika bahan dipilih, sistem mengunci transaksi SQLite (`BEGIN IMMEDIATE`), memvalidasi stok, lalu dalam transaksi yang sama menyimpan aktivitas, mengurangi stok, mencatat mutasi, dan membuat pengeluaran `Pemakaian Inventaris` dengan `field_id`.
- Kuantitas disimpan dalam seperseribu satuan; biaya rata-rata bergerak menggunakan mikro-Rupiah per satuan. Biaya konsumsi dibulatkan ke Rupiah terdekat.
- Pembelian inventaris muncul di riwayat keuangan sebagai arus kas umum, tetapi dikecualikan dari ringkasan laba/rugi operasional. Pengeluaran diakui pada lahan saat bahan benar-benar dipakai; ini mencegah pembelian stok dihitung dua kali sebelum dan setelah pemakaian.
- Harga pokok memakai metode rata-rata bergerak, bukan FIFO. Stok di bawah jumlah yang diminta menghasilkan HTTP 409 dan rollback, sehingga aktivitas, mutasi stok, dan transaksi keuangan tidak berubah.

Database memakai prepared statements; input dibatasi dan divalidasi server-side; nilai tampilan HTML di-escape. Semua POST memakai token CSRF. Cookie ditandai Secure otomatis jika `NODE_ENV=production`.

## Catatan deployment

Session server-side tersimpan di SQLite dan kadaluarsa setelah 8 jam. Untuk aplikasi multi-instance, gunakan session store bersama dan database terkelola dengan backup serta TLS. Jalankan di belakang HTTPS, set `NODE_ENV=production`, dan jangan mengekspos kredensial bootstrap.
#   T a n i M a n a g e  
 