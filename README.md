# Sorentho Garage Kasir — v2.3.0

Aplikasi kasir berbasis web (PWA). Data toko disimpan di Supabase dan dibagikan antar perangkat yang masuk ke akun pemilik yang sama. IndexedDB di browser hanya menjadi cache; transaksi dan perubahan data memerlukan koneksi internet.

Tampilan memakai palet hitam, putih, dan merah yang mengikuti logo Sorentho. Gunakan tombol **Terang / Gelap** di header atau halaman masuk untuk mengganti tema; pilihan tema tersimpan di perangkat.

Navigasi tampil sebagai sidebar di layar desktop dan bilah bawah di ponsel. Tombol memberikan feedback animasi singkat; animasi dinonaktifkan jika perangkat menggunakan preferensi kurangi gerakan.

## 1. Menjalankan

Aplikasi harus dibuka lewat **HTTPS** (atau `localhost`). Siapkan Supabase sebelum login pertama:

- **Netlify Drop** (cepat): buka <https://app.netlify.com/drop>, seret folder `sorentho-kasir`, lalu buka alamat yang diberikan.
- **GitHub Pages** atau hosting statis lain juga bisa.

## 2. Menyiapkan Supabase (satu akun pemilik)

1. Buat proyek di <https://supabase.com/dashboard>.
2. Buka **Authentication → Users**, tambahkan satu user pemilik dengan email dan password. Matikan pendaftaran publik (signups) di pengaturan Authentication agar orang lain tidak bisa membuat akun.
3. Buka user tersebut dan salin **ID/UUID** pemilik.
4. Buka **SQL Editor**, isi UUID pada perintah INSERT di bagian akhir `supabase-setup.sql`, hilangkan tanda komentar `--` pada kedua baris INSERT, lalu jalankan seluruh file.
5. Di pengaturan API proyek, salin **Project URL** dan **publishable key** (atau `anon` key lama). Isi keduanya di `supabase-config.js`:

   ```js
   window.SORENTHO_SUPABASE_CONFIG = Object.freeze({
     url: 'https://PROJECT-REF.supabase.co',
     anonKey: 'sb_publishable_...',
   });
   ```

   Key ini memang digunakan oleh browser dan bukan kata sandi. **Jangan pernah memasukkan `service_role` key ke website atau membagikannya.** Akses data dilindungi RLS dan hanya diberikan kepada UUID pemilik.
6. Unggah/deploy ulang folder website. Masuk menggunakan email dan password pemilik.

Saat pertama kali masuk di perangkat yang memiliki data kasir lama, aplikasi mengirim data lokal ke cloud jika baris cloud masih kosong. Pastikan perangkat pertama tersebut memuat data yang benar dan tetap online selama proses migrasi. Perangkat selanjutnya akan mengambil data cloud, bukan menimpa dengan data lokalnya. Pembaruan di perangkat lain diperiksa otomatis sekitar setiap 20 detik; reload halaman juga memuat data terbaru. Jika dua perangkat menyimpan bersamaan, aplikasi mencegah data lama menimpa data yang lebih baru.

## 3. Masuk

Gunakan email dan password akun pemilik Supabase. Sesi dikelola aman oleh Supabase Auth. Tombol **Keluar** ada di menu Pengaturan.

## 4. Memasang di Android

Buka aplikasi di Chrome Android, tekan **⋮**, lalu pilih **Instal aplikasi** atau **Tambahkan ke layar utama**.

## 5. Fitur utama

| Menu | Fungsi |
|---|---|
| **Kasir** | Pilih produk, keranjang, diskon, pembayaran tunai / QRIS / transfer, nominal cepat, kembalian |
| **Produk** | Jenis produk (buat, ubah, hapus), harga modal, tambah stok, stok opname, riwayat stok, nonaktifkan produk |
| **Laporan** | Omzet dan laba kotor hari, minggu, dan bulan; grafik 7 hari, 8 minggu, atau 12 bulan; produk terlaris; metode bayar; target dan saran |
| **Riwayat** | Daftar transaksi, struk, simpan struk sebagai gambar, bagikan, cetak, batalkan transaksi, export CSV |
| **Pengaturan** | Akun, QRIS toko, logo toko, nama dan alamat toko, lebar kertas struk, unduh dan pulihkan backup JSON, reset riwayat transaksi dan pergerakan stok |

Reset riwayat di **Pengaturan** menghapus transaksi beserta riwayat pergerakan stok dari cloud, mengatur ulang nomor transaksi, dan tidak mengubah stok produk. Unduh cadangan terlebih dahulu jika masih memerlukan salinan data lama.

### Pulihkan backup
Di **Pengaturan → Cadangan data**, pilih file backup JSON. Periksa pratinjau, lalu ketik `PULIHKAN` untuk mengganti semua data cloud dan perangkat dengan isi backup. Tindakan ini mengganti produk, stok, pengaturan, transaksi, dan riwayat stok; buat backup terbaru sebelum melanjutkan.

### Laba kotor
Isi **Harga modal per unit** saat membuat atau mengubah produk. Untuk jasa, isi biaya langsung per layanan jika ingin menghitung labanya. Laporan laba kotor memakai harga jual transaksi setelah diskon dikurangi harga modal yang disimpan saat transaksi dibuat. Transaksi lama atau barang tanpa harga modal ditandai belum dapat dihitung; harga modal yang baru diisi tidak mengubah catatan transaksi lama.

### Stok opname
Di **Produk**, tekan **Opname** pada barang, masukkan jumlah fisik yang dihitung, lalu isi alasan/catatan. Aplikasi membandingkan hasil hitung dengan stok saat ini dan menyimpan penyesuaian beserta riwayatnya ke cloud. Opname tidak mengubah transaksi penjualan.

### QRIS
1. Di **Pengaturan → QRIS toko**, unggah gambar QRIS Anda sekali saja.
2. Saat pelanggan membayar dengan QRIS, pilih metode **QRIS** di kasir, lalu tekan **Tampilkan QRIS ke pelanggan**. Gambar tampil layar penuh beserta total bayar.
3. Setelah pembayaran masuk, isi nomor referensi lalu selesaikan transaksi.

### Struk sebagai gambar
Di **Riwayat**, ketuk transaksi, lalu tekan **Simpan gambar**. File PNG tersimpan di folder Download HP. Tombol **Bagikan** juga tersedia jika HP mendukungnya (misalnya untuk dikirim ke WhatsApp).

### Ralat transaksi
Transaksi yang salah tidak dihapus. Buka transaksinya di Riwayat, lalu tekan **Batalkan transaksi** dan isi alasannya. Stok otomatis kembali, dan transaksi tetap tercatat dengan status **Dibatalkan**. Setelah itu, buat transaksi baru jika diperlukan.

### Saran penghasilan
Menu **Laporan** memberi saran target minggu dan bulan dari rata-rata penjualan sebelumnya, ditambah 10%. Target boleh diisi sendiri atau memakai saran dengan tombol **Pakai saran**.

## 6. Catatan penting

- **Internet wajib untuk perubahan.** Aplikasi menolak transaksi/perubahan yang gagal disimpan ke cloud. Cache lokal bukan antrean offline; jangan mengandalkan akses offline untuk operasional.
- **Cadangan.** Unduh **cadangan JSON** secara berkala di Pengaturan sebagai salinan tambahan.
- **Kunci.** Publishable/anon key boleh ada di frontend; `service_role` key dan password akun tidak boleh dimasukkan ke file aplikasi.
- **Pembayaran QRIS dan transfer dicatat manual.** Pastikan dana sudah masuk sebelum menyimpan transaksi.
- **Logo.** Logo bawaan memakai file PNG terbaru yang diberikan. Jika ingin memakai logo lain, unggah di **Pengaturan → Logo toko**.
- **Pembaruan dari versi 1.** Jika dibuka di alamat yang sama, data versi 1 otomatis dipindah ke versi 2.

## 7. Yang belum ada

- Cetak langsung ke printer Bluetooth thermal (saat ini lewat dialog cetak Android)
- Pembayaran QRIS otomatis (saat ini konfirmasi manual)
- Banyak akun dan peran kasir/pemilik

## 8. Struktur file

```
sorentho-kasir/
├── index.html            Markup (login, kasir, produk, laporan, riwayat, pengaturan)
├── styles.css            Tampilan (mobile-first, dark)
├── app.js                Logika aplikasi
├── sw.js                 Service worker (mode offline)
├── supabase-config.js    URL proyek dan publishable key
├── supabase-setup.sql    Tabel, kebijakan akses, dan RPC cloud
├── manifest.webmanifest  Pengaturan pemasangan aplikasi
├── assets/               Logo dan ikon
├── tests/e2e-test.js     Pengujian otomatis (Playwright, opsional)
└── README.md
```

Setiap kali file diubah, naikkan `CACHE_VERSION` di `sw.js` agar perangkat mengambil versi terbaru.
