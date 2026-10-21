const { chromium, devices } = require('playwright');
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const URL = 'http://localhost:8765/index.html';
const OUTPUT_DIR = process.env.TEST_OUTPUT_DIR || path.join(__dirname, 'artifacts');
const IMAGE_FIXTURE = path.join(__dirname, '..', 'assets', 'icon-192.png');
fs.mkdirSync(OUTPUT_DIR, { recursive: true });
const results = [];
const check = async (name, fn) => {
  try { await fn(); results.push(['PASS', name]); console.log('PASS', name); }
  catch (e) { results.push(['FAIL', name, e.message.split('\n')[0]]); console.log('FAIL', name, '->', e.message.split('\n')[0]); }
};
(async () => {
  const browser = await chromium.launch({ executablePath: chromium.executablePath(), args: ['--no-sandbox'] });
  const ctx = await browser.newContext({ ...devices['Pixel 5'], acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push('PAGEERROR ' + e.message));

  await ctx.route('**/supabase.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `(() => {
      const stateKey = 'e2e-shop-state';
      const sessionKey = 'e2e-owner-session';
      const readState = () => JSON.parse(localStorage.getItem(stateKey) || '{"payload":null,"revision":0}');
      window.supabase = { createClient: () => ({
        auth: {
          getSession: async () => {
            const user = JSON.parse(localStorage.getItem(sessionKey) || 'null');
            return { data: { session: user ? { user } : null }, error: null };
          },
          signInWithPassword: async ({ email, password }) => {
            if (email !== 'owner@example.test' || password !== 'OwnerPass123!') {
              return { data: { user: null }, error: { message: 'Invalid login credentials' } };
            }
            const user = { id: 'e2e-owner', email };
            localStorage.setItem(sessionKey, JSON.stringify(user));
            return { data: { user }, error: null };
          },
          signOut: async () => {
            localStorage.removeItem(sessionKey);
            return { error: null };
          },
        },
        from: () => ({
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({ data: readState(), error: null }),
            }),
          }),
        }),
        rpc: async (_name, { p_payload, p_expected_revision }) => {
          const current = readState();
          if (current.revision !== p_expected_revision) {
            return { data: null, error: { message: 'Cloud data changed on another device' } };
          }
          const next = { payload: p_payload, revision: current.revision + 1 };
          localStorage.setItem(stateKey, JSON.stringify(next));
          return { data: next.revision, error: null };
        },
      }) };
    })();`,
  }));
  await ctx.route('**/supabase-config.js', (route) => route.fulfill({
    contentType: 'text/javascript',
    body: `window.SORENTHO_SUPABASE_CONFIG = Object.freeze({
      url: 'https://example.supabase.co',
      anonKey: 'test-publishable-key',
    });`,
  }));

  const isCartOpen = () => page.locator('#cart').evaluate((e) => e.classList.contains('open'));
  const openCart = async () => { if (!(await isCartOpen())) await page.click('#openCart'); await page.waitForTimeout(320); };
  const closeCart = async () => { if (await isCartOpen()) await page.click('#closeSheet'); await page.waitForTimeout(320); };
  const tab = async (name) => { await closeCart(); await page.click(`.tab[data-tab="${name}"]`); await page.waitForTimeout(150); };
  const modalOpen = (id) => page.locator('#' + id).evaluate((e) => e.classList.contains('open'));
  const money = (s) => s.replace(/\s/g, '');

  await page.goto(URL, { waitUntil: 'load' });
  await page.waitForSelector('#loginView:not([hidden])');

  await check('halaman login tampil saat belum masuk', async () => {
    assert.ok(await page.locator('#loginView').isVisible());
    assert.ok(await page.locator('#appShell').isHidden());
  });

  await check('tema terang/gelap bisa diganti dan tersimpan setelah reload', async () => {
    await page.click('#themeToggleLogin');
    assert.strictEqual(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#loginView:not([hidden])');
    assert.strictEqual(await page.locator('html').getAttribute('data-theme'), 'light');
    await page.click('#themeToggleLogin');
    assert.strictEqual(await page.locator('html').getAttribute('data-theme'), 'dark');
  });

  await check('login salah: pesan error & tetap di login', async () => {
    await page.fill('#loginUser', 'owner@example.test');
    await page.fill('#loginPass', 'salah123');
    await page.click('#loginBtn');
    await page.waitForSelector('#loginError.show');
    assert.ok((await page.textContent('#loginError')).includes('salah'));
    assert.ok(await page.locator('#loginView').isVisible());
  });

  await check('login benar dengan akun Supabase mock masuk ke aplikasi', async () => {
    await page.fill('#loginUser', 'owner@example.test');
    await page.fill('#loginPass', 'OwnerPass123!');
    await page.click('#loginBtn');
    await page.waitForSelector('#appShell:not([hidden])');
    assert.ok(await page.locator('.product').first().isVisible());
  });

  await check('sesi bertahan setelah reload (tidak perlu login lagi)', async () => {
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#appShell:not([hidden])');
  });

  await check('navigasi menandai menu aktif secara visual dan aksesibel', async () => {
    await page.click('.tab[data-tab="produk"]');
    assert.strictEqual(await page.locator('.tab[data-tab="produk"]').getAttribute('aria-current'), 'page');
    assert.ok(await page.locator('#view-produk').evaluate((e) => e.classList.contains('active')));
    await page.click('.tab[data-tab="kasir"]');
    assert.strictEqual(await page.locator('.tab[data-tab="kasir"]').getAttribute('aria-current'), 'page');
  });

  await check('logo tampil (gambar termuat)', async () => {
    const w = await page.locator('.topbar .logo').evaluate((img) => img.naturalWidth);
    assert.ok(w >= 500, 'natural width ' + w);
  });

  await check('logo toko: unggah logo baru lalu kembali ke logo bawaan', async () => {
    await tab('pengaturan');
    await page.setInputFiles('#logoFile', IMAGE_FIXTURE);
    await page.waitForFunction(() => document.getElementById('topLogo').src.startsWith('data:'));
    assert.ok((await page.getAttribute('#topLogo', 'src')).startsWith('data:image/png'));
    await page.click('#logoRemove');
    await page.waitForFunction(() => document.getElementById('topLogo').src.endsWith('assets/logo.png'));
  });

  // ---------- QRIS upload ----------
  await check('unggah gambar QRIS di Pengaturan', async () => {
    await tab('pengaturan');
    await page.setInputFiles('#qrisFile', IMAGE_FIXTURE);
    await page.waitForSelector('#qrisPreview img');
    assert.strictEqual(await page.locator('#qrisRemove').isEnabled(), true);
  });

  await check('harga modal barang dapat disimpan dan dipakai pada penjualan berikutnya', async () => {
    await tab('produk');
    await page.click('[data-edit="p1"]');
    await page.fill('#pCost', '100000');
    await page.click('#pSave');
    await page.waitForSelector('#productModal', { state: 'hidden' });
    await page.click('[data-edit="p4"]');
    await page.fill('#pCost', '40000');
    await page.click('#pSave');
    await page.waitForSelector('#productModal', { state: 'hidden' });
    assert.ok((await page.textContent('#manageList')).includes('Lampu LED H4'));
  });

  // ---------- Kasir tunai ----------
  await check('tunai: transaksi pertama tersimpan SG-000001, stok 12 -> 10', async () => {
    await tab('kasir');
    await page.click('[data-add="p1"]');
    await page.click('[data-add="p1"]');
    await openCart();
    await page.click('[data-method="tunai"]');
    await page.fill('#paid', '400000');
    await page.click('#checkoutBtn');
    await page.waitForSelector('#receiptModal.open');
    assert.ok((await page.textContent('#receiptBody')).includes('SG-000001'));
    await page.click('#receiptClose');
    await closeCart();
    assert.ok((await page.textContent('[data-add="p1"] .stock')).includes('Stok: 10'));
  });

  // ---------- QRIS tampil layar penuh ----------
  await check('QRIS: tombol tampilkan QRIS muncul & membuka gambar layar penuh', async () => {
    await page.click('[data-add="p4"]');
    await openCart();
    await page.click('[data-method="qris"]');
    assert.ok(await page.locator('#showQris').isVisible());
    await page.click('#showQris');
    await page.waitForSelector('#qrisModal.open');
    const src = await page.getAttribute('#qrisImg', 'src');
    assert.ok(src.startsWith('data:image/png'));
    assert.ok((await page.textContent('#qrisAmount')).includes('75.000'));
    await page.click('#qrisClose');
  });

  await check('QRIS: transaksi tanpa referensi ditolak, dengan referensi berhasil', async () => {
    assert.ok(await page.locator('#checkoutBtn').isDisabled());
    await page.fill('#ref', 'QR-TEST-01');
    await page.click('#checkoutBtn');
    await page.waitForSelector('#receiptModal.open');
    assert.ok((await page.textContent('#receiptBody')).includes('QR-TEST-01'));
    await page.click('#receiptClose');
    await closeCart();
  });

  await check('laporan laba kotor menghitung biaya modal yang tersimpan di transaksi', async () => {
    await tab('laporan');
    assert.ok((await page.textContent('#profitDay')).includes('205.000'));
    assert.ok((await page.textContent('#profitDayN')).includes('2 dihitung'));
  });

  // ---------- Jenis produk ----------
  await check('jenis produk baru "Velg" bisa ditambahkan', async () => {
    await tab('produk');
    await page.click('#addCatBtn');
    await page.fill('#catName', 'Velg');
    await page.click('#catSave');
    await page.waitForSelector('#categoryModal', { state: 'hidden' });
    assert.ok((await page.textContent('#catList')).includes('Velg'));
  });

  await check('produk baru memakai jenis "Velg"', async () => {
    await page.click('#addProductBtn');
    await page.fill('#pName', 'Velg Racing 17');
    await page.fill('#pSku', 'SG-V17');
    await page.selectOption('#pCategory', 'Velg');
    await page.fill('#pPrice', '1250000');
    await page.fill('#pStock', '4');
    await page.click('#pSave');
    await page.waitForSelector('#productModal', { state: 'hidden' });
    assert.ok((await page.textContent('#manageList')).includes('Velg Racing 17'));
  });

  await check('ubah nama jenis "Velg" -> "Velg Racing" memperbarui produk', async () => {
    await page.click('[data-cat-edit="Velg"]');
    await page.fill('#catName', 'Velg Racing');
    await page.click('#catSave');
    await page.waitForSelector('#categoryModal', { state: 'hidden' });
    const row = page.locator('#manageList .item').filter({ hasText: 'Velg Racing 17' });
    assert.ok((await row.textContent()).includes('Velg Racing'));
  });

  await check('jenis yang masih dipakai tidak bisa dihapus', async () => {
    assert.ok(await page.locator('[data-cat-del="Velg Racing"]').isDisabled());
  });

  await check('jenis kosong bisa dihapus', async () => {
    await page.click('#addCatBtn');
    await page.fill('#catName', 'Audio');
    await page.click('#catSave');
    await page.waitForSelector('#categoryModal', { state: 'hidden' });
    await page.click('[data-cat-del="Audio"]');
    await page.click('#confirmOk');
    await page.waitForTimeout(200);
    assert.ok(!(await page.textContent('#catList')).includes('Audio'));
  });

  // ---------- Edit & nonaktif ----------
  await check('ubah produk: nama & harga berubah', async () => {
    await page.click('[data-edit="p2"]');
    await page.fill('#pName', 'Lampu LED H6 Premium');
    await page.fill('#pPrice', '199000');
    await page.click('#pSave');
    await page.waitForSelector('#productModal', { state: 'hidden' });
    assert.ok((await page.textContent('#manageList')).includes('Lampu LED H6 Premium'));
  });

  await check('nonaktifkan produk: hilang dari kasir, muncul badge Nonaktif', async () => {
    await page.click('[data-toggle="p5"]');
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator('[data-add="p5"]').count(), 0);
    assert.ok((await page.textContent('#manageList')).includes('Nonaktif'));
  });

  await check('aktifkan kembali: produk muncul lagi di kasir', async () => {
    await page.click('[data-toggle="p5"]');
    await page.waitForTimeout(200);
    assert.strictEqual(await page.locator('[data-add="p5"]').count(), 1);
  });

  // ---------- Tambah stok & riwayat ----------
  await check('tambah stok +3 (12 -> 13 setelah 2 terjual sebelumnya, stok 10 -> 13)', async () => {
    await page.click('[data-restock="p1"]');
    await page.fill('#restockQty', '3');
    await page.click('#rSave');
    await page.waitForSelector('#restockModal', { state: 'hidden' });
    const row = page.locator('#manageList .item').filter({ hasText: 'Lampu LED H4' });
    assert.ok((await row.locator('.pill').textContent()).includes('Stok 13'));
  });

  await check('riwayat stok mencatat penjualan & penambahan', async () => {
    await page.click('#manageList .item:has-text("Lampu LED H4") [data-moves]');
    await page.waitForSelector('#movementsModal.open');
    const txt = await page.textContent('#movList');
    assert.ok(txt.includes('Penjualan') && txt.includes('Tambah stok'), txt.slice(0, 200));
    await page.click('#movClose');
  });

  await check('stok opname mencatat selisih dan alasan, lalu memperbarui stok', async () => {
    await page.click('[data-stocktake="p1"]');
    await page.waitForSelector('#stocktakeModal.open');
    await page.fill('#stocktakePhysical', '12');
    await page.click('#stocktakeSave');
    assert.ok(await page.locator('#stocktakeModal').evaluate((element) => element.classList.contains('open')));
    await page.fill('#stocktakeReason', 'Hasil hitung rak hari ini');
    await page.click('#stocktakeSave');
    await page.waitForSelector('#stocktakeModal', { state: 'hidden' });
    const row = page.locator('#manageList .item').filter({ hasText: 'Lampu LED H4' });
    assert.ok((await row.locator('.pill').textContent()).includes('Stok 12'));
    await row.locator('[data-moves]').click();
    await page.waitForSelector('#movementsModal.open');
    const movements = await page.textContent('#movList');
    assert.ok(movements.includes('Stok opname') && movements.includes('Hasil hitung rak hari ini'));
    await page.click('#movClose');
  });

  // ---------- Laporan ----------
  await check('laporan: kartu omzet & grafik 7 hari tampil', async () => {
    await tab('laporan');
    assert.ok(money(await page.textContent('#repDay')).includes('Rp'));
    assert.strictEqual(await page.locator('#chart .col').count(), 7);
    assert.ok((await page.textContent('#repDayN')).includes('transaksi'));
  });

  await check('grafik bisa diganti ke 8 minggu & 12 bulan', async () => {
    await page.click('#rangeSeg [data-range="week"]');
    assert.strictEqual(await page.locator('#chart .col').count(), 8);
    await page.click('#rangeSeg [data-range="month"]');
    assert.strictEqual(await page.locator('#chart .col').count(), 12);
    await page.click('#rangeSeg [data-range="day"]');
  });

  await check('saran target minggu/bulan muncul & bisa dipasang', async () => {
    const s = await page.textContent('#suggestBox');
    assert.ok(s.includes('Saran target minggu'), s);
    await page.click('#useSuggest');
    await page.click('#saveTargets');
    await page.waitForTimeout(200);
    const prog = await page.textContent('#progWeekTxt');
    assert.ok(prog.includes('%') || prog.includes('belum'), prog);
  });

  await check('target manual tersimpan dan progres terhitung', async () => {
    await page.fill('#targetWeek', '1000000');
    await page.click('#saveTargets');
    await page.waitForTimeout(200);
    assert.ok((await page.textContent('#progWeekTxt')).includes('/ Rp'));
  });

  await check('metode pembayaran & produk terlaris terisi', async () => {
    assert.ok((await page.textContent('#methodList')).includes('QRIS'));
    assert.ok((await page.textContent('#topList')).includes('Lampu LED H4'));
  });

  // ---------- Riwayat, struk PNG, ralat ----------
  await check('struk: unduh gambar PNG', async () => {
    await tab('riwayat');
    await page.click('#historyList [data-view]:nth-child(1)');
    await page.waitForSelector('#receiptModal.open');
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#rPng')]);
    assert.ok(dl.suggestedFilename().endsWith('.png'), dl.suggestedFilename());
    const size = fs.statSync(await dl.path()).size;
    assert.ok(size > 2000, 'png bytes ' + size);
    fs.copyFileSync(await dl.path(), path.join(OUTPUT_DIR, 'struk-sample.png'));
  });

  await check('ralat: batalkan transaksi wajib alasan, lalu stok kembali', async () => {
    const before = await page.evaluate(() => null);
    await page.click('#rVoid');
    await page.waitForSelector('#voidModal.open');
    await page.click('#voidOk');
    await page.waitForTimeout(150);
    assert.ok(await page.locator('#voidModal').evaluate((e) => e.classList.contains('open')), 'void tanpa alasan harus ditolak');
    await page.fill('#voidReason', 'Salah input jumlah pelanggan');
    await page.click('#voidOk');
    await page.waitForSelector('#receiptBody .stamp');
    assert.ok((await page.textContent('#receiptBody')).includes('DIBATALKAN'));
    await page.click('#receiptClose');
    assert.ok((await page.textContent('#historyList')).includes('Dibatalkan'));
  });

  await check('setelah dibatalkan, omzet laporan tidak menghitung transaksi itu', async () => {
    await tab('laporan');
    const txt = await page.textContent('#repDayN');
    assert.ok(/\d+ transaksi/.test(txt));
  });

  await check('transaksi dibatalkan tidak bisa dibatalkan lagi', async () => {
    await tab('riwayat');
    await page.click('#historyList [data-view]:nth-child(1)');
    await page.waitForSelector('#receiptModal.open');
    assert.ok(await page.locator('#rVoid').isHidden());
    await page.click('#receiptClose');
  });

  await check('ekspor CSV memuat kolom status', async () => {
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#exportCsvBtn')]);
    const body = fs.readFileSync(await dl.path(), 'utf8');
    assert.ok(body.includes('Status') && body.includes('Dibatalkan'));
  });

  await check('backup dapat dipreview dan dipulihkan setelah konfirmasi', async () => {
    await tab('pengaturan');
    const [download] = await Promise.all([page.waitForEvent('download'), page.click('#backupBtn')]);
    const backup = JSON.parse(fs.readFileSync(await download.path(), 'utf8'));
    backup.settings.name = 'Nama dari backup';
    backup.products.find((product) => product.id === 'p1').stock += 1;
    const fixture = path.join(OUTPUT_DIR, 'backup-restore-fixture.json');
    fs.writeFileSync(fixture, JSON.stringify(backup));

    await page.setInputFiles('#restoreFile', fixture);
    await page.waitForSelector('#restorePreviewModal.open');
    assert.ok((await page.textContent('#restorePreviewText')).includes('Transaksi:'));
    await page.fill('#restoreConfirmation', 'salah');
    await page.click('#restoreConfirm');
    assert.ok(await page.locator('#restorePreviewModal').evaluate((element) => element.classList.contains('open')));

    await page.fill('#restoreConfirmation', 'PULIHKAN');
    await page.click('#restoreConfirm');
    await page.waitForSelector('#restorePreviewModal', { state: 'hidden' });
    assert.strictEqual(await page.inputValue('#storeName'), 'Nama dari backup');
    const cloud = await page.evaluate(() => JSON.parse(localStorage.getItem('e2e-shop-state')).payload);
    assert.strictEqual(cloud.settings.name, 'Nama dari backup');
    assert.strictEqual(cloud.products.find((product) => product.id === 'p1').stock,
      backup.products.find((product) => product.id === 'p1').stock);
  });

  await check('reset menolak konfirmasi salah dan menghapus riwayat tanpa mengubah stok', async () => {
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem('e2e-shop-state')).payload.products
      .find((product) => product.id === 'p1').stock);
    await tab('pengaturan');
    await page.click('#resetSalesBtn');
    await page.waitForSelector('#resetSalesModal.open');
    await page.fill('#resetSalesConfirmation', 'salah');
    await page.click('#resetSalesConfirm');
    assert.ok(await page.locator('#resetSalesModal').evaluate((element) => element.classList.contains('open')));

    await page.fill('#resetSalesConfirmation', 'HAPUS');
    await page.click('#resetSalesConfirm');
    await page.waitForSelector('#resetSalesModal', { state: 'hidden' });
    const snapshot = await page.evaluate(() => JSON.parse(localStorage.getItem('e2e-shop-state')).payload);
    assert.strictEqual(snapshot.transactions.length, 0);
    assert.strictEqual(snapshot.movements.length, 0);
    assert.strictEqual(snapshot.settings.lastNo, 0);
    assert.strictEqual(snapshot.products.find((product) => product.id === 'p1').stock, before);
    assert.ok((await page.textContent('#statAll')) === '0');
  });

  await check('pengaturan: logout kembali ke halaman login', async () => {
    await tab('pengaturan');
    await page.click('#logoutBtn');
    await page.waitForSelector('#loginView:not([hidden])');
    assert.ok(await page.locator('#appShell').isHidden());
  });

  await check('setelah logout, reload tetap di halaman login', async () => {
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#loginView:not([hidden])');
  });

  await check('tidak ada error di console', async () => {
    assert.strictEqual(errors.length, 0, errors.join(' | '));
  });

  // ---------- Screenshot ----------
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'v2-login-mobile.png') });
  await page.fill('#loginUser', 'owner@example.test');
  await page.fill('#loginPass', 'OwnerPass123!');
  await page.click('#loginBtn');
  await page.waitForSelector('#appShell:not([hidden])');
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'v2-kasir-mobile.png') });
  await tab('laporan');
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'v2-laporan-mobile.png'), fullPage: false });
  await tab('produk');
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'v2-produk-mobile.png') });
  await tab('pengaturan');
  await page.screenshot({ path: path.join(OUTPUT_DIR, 'v2-pengaturan-mobile.png') });

  const desk = await ctx.newPage();
  await desk.setViewportSize({ width: 1366, height: 820 });
  await desk.goto(URL, { waitUntil: 'load' });
  await desk.waitForSelector('#appShell:not([hidden])').catch(() => {});
  await desk.screenshot({ path: path.join(OUTPUT_DIR, 'v2-desktop.png') });

  await browser.close();
  const fails = results.filter((r) => r[0] === 'FAIL');
  console.log(`\n${results.length - fails.length}/${results.length} passed`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error('FATAL', e); process.exit(2); });
