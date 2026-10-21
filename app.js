/* ==========================================================================
   Sorentho Garage Kasir — v2.2.1
   Vanilla JS PWA. Data utama di Supabase, cache perangkat di IndexedDB.
   ========================================================================== */
(() => {
  'use strict';

  const APP_VERSION = '2.2.1';
  const DB_NAME = 'sorentho-kasir';
  const DB_VERSION = 2;
  const CART_KEY = 'sg_cart_v1';
  const THEME_KEY = 'sg_theme_v1';
  const DEFAULT_MIN_STOCK = 3;
  const METHOD_LABEL = { tunai: 'Tunai', qris: 'QRIS', transfer: 'Transfer' };
  const MOVE_LABEL = { awal: 'Stok awal', penambahan: 'Tambah stok', penjualan: 'Penjualan', retur: 'Pembatalan transaksi' };
  const DEFAULT_CATEGORIES = ['Lampu LED', 'Projector', 'Aksesori', 'Jasa'];

  const SEED_PRODUCTS = [
    { id: 'p1', name: 'Lampu LED H4', sku: 'SG-001', category: 'Lampu LED', type: 'barang', price: 185000, stock: 12, minStock: 3, active: true },
    { id: 'p2', name: 'Lampu LED H6', sku: 'SG-002', category: 'Lampu LED', type: 'barang', price: 165000, stock: 8, minStock: 3, active: true },
    { id: 'p3', name: 'Lampu Projector Mini', sku: 'SG-003', category: 'Projector', type: 'barang', price: 325000, stock: 5, minStock: 3, active: true },
    { id: 'p4', name: 'Relay Set 12V', sku: 'SG-004', category: 'Aksesori', type: 'barang', price: 75000, stock: 15, minStock: 3, active: true },
    { id: 'p5', name: 'Kabel Set Premium', sku: 'SG-005', category: 'Aksesori', type: 'barang', price: 55000, stock: 20, minStock: 3, active: true },
    { id: 'p6', name: 'Jasa Pasang Lampu', sku: 'SG-006', category: 'Jasa', type: 'jasa', price: 100000, stock: null, minStock: 0, active: true },
    { id: 'p7', name: 'Bracket Projector', sku: 'SG-007', category: 'Aksesori', type: 'barang', price: 85000, stock: 6, minStock: 3, active: true },
    { id: 'p8', name: 'Lampu Sein LED', sku: 'SG-008', category: 'Lampu LED', type: 'barang', price: 90000, stock: 10, minStock: 3, active: true },
    { id: 'p9', name: 'Fog Lamp Set', sku: 'SG-009', category: 'Projector', type: 'barang', price: 275000, stock: 4, minStock: 3, active: true },
  ];

  /* ------------------------------------------------------------------------
     Utilitas
     ------------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const on = (id, evt, fn) => $(id).addEventListener(evt, fn);

  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));

  const rupiah = (n) => new Intl.NumberFormat('id-ID', {
    style: 'currency', currency: 'IDR', maximumFractionDigits: 0,
  }).format(Math.round(Number(n) || 0));

  const shortRp = (n) => {
    if (n >= 1e6) return (n / 1e6).toFixed(1).replace('.0', '') + ' jt';
    if (n >= 1e3) return Math.round(n / 1e3) + ' rb';
    return String(Math.round(n));
  };

  const fmtDateTime = (iso) => new Date(iso).toLocaleString('id-ID', { dateStyle: 'medium', timeStyle: 'short' });
  const dateStamp = () => {
    const now = new Date();
    const pad = (n) => String(n).padStart(2, '0');
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  };
  const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const wholeNumber = (v) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const roundUp = (n, step) => Math.max(step, Math.ceil(n / step) * step);

  const defaultSettings = () => ({
    name: 'Sorentho Garage',
    info: '',
    paper: '58',
    lastNo: 0,
    categories: [...DEFAULT_CATEGORIES],
    qris: null,
    logo: null,
    targetWeek: 0,
    targetMonth: 0,
  });

  /* ------------------------------------------------------------------------
     State
     ------------------------------------------------------------------------ */
  let db = null;
  let supabaseClient = null;
  let supabaseSetupError = 'Supabase belum dikonfigurasi. Isi URL proyek dan publishable key di supabase-config.js.';
  let currentUser = null;
  let cloudRevision = 0;
  let cloudSnapshot = null;
  let cloudActive = false;
  let syncingCloud = false;
  let syncErrorNotified = false;
  let storageReady = false;
  let storageError = '';
  let busy = false;
  let toastTimer = null;
  let confirmResolve = null;
  let deferredInstall = null;
  let restockId = null;
  let editingId = null;
  let editingCat = null;
  let currentReceipt = null;
  let reportRange = 'day';

  let state = { products: [], transactions: [], movements: [], settings: defaultSettings() };
  let cart = loadCart();
  const ui = {
    tab: 'kasir',
    category: '',
    lowOnly: false,
    search: '',
    manageSearch: '',
    historySearch: '',
    method: 'tunai',
  };

  /* ------------------------------------------------------------------------
     Helper produk & laporan
     ------------------------------------------------------------------------ */
  const findProduct = (id) => state.products.find((p) => p.id === id);
  const isService = (p) => p.type === 'jasa';
  const isActive = (p) => p.active !== false;
  const categoryOf = (p) => p.category || 'Umum';
  const minStockOf = (p) => (typeof p.minStock === 'number' ? p.minStock : DEFAULT_MIN_STOCK);
  const isLow = (p) => isActive(p) && !isService(p) && p.stock <= minStockOf(p);
  const maxQty = (p) => (isService(p) ? Infinity : p.stock);
  const sortedProducts = () => [...state.products].sort((a, b) => a.name.localeCompare(b.name, 'id'));
  const matchText = (p, q) => !q || `${p.name} ${p.sku || ''} ${categoryOf(p)}`.toLowerCase().includes(q);
  const validTxs = () => state.transactions.filter((t) => t.status !== 'dibatalkan');
  const sumOf = (list) => list.reduce((s, t) => s + t.total, 0);
  const inRange = (t, from, to) => {
    const d = new Date(t.date);
    return d >= from && d < to;
  };

  const movement = ({ productId, type, qty, before, after, ref = '', note = '' }) => ({
    id: newId('m'), productId, type, qty, before, after, ref, note, at: new Date().toISOString(),
  });

  /* ------------------------------------------------------------------------
     Penyimpanan: IndexedDB
     ------------------------------------------------------------------------ */
  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('products')) d.createObjectStore('products', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('transactions')) d.createObjectStore('transactions', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('settings')) d.createObjectStore('settings', { keyPath: 'key' });
        if (!d.objectStoreNames.contains('movements')) d.createObjectStore('movements', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('Penyimpanan kasir sedang dipakai tab lama. Tutup tab aplikasi lain lalu muat ulang.'));
    });
  }

  function getAll(store) {
    return new Promise((resolve, reject) => {
      const r = db.transaction(store, 'readonly').objectStore(store).getAll();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function getOne(store, key) {
    return new Promise((resolve, reject) => {
      const r = db.transaction(store, 'readonly').objectStore(store).get(key);
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  function normalizeSnapshot(snapshot) {
    const value = snapshot && typeof snapshot === 'object' ? snapshot : {};
    const settings = value.settings && typeof value.settings === 'object'
      ? { ...defaultSettings(), ...value.settings }
      : defaultSettings();
    if (!Array.isArray(settings.categories)) settings.categories = [...DEFAULT_CATEGORIES];
    return {
      settings,
      products: Array.isArray(value.products) ? value.products : [],
      transactions: Array.isArray(value.transactions) ? value.transactions : [],
      movements: Array.isArray(value.movements) ? value.movements : [],
    };
  }

  function stableStringify(value) {
    return JSON.stringify(value, (_, item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return item;
      return Object.fromEntries(Object.keys(item).sort().map((key) => [key, item[key]]));
    });
  }

  async function readLocalSnapshot() {
    const [settingsRecord, products, transactions, movements] = await Promise.all([
      getOne('settings', 'main'),
      getAll('products'),
      getAll('transactions'),
      getAll('movements'),
    ]);
    return normalizeSnapshot({
      settings: settingsRecord?.value,
      products,
      transactions: transactions.sort((a, b) => (b.no || 0) - (a.no || 0)),
      movements,
    });
  }

  function applySnapshot(snapshot) {
    const normalized = normalizeSnapshot(snapshot);
    state.settings = normalized.settings;
    state.products = normalized.products;
    state.transactions = normalized.transactions.sort((a, b) => (b.no || 0) - (a.no || 0));
    state.movements = normalized.movements;
    const used = state.products.map(categoryOf);
    state.settings.categories = [...new Set([...state.settings.categories, ...used])];
    return normalized;
  }

  async function replaceLocalSnapshot(snapshot) {
    const normalized = normalizeSnapshot(snapshot);
    await new Promise((resolve, reject) => {
      const transaction = db.transaction(['products', 'transactions', 'settings', 'movements'], 'readwrite');
      const products = transaction.objectStore('products');
      const transactions = transaction.objectStore('transactions');
      const settings = transaction.objectStore('settings');
      const movements = transaction.objectStore('movements');
      products.clear();
      transactions.clear();
      settings.clear();
      movements.clear();
      normalized.products.forEach((product) => products.put(product));
      normalized.transactions.forEach((item) => transactions.put(item));
      settings.put({ key: 'main', value: normalized.settings });
      normalized.movements.forEach((movementRecord) => movements.put(movementRecord));
      transaction.oncomplete = resolve;
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error || new Error('Local cache update aborted'));
    });
  }

  async function readCloudSnapshot() {
    if (!supabaseClient) throw new Error('Konfigurasi Supabase belum tersedia.');
    const { data, error } = await supabaseClient
      .from('shop_state')
      .select('payload, revision')
      .eq('singleton', true)
      .maybeSingle();
    if (error) throw error;
    if (!data) throw new Error('Data toko belum disiapkan. Selesaikan langkah SQL di Supabase.');
    const revision = Number(data.revision);
    if (!Number.isSafeInteger(revision) || revision < 0) {
      throw new Error('Versi data cloud tidak valid.');
    }
    return { snapshot: data.payload, revision };
  }

  async function saveCloudSnapshot(snapshot, expectedRevision) {
    const { data, error } = await supabaseClient.rpc('save_shop_state', {
      p_payload: snapshot,
      p_expected_revision: expectedRevision,
    });
    if (error) throw error;
    const revision = Number(data);
    if (!Number.isSafeInteger(revision) || revision <= expectedRevision) {
      throw new Error('Respons versi data dari Supabase tidak valid.');
    }
    return revision;
  }

  async function configureCloudState() {
    const cloud = await readCloudSnapshot();
    cloudRevision = cloud.revision;

    if (cloud.snapshot) {
      const snapshot = applySnapshot(cloud.snapshot);
      await replaceLocalSnapshot(snapshot);
      cloudSnapshot = snapshot;
    } else {
      const local = await readLocalSnapshot();
      const hasLocalData = Boolean(
        local.products.length
          || local.transactions.length
          || local.movements.length
          || stableStringify(local.settings) !== stableStringify(defaultSettings()),
      );
      const initial = hasLocalData
        ? local
        : normalizeSnapshot({ ...defaultSettings(), products: structuredClone(SEED_PRODUCTS) });
      applySnapshot(initial);
      await replaceLocalSnapshot(initial);
      try {
        cloudRevision = await saveCloudSnapshot(initial, cloudRevision);
        cloudSnapshot = initial;
      } catch (err) {
        const latest = await readCloudSnapshot();
        if (latest.revision <= cloud.revision || !latest.snapshot) throw err;
        cloudRevision = latest.revision;
        cloudSnapshot = applySnapshot(latest.snapshot);
        await replaceLocalSnapshot(cloudSnapshot);
      }
    }

    cloudActive = true;
    syncErrorNotified = false;
  }

  async function syncCloudChanges() {
    if (!cloudActive || !currentUser || busy || syncingCloud) return;
    syncingCloud = true;
    try {
      const cloud = await readCloudSnapshot();
      if (cloud.revision <= cloudRevision) return;
      if (!cloud.snapshot) throw new Error('Data cloud tidak memiliki isi yang valid.');
      const snapshot = applySnapshot(cloud.snapshot);
      await replaceLocalSnapshot(snapshot);
      cloudRevision = cloud.revision;
      cloudSnapshot = snapshot;
      renderAll();
      if (ui.tab === 'pengaturan') fillSettingsForm();
      applyLogo();
      syncErrorNotified = false;
      toast('Data diperbarui dari perangkat lain');
    } catch (err) {
      console.error('Sinkronisasi cloud gagal', err);
      if (!syncErrorNotified) {
        toast('Tidak dapat memeriksa pembaruan cloud. Periksa koneksi internet.');
        syncErrorNotified = true;
      }
    } finally {
      syncingCloud = false;
    }
  }

  // Semua penulisan lewat satu transaksi IndexedDB: berhasil seluruhnya atau tidak sama sekali.
  function writeTx(stores, fill) {
    return new Promise((resolve, reject) => {
      const idb = db.transaction(stores, 'readwrite');
      fill(idb);
      idb.oncomplete = async () => {
        if (!cloudActive) return resolve();
        let attemptedSnapshot;
        try {
          attemptedSnapshot = await readLocalSnapshot();
          const revision = await saveCloudSnapshot(attemptedSnapshot, cloudRevision);
          cloudRevision = revision;
          cloudSnapshot = attemptedSnapshot;
          syncErrorNotified = false;
          resolve();
        } catch (err) {
          try {
            const cloud = await readCloudSnapshot();
            if (cloud.snapshot) {
              if (stableStringify(normalizeSnapshot(cloud.snapshot)) === stableStringify(attemptedSnapshot)) {
                cloudRevision = cloud.revision;
                cloudSnapshot = normalizeSnapshot(cloud.snapshot);
                syncErrorNotified = false;
                return resolve();
              }
              const snapshot = applySnapshot(cloud.snapshot);
              await replaceLocalSnapshot(snapshot);
              cloudRevision = cloud.revision;
              cloudSnapshot = snapshot;
              renderAll();
              if (ui.tab === 'pengaturan') fillSettingsForm();
              applyLogo();
            } else if (cloudSnapshot) {
              await replaceLocalSnapshot(cloudSnapshot);
            }
          } catch (restoreError) {
            console.error('Pemulihan cache lokal setelah gagal menyimpan', restoreError);
            if (cloudSnapshot) {
              try {
                const restored = applySnapshot(cloudSnapshot);
                await replaceLocalSnapshot(restored);
                renderAll();
                if (ui.tab === 'pengaturan') fillSettingsForm();
                applyLogo();
              } catch (cacheError) {
                console.error('Pemulihan dari salinan cloud terakhir gagal', cacheError);
              }
            }
          }
          reject(err);
        }
      };
      idb.onerror = () => reject(idb.error);
      idb.onabort = () => reject(idb.error || new Error('Transaksi dibatalkan'));
    });
  }

  // Menulis dengan penanganan error + status sibuk; mengembalikan true bila sukses.
  async function safeWrite(stores, fill, okMsg) {
    if (busy) return false;
    busy = true;
    try {
      await writeTx(stores, fill);
      busy = false;
      if (okMsg) toast(okMsg);
      return true;
    } catch (err) {
      busy = false;
      console.error(err);
      toast(saveFailureMessage(err));
      return false;
    }
  }

  function saveFailureMessage(err) {
    if (String(err?.message || '').toLowerCase().includes('cloud data changed')) {
      return 'Data diperbarui dari perangkat lain. Periksa data terbaru lalu ulangi perubahan.';
    }
    return cloudActive
      ? 'Gagal tersambung ke cloud. Perubahan tidak disimpan; periksa internet lalu coba lagi.'
      : 'Gagal menyimpan. Coba lagi.';
  }

  const saveSettingsRecord = (value) =>
    safeWrite(['settings'], (idb) => idb.objectStore('settings').put({ key: 'main', value }));

  async function loadState() {
    const snapshot = applySnapshot(await readLocalSnapshot());
    if (!snapshot.products.length && !snapshot.transactions.length) {
      snapshot.products = structuredClone(SEED_PRODUCTS);
      applySnapshot(snapshot);
      await replaceLocalSnapshot(snapshot);
    }
  }

  /* ------------------------------------------------------------------------
     Login & sesi
     ------------------------------------------------------------------------ */
  function showLogin() {
    $('appShell').hidden = true;
    $('loginView').hidden = false;
    $('loginPass').value = '';
    setLoginError('');
  }

  function showApp() {
    $('loginView').hidden = true;
    $('appShell').hidden = false;
    $('accountInfo').textContent = `Masuk sebagai ${currentUser?.email || 'pemilik'} · data tersinkron online`;
  }

  function setLoginError(msg) {
    $('loginError').textContent = msg;
    $('loginError').classList.toggle('show', Boolean(msg));
  }

  function updateThemeButtons(theme) {
    const isDark = theme === 'dark';
    document.querySelectorAll('.theme-toggle').forEach((button) => {
      button.setAttribute('aria-label', `Aktifkan mode ${isDark ? 'terang' : 'gelap'}`);
      button.querySelector('.theme-icon').textContent = isDark ? '☀' : '☾';
      button.querySelector('.theme-label').textContent = isDark ? 'Terang' : 'Gelap';
    });
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = isDark ? '#0b0d10' : '#f4f5f7';
  }

  function applyTheme(theme, persist = false) {
    const next = theme === 'light' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    updateThemeButtons(next);
    if (!persist) return;
    try {
      localStorage.setItem(THEME_KEY, next);
    } catch (err) {
      console.error(err);
      toast('Mode warna berubah, tetapi preferensinya tidak bisa disimpan.');
    }
  }

  function loadTheme() {
    try {
      const stored = localStorage.getItem(THEME_KEY);
      return stored === 'light' ? 'light' : 'dark';
    } catch (err) {
      console.error(err);
      return 'dark';
    }
  }

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
    applyTheme(next, true);
  }

  async function onLogin(e) {
    e.preventDefault();
    if (!storageReady) return setLoginError(storageError || 'Data kasir belum siap. Muat ulang aplikasi.');
    if (!supabaseClient) return setLoginError(supabaseSetupError);
    const user = $('loginUser').value.trim().toLowerCase();
    const pass = $('loginPass').value;
    setLoginError('');
    if (!user || !pass) return setLoginError('Isi email dan password.');

    $('loginBtn').disabled = true;
    try {
      const { data, error } = await supabaseClient.auth.signInWithPassword({ email: user, password: pass });
      if (error) throw error;
      if (!data.user) throw new Error('Akun Supabase tidak ditemukan.');
      currentUser = data.user;
      await configureCloudState();
      showApp();
      switchTab('kasir');
      toast(`Selamat datang, ${currentUser.email}`);
    } catch (err) {
      console.error(err);
      if (currentUser) {
        await supabaseClient.auth.signOut({ scope: 'local' });
        currentUser = null;
      }
      setLoginError(err.message.includes('Invalid login credentials')
        ? 'Email atau password salah.'
        : `Gagal mengakses data cloud: ${err.message}`);
      $('loginPass').select();
    } finally {
      $('loginBtn').disabled = false;
    }
  }

  async function logout() {
    try {
      if (supabaseClient) {
        const { error } = await supabaseClient.auth.signOut({ scope: 'local' });
        if (error) throw error;
      }
    } catch (err) {
      console.error(err);
      toast('Tidak dapat mengakhiri sesi cloud. Periksa koneksi internet.');
    }
    currentUser = null;
    cloudActive = false;
    cloudRevision = 0;
    cloudSnapshot = null;
    closeAllModals();
    openSheet(false);
    showLogin();
  }

  async function restoreSession() {
    if (!supabaseClient) return false;
    const { data, error } = await supabaseClient.auth.getSession();
    if (error) throw error;
    if (!data.session?.user) return false;
    currentUser = data.session.user;
    await configureCloudState();
    return true;
  }

  /* ------------------------------------------------------------------------
     Keranjang
     ------------------------------------------------------------------------ */
  function loadCart() {
    try {
      const v = JSON.parse(localStorage.getItem(CART_KEY));
      if (!v || typeof v !== 'object' || Array.isArray(v)) return {};
      return Object.fromEntries(Object.entries(v).filter(([, qty]) =>
        Number.isSafeInteger(qty) && qty > 0));
    } catch (err) {
      console.error(err);
      return {};
    }
  }

  function saveCart() {
    try {
      localStorage.setItem(CART_KEY, JSON.stringify(cart));
      return true;
    } catch (err) {
      console.error(err);
      toast('Keranjang tidak dapat disimpan di perangkat ini.');
      return false;
    }
  }

  // Menyesuaikan keranjang bila produk dinonaktifkan/dihapus atau stok berubah
  function sanitizeCart() {
    let changed = false;
    for (const [id, qty] of Object.entries(cart)) {
      const p = findProduct(id);
      if (!Number.isSafeInteger(qty) || qty <= 0 || !p || !isActive(p)) {
        delete cart[id];
        changed = true;
        continue;
      }
      const max = maxQty(p);
      if (max <= 0) {
        delete cart[id];
        changed = true;
      } else if (qty > max) {
        cart[id] = max;
        changed = true;
      }
    }
    if (changed) saveCart();
  }

  function setQty(id, qty) {
    if (!Number.isSafeInteger(qty) || qty <= 0) delete cart[id];
    else cart[id] = qty;
    saveCart();
    renderAll();
  }

  function addToCart(id) {
    const p = findProduct(id);
    if (!p || !isActive(p)) return;
    const current = cart[id] || 0;
    if (current + 1 > maxQty(p)) return toast('Jumlah sudah mencapai stok tersedia');
    setQty(id, current + 1);
  }

  function changeQty(id, delta) {
    const p = findProduct(id);
    if (!p) return;
    const next = (cart[id] || 0) + delta;
    if (next > maxQty(p)) return toast('Jumlah melebihi stok tersedia');
    setQty(id, next);
  }

  async function clearCart() {
    if (!Object.keys(cart).length) return;
    const ok = await confirmDialog({
      title: 'Kosongkan keranjang?',
      message: 'Semua item di keranjang akan dihapus.',
      okText: 'Kosongkan',
      danger: true,
    });
    if (!ok) return;
    cart = {};
    saveCart();
    resetPaymentInputs();
    renderAll();
  }

  function resetPaymentInputs() {
    $('discount').value = '0';
    $('discountType').value = 'percent';
    $('paid').value = '';
    $('ref').value = '';
    $('customer').value = '';
    ui.method = 'tunai';
  }

  /* ------------------------------------------------------------------------
     Kalkulasi
     ------------------------------------------------------------------------ */
  function calc() {
    const items = Object.entries(cart)
      .map(([id, qty]) => {
        const p = findProduct(id);
        if (!p) return null;
        return { productId: p.id, name: p.name, sku: p.sku || '', price: p.price, qty, subtotal: p.price * qty };
      })
      .filter(Boolean);

    const subtotal = items.reduce((s, i) => s + i.subtotal, 0);
    const discountType = $('discountType').value;
    const discountValue = wholeNumber($('discount').value);
    const discount = Math.min(
      subtotal,
      discountType === 'percent' ? Math.round((subtotal * Math.min(discountValue, 100)) / 100) : discountValue,
    );
    const total = subtotal - discount;

    const cash = ui.method === 'tunai';
    const paid = cash ? wholeNumber($('paid').value) : total;
    const change = cash ? Math.max(0, paid - total) : 0;
    const short = cash && items.length > 0 && paid < total;
    const refMissing = !cash && items.length > 0 && !$('ref').value.trim();
    const qtyTotal = items.reduce((s, i) => s + i.qty, 0);

    return { items, qtyTotal, subtotal, discountType, discountValue, discount, total, paid, change, short, refMissing, cash };
  }

  /* ------------------------------------------------------------------------
     Checkout
     ------------------------------------------------------------------------ */
  async function checkout() {
    if (busy) return;
    const c = calc();
    if (!c.items.length) return;
    if (c.short) return toast('Uang dibayar masih kurang');
    if (c.refMissing) return toast('Isi nomor referensi pembayaran');

    const stale = c.items.find((i) => {
      const p = findProduct(i.productId);
      return !p || !isActive(p) || (!isService(p) && p.stock < i.qty);
    });
    if (stale) {
      toast(`Stok ${stale.name} berubah. Periksa keranjang.`);
      sanitizeCart();
      renderAll();
      return;
    }
    if (!saveCart()) return;

    const method = ui.method;
    const no = state.settings.lastNo + 1;
    const tx = {
      id: `SG-${String(no).padStart(6, '0')}`,
      no,
      date: new Date().toISOString(),
      customer: $('customer').value.trim() || 'Pelanggan umum',
      items: c.items.map(({ productId, name, sku, price, qty, subtotal }) => ({ productId, name, sku, price, qty, subtotal })),
      subtotal: c.subtotal,
      discountType: c.discountType,
      discountValue: c.discountValue,
      discount: c.discount,
      total: c.total,
      paymentMethod: method,
      paid: c.paid,
      change: c.change,
      reference: method === 'tunai' ? '' : $('ref').value.trim(),
      status: 'selesai',
    };

    const moves = [];
    const nextProducts = state.products.map((p) => {
      const it = c.items.find((i) => i.productId === p.id);
      if (!it || isService(p)) return p;
      const np = { ...p, stock: p.stock - it.qty };
      moves.push(movement({ productId: p.id, type: 'penjualan', qty: -it.qty, before: p.stock, after: np.stock, ref: tx.id }));
      return np;
    });
    const changedProducts = nextProducts.filter((p, idx) => p !== state.products[idx]);
    const nextSettings = { ...state.settings, lastNo: no };

    busy = true;
    renderSummary();
    let ok = false;
    let saveError = null;
    try {
      await writeTx(['products', 'transactions', 'settings', 'movements'], (idb) => {
        changedProducts.forEach((p) => idb.objectStore('products').put(p));
        idb.objectStore('transactions').put(tx);
        idb.objectStore('settings').put({ key: 'main', value: nextSettings });
        moves.forEach((m) => idb.objectStore('movements').put(m));
      });
      ok = true;
    } catch (err) {
      console.error(err);
      saveError = err;
    }
    busy = false;

    if (!ok) {
      toast(`${saveFailureMessage(saveError)} Transaksi belum tercatat.`);
      renderSummary();
      return;
    }

    // Commit ke state hanya setelah penyimpanan berhasil
    state.products = nextProducts;
    state.settings = nextSettings;
    state.transactions.unshift(tx);
    state.movements.push(...moves);
    cart = {};
    saveCart();
    resetPaymentInputs();
    openSheet(false);
    renderAll();
    showReceipt(tx);
    toast('Transaksi tersimpan');
  }

  /* ------------------------------------------------------------------------
     Ralat: batalkan transaksi (stok dikembalikan, jejak tetap ada)
     ------------------------------------------------------------------------ */
  function openVoid() {
    if (!currentReceipt || currentReceipt.status === 'dibatalkan') return;
    $('voidReason').value = '';
    openModal('voidModal');
  }

  async function confirmVoid() {
    const t = state.transactions.find((x) => x.id === currentReceipt?.id);
    if (!t || t.status === 'dibatalkan') return;
    const reason = $('voidReason').value.trim();
    if (reason.length < 5) return toast('Tulis alasan pembatalan (minimal 5 karakter)');

    const moves = [];
    const nextProducts = state.products.map((p) => {
      const it = t.items.find((i) => i.productId === p.id);
      if (!it || isService(p)) return p;
      const np = { ...p, stock: p.stock + it.qty };
      moves.push(movement({ productId: p.id, type: 'retur', qty: it.qty, before: p.stock, after: np.stock, ref: t.id, note: reason }));
      return np;
    });
    const changedProducts = nextProducts.filter((p, idx) => p !== state.products[idx]);
    const nextTx = { ...t, status: 'dibatalkan', voidReason: reason, voidedAt: new Date().toISOString() };

    const ok = await safeWrite(['products', 'transactions', 'movements'], (idb) => {
      changedProducts.forEach((p) => idb.objectStore('products').put(p));
      idb.objectStore('transactions').put(nextTx);
      moves.forEach((m) => idb.objectStore('movements').put(m));
    });
    if (!ok) return;

    state.products = nextProducts;
    state.transactions = state.transactions.map((x) => (x.id === t.id ? nextTx : x));
    state.movements.push(...moves);
    closeModal('voidModal');
    showReceipt(nextTx);
    renderAll();
    toast('Transaksi dibatalkan, stok dikembalikan');
  }

  /* ------------------------------------------------------------------------
     Render: kasir
     ------------------------------------------------------------------------ */
  function renderAll() {
    sanitizeCart();
    renderStats();
    renderChips();
    renderProducts();
    renderCart();
    renderCategories();
    renderManage();
    renderHistory();
    if (ui.tab === 'laporan') renderReports();
  }

  function renderStats() {
    const today = validTxs().filter((t) => new Date(t.date).toDateString() === new Date().toDateString());
    $('statSales').textContent = rupiah(sumOf(today));
    $('statCount').textContent = `${today.length} transaksi`;
    $('statAll').textContent = state.transactions.length;
    $('statProducts').textContent = state.products.filter(isActive).length;
    $('statLow').textContent = state.products.filter(isLow).length;
  }

  function renderChips() {
    const active = state.products.filter(isActive);
    const cats = [...new Set(active.map(categoryOf))].sort((a, b) => a.localeCompare(b, 'id'));
    if (ui.category && !cats.includes(ui.category)) ui.category = '';

    $('chips').innerHTML = [
      `<button type="button" class="chip${!ui.category && !ui.lowOnly ? ' active' : ''}" data-cat="">Semua</button>`,
      `<button type="button" class="chip${ui.lowOnly ? ' active' : ''}" data-low="1">⚠ Stok menipis</button>`,
      ...cats.map((c) =>
        `<button type="button" class="chip${ui.category === c && !ui.lowOnly ? ' active' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`),
    ].join('');
  }

  function renderProducts() {
    const q = ui.search.trim().toLowerCase();
    const list = sortedProducts().filter((p) =>
      isActive(p) &&
      matchText(p, q) &&
      (!ui.category || categoryOf(p) === ui.category) &&
      (!ui.lowOnly || isLow(p)));

    $('productGrid').innerHTML = list.length
      ? list.map(productCard).join('')
      : '<div class="empty">Produk tidak ditemukan.</div>';
  }

  function productCard(p) {
    const svc = isService(p);
    const out = !svc && p.stock <= 0;
    const low = isLow(p);
    let stockText = svc ? 'Layanan' : `Stok: ${p.stock}`;
    if (low && !out) stockText = `⚠ ${stockText} · menipis`;
    if (out) stockText += ' · habis';

    return `
      <button type="button" class="product" data-add="${esc(p.id)}" ${out ? 'disabled' : ''}
              aria-label="Tambah ${esc(p.name)} ke keranjang">
        <span class="pname">${esc(p.name)}</span>
        <span class="sku">${esc(p.sku || 'Tanpa SKU')} · ${esc(categoryOf(p))}</span>
        <span class="price">${rupiah(p.price)}</span>
        <span class="stock${low ? ' low' : ''}">${stockText}</span>
      </button>`;
  }

  function renderCart() {
    const c = calc();
    $('cartList').innerHTML = c.items.length
      ? c.items.map((i) => `
        <div class="cartitem">
          <div>
            <div class="name">${esc(i.name)}</div>
            <div class="unit">${rupiah(i.price)} / unit</div>
            <div class="qty">
              <button type="button" class="small" data-dec="${esc(i.productId)}" aria-label="Kurangi ${esc(i.name)}">−</button>
              <span>${i.qty}</span>
              <button type="button" class="small" data-inc="${esc(i.productId)}" aria-label="Tambah ${esc(i.name)}">＋</button>
              <button type="button" class="ghost small danger-text" data-rm="${esc(i.productId)}">Hapus</button>
            </div>
          </div>
          <div class="cartprice">${rupiah(i.subtotal)}</div>
        </div>`).join('')
      : '<div class="empty">Keranjang masih kosong.<br>Pilih produk untuk memulai transaksi.</div>';

    renderSummary();
  }

  function renderSummary() {
    const c = calc();
    $('subtotal').textContent = rupiah(c.subtotal);
    $('discountOut').textContent = '− ' + rupiah(c.discount);
    $('total').textContent = rupiah(c.total);
    $('changeOut').textContent = rupiah(c.change);
    $('barTotal').textContent = rupiah(c.total);
    $('barCount').textContent = `${c.qtyTotal} item`;
    $('cartCount').textContent = `${c.qtyTotal} item`;

    document.querySelectorAll('#methods [data-method]').forEach((b) =>
      b.classList.toggle('active', b.dataset.method === ui.method));
    $('cashBox').hidden = !c.cash;
    $('refBox').hidden = c.cash;
    $('refLabel').textContent = `Nomor referensi ${METHOD_LABEL[ui.method]}`;
    const isQris = ui.method === 'qris';
    $('showQris').hidden = !isQris || !state.settings.qris;
    $('qrisHint').hidden = !(isQris && !state.settings.qris);
    renderQuick(c);

    let msg = '';
    if (c.short) msg = 'Uang dibayar masih kurang. Transaksi belum bisa diproses.';
    else if (c.refMissing) msg = 'Isi nomor referensi (bukti transfer atau QRIS) sebelum menyimpan.';
    $('warn').textContent = msg;
    $('warn').classList.toggle('show', Boolean(msg));

    $('checkoutBtn').disabled = !c.items.length || c.short || c.refMissing || busy;
  }

  function renderQuick(c) {
    const box = $('quick');
    if (!c.cash || !c.total) {
      box.innerHTML = '';
      return;
    }
    const steps = [
      c.total,
      Math.ceil(c.total / 10000) * 10000,
      Math.ceil(c.total / 50000) * 50000,
      Math.ceil(c.total / 100000) * 100000,
    ];
    const unique = [...new Set(steps)].slice(0, 4);
    box.innerHTML = unique
      .map((v, i) => `<button type="button" class="small" data-quick="${v}">${i === 0 ? 'Uang pas' : rupiah(v)}</button>`)
      .join('');
  }

  /* ------------------------------------------------------------------------
     Render: produk & jenis
     ------------------------------------------------------------------------ */
  function renderCategories() {
    const counts = {};
    state.products.forEach((p) => { counts[categoryOf(p)] = (counts[categoryOf(p)] || 0) + 1; });
    const cats = state.settings.categories;

    $('catList').innerHTML = cats.length
      ? cats.map((c) => {
        const n = counts[c] || 0;
        return `
          <div class="item catrow">
            <div class="main">
              <div class="title">${esc(c)}</div>
              <div class="meta">${n} produk</div>
            </div>
            <div class="side">
              <div class="actions">
                <button type="button" class="small" data-cat-edit="${esc(c)}">Ubah</button>
                <button type="button" class="small danger" data-cat-del="${esc(c)}" ${n ? 'disabled title="Masih dipakai produk"' : ''}>Hapus</button>
              </div>
            </div>
          </div>`;
      }).join('')
      : '<div class="empty">Belum ada jenis produk.</div>';
  }

  function renderManage() {
    const q = ui.manageSearch.trim().toLowerCase();
    const list = sortedProducts().filter((p) => matchText(p, q));

    $('manageList').innerHTML = list.length
      ? list.map((p) => {
        const svc = isService(p);
        const low = isLow(p);
        const active = isActive(p);
        const status = !active
          ? '<span class="pill off">Nonaktif</span>'
          : svc
            ? '<span class="pill blue">Jasa</span>'
            : `<span class="pill${low ? ' low' : ''}">Stok ${p.stock}</span>`;
        return `
          <div class="item manage-item${active ? '' : ' inactive'}">
            <div class="main">
              <div class="title">${esc(p.name)}</div>
              <div class="meta">${esc(p.sku || 'Tanpa SKU')} · ${esc(categoryOf(p))} · ${svc ? 'Jasa' : 'Barang'}</div>
              <div class="meta">${rupiah(p.price)}</div>
            </div>
            <div class="side">
              ${status}
              <div class="actions">
                <button type="button" class="small" data-edit="${esc(p.id)}">Ubah</button>
                ${svc ? '' : `<button type="button" class="small" data-restock="${esc(p.id)}">+ Stok</button>
                <button type="button" class="small ghost" data-moves="${esc(p.id)}">Riwayat</button>`}
                <button type="button" class="small ghost" data-toggle="${esc(p.id)}">${active ? 'Nonaktifkan' : 'Aktifkan'}</button>
              </div>
            </div>
          </div>`;
      }).join('')
      : '<div class="empty">Produk tidak ditemukan.</div>';
  }

  /* ------------------------------------------------------------------------
     Produk: tambah / ubah / stok / aktif
     ------------------------------------------------------------------------ */
  function fillCategorySelect(selected) {
    const cats = state.settings.categories.length ? state.settings.categories : ['Umum'];
    $('pCategory').innerHTML = cats
      .map((c) => `<option value="${esc(c)}" ${c === selected ? 'selected' : ''}>${esc(c)}</option>`)
      .join('');
  }

  function syncTypeFields() {
    const svc = $('pType').value === 'jasa';
    const editing = Boolean(editingId);
    $('stockField').hidden = svc || editing;
    $('minField').hidden = svc;
    $('productNote').hidden = !editing;
  }

  function openProductModal(id = null) {
    editingId = id;
    const p = id ? findProduct(id) : null;
    $('productTitle').textContent = p ? 'Ubah produk' : 'Tambah produk';
    $('pName').value = p ? p.name : '';
    $('pSku').value = p ? p.sku || '' : '';
    fillCategorySelect(p ? categoryOf(p) : state.settings.categories[0]);
    $('pType').value = p ? (isService(p) ? 'jasa' : 'barang') : 'barang';
    $('pType').disabled = Boolean(p);
    $('pPrice').value = p ? p.price : '';
    $('pStock').value = '';
    $('pMin').value = p && !isService(p) ? minStockOf(p) : DEFAULT_MIN_STOCK;
    syncTypeFields();
    openModal('productModal');
  }

  async function saveProduct() {
    if (busy) return;
    const name = $('pName').value.trim();
    const sku = $('pSku').value.trim();
    const category = $('pCategory').value || 'Umum';
    const svc = $('pType').value === 'jasa';
    const priceRaw = $('pPrice').value.trim();
    const stockRaw = $('pStock').value.trim();
    const minRaw = $('pMin').value.trim();

    if (!name) return toast('Nama produk wajib diisi');
    if (priceRaw === '' || !(Number(priceRaw) > 0)) return toast('Harga harus lebih dari 0');
    if (!editingId && !svc && (stockRaw === '' || !Number.isInteger(Number(stockRaw)) || Number(stockRaw) < 0)) {
      return toast('Stok awal harus bilangan bulat ≥ 0');
    }
    if (sku && state.products.some((p) => p.id !== editingId && (p.sku || '').toLowerCase() === sku.toLowerCase())) {
      return toast('SKU sudah digunakan produk lain');
    }

    if (editingId) {
      const old = findProduct(editingId);
      const updated = {
        ...old,
        name,
        sku,
        category,
        price: Math.round(Number(priceRaw)),
        minStock: isService(old) ? 0 : wholeNumber(minRaw || DEFAULT_MIN_STOCK),
      };
      const ok = await safeWrite(['products'], (idb) => idb.objectStore('products').put(updated), 'Produk diperbarui');
      if (!ok) return;
      state.products = state.products.map((p) => (p.id === updated.id ? updated : p));
    } else {
      const product = {
        id: newId('p'),
        name,
        sku,
        category,
        type: svc ? 'jasa' : 'barang',
        price: Math.round(Number(priceRaw)),
        stock: svc ? null : Number(stockRaw),
        minStock: svc ? 0 : wholeNumber(minRaw || DEFAULT_MIN_STOCK),
        active: true,
      };
      const moves = !svc && product.stock > 0
        ? [movement({ productId: product.id, type: 'awal', qty: product.stock, before: 0, after: product.stock })]
        : [];
      const ok = await safeWrite(['products', 'movements'], (idb) => {
        idb.objectStore('products').put(product);
        moves.forEach((m) => idb.objectStore('movements').put(m));
      }, `Produk "${name}" ditambahkan`);
      if (!ok) return;
      state.products.push(product);
      state.movements.push(...moves);
    }

    closeModal('productModal');
    editingId = null;
    renderAll();
  }

  function openRestock(id) {
    const p = findProduct(id);
    if (!p || isService(p)) return;
    restockId = id;
    $('restockTitle').textContent = `Tambah stok: ${p.name}`;
    $('restockInfo').textContent = `Stok saat ini: ${p.stock} unit`;
    $('restockQty').value = '';
    openModal('restockModal');
  }

  function updateRestockPreview() {
    const p = findProduct(restockId);
    if (!p) return;
    const add = wholeNumber($('restockQty').value);
    $('restockInfo').textContent = add > 0
      ? `Stok: ${p.stock} → ${p.stock + add} unit`
      : `Stok saat ini: ${p.stock} unit`;
  }

  async function saveRestock() {
    const p = findProduct(restockId);
    const raw = $('restockQty').value.trim();
    const add = Number(raw);
    if (!p) return;
    if (raw === '' || !Number.isInteger(add) || add <= 0) {
      return toast('Masukkan jumlah tambahan (bilangan bulat > 0)');
    }
    const updated = { ...p, stock: p.stock + add };
    const m = movement({ productId: p.id, type: 'penambahan', qty: add, before: p.stock, after: updated.stock });
    const ok = await safeWrite(['products', 'movements'], (idb) => {
      idb.objectStore('products').put(updated);
      idb.objectStore('movements').put(m);
    }, `Stok ${p.name} bertambah ${add}`);
    if (!ok) return;
    state.products = state.products.map((x) => (x.id === p.id ? updated : x));
    state.movements.push(m);
    closeModal('restockModal');
    renderAll();
  }

  async function toggleActive(id) {
    const p = findProduct(id);
    if (!p) return;
    const updated = { ...p, active: !isActive(p) };
    const ok = await safeWrite(['products'], (idb) => idb.objectStore('products').put(updated),
      updated.active ? `"${p.name}" diaktifkan` : `"${p.name}" dinonaktifkan dari kasir`);
    if (!ok) return;
    state.products = state.products.map((x) => (x.id === p.id ? updated : x));
    renderAll();
  }

  function openMoves(id) {
    const p = findProduct(id);
    if (!p) return;
    $('movTitle').textContent = `Riwayat stok: ${p.name}`;
    const list = state.movements
      .filter((m) => m.productId === id)
      .sort((a, b) => b.at.localeCompare(a.at));
    $('movList').innerHTML = list.length
      ? list.map((m) => `
        <div class="item">
          <div class="main">
            <div class="title">${esc(MOVE_LABEL[m.type] || m.type)}</div>
            <div class="meta">${esc(fmtDateTime(m.at))}${m.ref ? ' · ' + esc(m.ref) : ''}</div>
            ${m.note ? `<div class="meta">${esc(m.note)}</div>` : ''}
          </div>
          <div class="side">
            <strong>${m.qty > 0 ? '+' : ''}${m.qty}</strong>
            <span class="pill blue">Sisa ${m.after}</span>
          </div>
        </div>`).join('')
      : '<div class="empty">Belum ada riwayat stok.</div>';
    openModal('movementsModal');
  }

  /* ------------------------------------------------------------------------
     Jenis produk (kategori)
     ------------------------------------------------------------------------ */
  function openCategoryModal(old = null) {
    editingCat = old;
    $('catTitle').textContent = old ? 'Ubah jenis produk' : 'Jenis produk baru';
    $('catName').value = old || '';
    openModal('categoryModal');
  }

  async function saveCategory() {
    const name = $('catName').value.trim().replace(/\s+/g, ' ');
    if (!name) return toast('Nama jenis wajib diisi');
    const cats = state.settings.categories;
    if (cats.some((c) => c.toLowerCase() === name.toLowerCase() && c !== editingCat)) {
      return toast('Jenis produk itu sudah ada');
    }

    if (!editingCat) {
      const next = { ...state.settings, categories: [...cats, name] };
      const ok = await saveSettingsRecord(next);
      if (!ok) return;
      state.settings = next;
      toast(`Jenis "${name}" ditambahkan`);
    } else {
      const next = { ...state.settings, categories: cats.map((c) => (c === editingCat ? name : c)) };
      const updated = state.products.filter((p) => p.category === editingCat).map((p) => ({ ...p, category: name }));
      const ok = await safeWrite(['products', 'settings'], (idb) => {
        idb.objectStore('settings').put({ key: 'main', value: next });
        updated.forEach((p) => idb.objectStore('products').put(p));
      }, `Jenis diubah menjadi "${name}"`);
      if (!ok) return;
      state.settings = next;
      state.products = state.products.map((p) => (p.category === editingCat ? { ...p, category: name } : p));
    }

    closeModal('categoryModal');
    editingCat = null;
    renderAll();
  }

  async function deleteCategory(name) {
    const used = state.products.filter((p) => categoryOf(p) === name).length;
    if (used) return toast('Jenis masih dipakai produk. Pindahkan produknya dulu.');
    const ok = await confirmDialog({
      title: 'Hapus jenis produk?',
      message: `Jenis "${name}" akan dihapus dari daftar.`,
      okText: 'Hapus',
      danger: true,
    });
    if (!ok) return;
    const next = { ...state.settings, categories: state.settings.categories.filter((c) => c !== name) };
    const saved = await saveSettingsRecord(next);
    if (!saved) return;
    state.settings = next;
    renderAll();
    toast(`Jenis "${name}" dihapus`);
  }

  /* ------------------------------------------------------------------------
     Laporan
     ------------------------------------------------------------------------ */
  const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const startOfWeek = (d) => {
    const x = startOfDay(d);
    x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
    return x;
  };
  const startOfMonth = (d) => new Date(d.getFullYear(), d.getMonth(), 1);

  function buckets(gran) {
    const now = new Date();
    const out = [];
    if (gran === 'day') {
      const s = startOfDay(now);
      for (let i = 6; i >= 0; i--) {
        const from = new Date(s);
        from.setDate(s.getDate() - i);
        const to = new Date(from);
        to.setDate(from.getDate() + 1);
        out.push({ from, to, label: from.toLocaleDateString('id-ID', { weekday: 'short' }).replace('.', ''), now: i === 0 });
      }
    } else if (gran === 'week') {
      const s = startOfWeek(now);
      for (let i = 7; i >= 0; i--) {
        const from = new Date(s);
        from.setDate(s.getDate() - 7 * i);
        const to = new Date(from);
        to.setDate(from.getDate() + 7);
        out.push({ from, to, label: `${from.getDate()}/${from.getMonth() + 1}`, now: i === 0 });
      }
    } else {
      for (let i = 11; i >= 0; i--) {
        const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
        const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
        out.push({ from, to, label: from.toLocaleDateString('id-ID', { month: 'short' }).replace('.', ''), now: i === 0 });
      }
    }
    return out;
  }

  // Saran: rata-rata 4 minggu & 3 bulan terakhir yang sudah selesai, +10%
  function suggestion() {
    const valid = validTxs();
    const now = new Date();
    const wStart = startOfWeek(now);
    const weekTotals = [];
    for (let i = 1; i <= 4; i++) {
      const from = new Date(wStart);
      from.setDate(wStart.getDate() - 7 * i);
      const to = new Date(from);
      to.setDate(from.getDate() + 7);
      weekTotals.push(sumOf(valid.filter((t) => inRange(t, from, to))));
    }
    const monthTotals = [];
    for (let i = 1; i <= 3; i++) {
      const from = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const to = new Date(from.getFullYear(), from.getMonth() + 1, 1);
      monthTotals.push(sumOf(valid.filter((t) => inRange(t, from, to))));
    }
    const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
    const weekHas = weekTotals.some((x) => x > 0);
    const monthHas = monthTotals.some((x) => x > 0);
    return {
      weekHas,
      monthHas,
      wAvg: avg(weekTotals),
      mAvg: avg(monthTotals),
      week: weekHas ? roundUp(avg(weekTotals) * 1.1, 100000) : 0,
      month: monthHas ? roundUp(avg(monthTotals) * 1.1, 1000000) : 0,
    };
  }

  function progressRow(total, target, txt, bar) {
    if (target > 0) {
      const pct = Math.min(100, (total / target) * 100);
      txt.textContent = `${rupiah(total)} / ${rupiah(target)} (${Math.round(pct)}%)`;
      bar.style.width = pct + '%';
      bar.classList.toggle('done', total >= target);
    } else {
      txt.textContent = `${rupiah(total)} · belum ada target`;
      bar.style.width = '0%';
      bar.classList.remove('done');
    }
  }

  function renderReports() {
    const valid = validTxs();
    const now = new Date();
    const since = (s) => valid.filter((t) => new Date(t.date) >= s);

    const d = since(startOfDay(now));
    const w = since(startOfWeek(now));
    const m = since(startOfMonth(now));
    $('repDay').textContent = rupiah(sumOf(d));
    $('repDayN').textContent = `${d.length} transaksi`;
    $('repWeek').textContent = rupiah(sumOf(w));
    $('repWeekN').textContent = `${w.length} transaksi`;
    $('repMonth').textContent = rupiah(sumOf(m));
    $('repMonthN').textContent = `${m.length} transaksi`;

    progressRow(sumOf(w), state.settings.targetWeek, $('progWeekTxt'), $('progWeek'));
    progressRow(sumOf(m), state.settings.targetMonth, $('progMonthTxt'), $('progMonth'));

    const s = suggestion();
    $('suggestBox').innerHTML = `
      <div>💡 <strong>Saran target minggu:</strong> ${s.weekHas
        ? `<strong>${rupiah(s.week)}</strong> (rata-rata 4 minggu terakhir ${rupiah(s.wAvg)} + 10%)`
        : 'belum cukup data minggu sebelumnya.'}</div>
      <div>💡 <strong>Saran target bulan:</strong> ${s.monthHas
        ? `<strong>${rupiah(s.month)}</strong> (rata-rata 3 bulan terakhir ${rupiah(s.mAvg)} + 10%)`
        : 'belum cukup data bulan sebelumnya.'}</div>`;

    renderChart();
  }

  function renderChart() {
    const rs = buckets(reportRange);
    const valid = validTxs();
    const data = rs.map((r) => {
      const list = valid.filter((t) => inRange(t, r.from, r.to));
      return { ...r, total: sumOf(list), count: list.length };
    });
    const max = Math.max(1, ...data.map((d) => d.total));

    $('chart').innerHTML = data.map((d) => `
      <div class="col${d.now ? ' now' : ''}" title="${esc(d.label)}: ${rupiah(d.total)} (${d.count} transaksi)">
        <div class="val">${d.total ? shortRp(d.total) : ''}</div>
        <div class="bar-v" style="height:${Math.max(3, Math.round((d.total / max) * 130))}px"></div>
        <div class="lbl">${esc(d.label)}</div>
      </div>`).join('');

    const rangeText = { day: '7 hari terakhir', week: '8 minggu terakhir', month: '12 bulan terakhir' }[reportRange];
    $('rangeLabel1').textContent = `· ${rangeText}`;
    $('rangeLabel2').textContent = `· ${rangeText}`;

    const from = rs[0].from;
    const to = rs[rs.length - 1].to;
    const txs = valid.filter((t) => inRange(t, from, to));

    const agg = {};
    txs.forEach((t) => t.items.forEach((i) => {
      const k = i.productId || i.name;
      agg[k] = agg[k] || { name: i.name, qty: 0, rev: 0 };
      agg[k].qty += i.qty;
      agg[k].rev += i.subtotal;
    }));
    const top = Object.values(agg).sort((a, b) => b.rev - a.rev).slice(0, 5);
    $('topList').innerHTML = top.length
      ? top.map((x, i) => `
        <div class="item">
          <div class="main"><div class="title">${i + 1}. ${esc(x.name)}</div><div class="meta">${x.qty} terjual</div></div>
          <div class="side"><strong>${rupiah(x.rev)}</strong></div>
        </div>`).join('')
      : '<div class="empty">Belum ada penjualan pada periode ini.</div>';

    const byMethod = { tunai: 0, qris: 0, transfer: 0 };
    txs.forEach((t) => { const k = t.paymentMethod || 'tunai'; byMethod[k] = (byMethod[k] || 0) + t.total; });
    const totalAll = sumOf(txs);
    $('methodList').innerHTML = Object.keys(METHOD_LABEL).map((k) => {
      const v = byMethod[k] || 0;
      const pct = totalAll ? Math.round((v / totalAll) * 100) : 0;
      return `
        <div class="item">
          <div class="main"><div class="title">${METHOD_LABEL[k]}</div><div class="meta">${pct}% dari omzet</div></div>
          <div class="side"><strong>${rupiah(v)}</strong></div>
        </div>`;
    }).join('');
  }

  function fillTargets() {
    $('targetWeek').value = state.settings.targetWeek || '';
    $('targetMonth').value = state.settings.targetMonth || '';
  }

  async function saveTargets() {
    const next = {
      ...state.settings,
      targetWeek: wholeNumber($('targetWeek').value),
      targetMonth: wholeNumber($('targetMonth').value),
    };
    const ok = await saveSettingsRecord(next);
    if (!ok) return;
    state.settings = next;
    renderReports();
    toast('Target disimpan');
  }

  function useSuggestion() {
    const s = suggestion();
    if (s.weekHas) $('targetWeek').value = s.week;
    if (s.monthHas) $('targetMonth').value = s.month;
    toast('Saran dipasang. Tekan "Simpan target" untuk menyimpannya.');
  }

  /* ------------------------------------------------------------------------
     Riwayat & struk
     ------------------------------------------------------------------------ */
  function renderHistory() {
    const q = ui.historySearch.trim().toLowerCase();
    const list = state.transactions.filter((t) =>
      !q || `${t.id} ${t.customer} ${t.items.map((i) => i.name).join(' ')}`.toLowerCase().includes(q));

    $('historyList').innerHTML = list.length
      ? list.map((t) => {
        const voided = t.status === 'dibatalkan';
        return `
          <button type="button" class="item${voided ? ' voided' : ''}" data-view="${esc(t.id)}">
            <div class="main">
              <div class="title">${esc(t.id)}</div>
              <div class="meta">${esc(fmtDateTime(t.date))}</div>
              <div class="meta">${esc(t.customer)} · ${t.items.map((i) => `${esc(i.name)} ×${i.qty}`).join(', ')}</div>
            </div>
            <div class="side">
              <strong>${rupiah(t.total)}</strong>
              ${voided
    ? '<span class="pill void">Dibatalkan</span>'
    : `<span class="pill">${esc(METHOD_LABEL[t.paymentMethod] || 'Tunai')}</span>`}
            </div>
          </button>`;
      }).join('')
      : '<div class="empty">Belum ada transaksi.</div>';
  }

  function receiptHTML(t) {
    const s = state.settings;
    const paper = s.paper === '80' ? 'p80' : 'p58';
    const isCash = t.paymentMethod === 'tunai';
    const voided = t.status === 'dibatalkan';

    return `
      <div class="receipt ${paper}">
        <h2>${esc(s.name)}</h2>
        ${s.info ? `<p class="c">${esc(s.info)}</p>` : ''}
        <hr>
        <div class="rline"><span>No.</span><span>${esc(t.id)}</span></div>
        <div class="rline"><span>Waktu</span><span>${esc(fmtDateTime(t.date))}</span></div>
        <div class="rline"><span>Pelanggan</span><span>${esc(t.customer)}</span></div>
        <hr>
        ${t.items.map((i) => `
          <div class="it">
            <div>${esc(i.name)}</div>
            <div class="rline"><span>${i.qty} × ${rupiah(i.price)}</span><span>${rupiah(i.subtotal)}</span></div>
          </div>`).join('')}
        <hr>
        <div class="rline"><span>Subtotal</span><span>${rupiah(t.subtotal)}</span></div>
        <div class="rline"><span>Diskon</span><span>− ${rupiah(t.discount)}</span></div>
        <div class="rline strong"><span>Total</span><span>${rupiah(t.total)}</span></div>
        <div class="rline"><span>${esc(METHOD_LABEL[t.paymentMethod] || 'Tunai')}</span><span>${rupiah(t.paid)}</span></div>
        ${isCash
    ? `<div class="rline strong"><span>Kembalian</span><span>${rupiah(t.change)}</span></div>`
    : `<div class="rline"><span>Ref.</span><span>${esc(t.reference || '-')}</span></div>`}
        ${voided ? `<div class="stamp">DIBATALKAN</div><p class="c">Alasan: ${esc(t.voidReason || '-')}</p>` : ''}
        <hr>
        <p class="c">Terima kasih telah berkunjung!<br>${esc(s.name)}</p>
      </div>`;
  }

  function showReceipt(t) {
    currentReceipt = t;
    $('receiptBody').innerHTML = receiptHTML(t);
    $('rVoid').hidden = t.status === 'dibatalkan';
    $('rShare').hidden = !canShareFiles();
    openModal('receiptModal');
  }

  function printReceipt() {
    if (!currentReceipt) return;
    $('print-area').innerHTML = receiptHTML(currentReceipt);
    window.print();
  }

  // Menggambar struk ke canvas (digambar 2x agar tajam). Hasilnya PNG untuk disimpan/dibagikan.
  function receiptCanvas(t) {
    const s = state.settings;
    const W = s.paper === '80' ? 576 : 384;
    const K = 2;
    const pad = 22;
    const innerW = W - pad * 2;
    const fs = s.paper === '80' ? 26 : 22;
    const family = '"Courier New", Courier, monospace';
    const mctx = document.createElement('canvas').getContext('2d');
    const lines = [];
    let y = pad;

    const setFont = (size, bold) => { mctx.font = `${bold ? '700 ' : ''}${size}px ${family}`; };

    function addLine(text, { size = fs, bold = false, align = 'left', gap = 4 } = {}) {
      setFont(size, bold);
      const words = String(text).split(' ');
      const out = [];
      let cur = '';
      for (const w of words) {
        const test = cur ? `${cur} ${w}` : w;
        if (mctx.measureText(test).width > innerW && cur) {
          out.push(cur);
          cur = w;
        } else {
          cur = test;
        }
      }
      out.push(cur);
      out.forEach((l) => {
        lines.push({ text: l, size, bold, align, y });
        y += size * 1.35;
      });
      y += gap;
    }

    function addPair(left, right, { size = fs, bold = false } = {}) {
      setFont(size, bold);
      const rw = mctx.measureText(right).width;
      let l = left;
      while (mctx.measureText(l).width > innerW - rw - 10 && l.length > 4) l = l.slice(0, -1);
      if (l !== left) l = l.slice(0, -1) + '…';
      lines.push({ text: l, size, bold, align: 'left', y });
      lines.push({ text: right, size, bold, align: 'right', y });
      y += size * 1.35 + 2;
    }

    function sep() {
      lines.push({ sep: true, y });
      y += 12;
    }

    addLine(s.name, { size: fs + 6, bold: true, align: 'center', gap: 2 });
    if (s.info) addLine(s.info, { size: fs - 4, align: 'center' });
    sep();
    addPair('No.', t.id);
    addPair('Waktu', fmtDateTime(t.date));
    addPair('Pelanggan', t.customer);
    sep();
    t.items.forEach((i) => {
      addLine(i.name, { bold: true, gap: 0 });
      addPair(`${i.qty} x ${rupiah(i.price)}`, rupiah(i.subtotal));
    });
    sep();
    addPair('Subtotal', rupiah(t.subtotal));
    addPair('Diskon', '- ' + rupiah(t.discount));
    addPair('TOTAL', rupiah(t.total), { bold: true, size: fs + 2 });
    addPair(METHOD_LABEL[t.paymentMethod] || 'Tunai', rupiah(t.paid));
    if (t.paymentMethod === 'tunai') addPair('Kembalian', rupiah(t.change), { bold: true });
    else addPair('Ref.', t.reference || '-');
    if (t.status === 'dibatalkan') {
      sep();
      addLine('*** DIBATALKAN ***', { bold: true, align: 'center', size: fs + 2 });
      addLine('Alasan: ' + (t.voidReason || '-'), { align: 'center', size: fs - 2 });
    }
    sep();
    addLine('Terima kasih telah berkunjung!', { align: 'center' });
    addLine(s.name, { align: 'center', size: fs - 2 });

    const H = Math.ceil(y + pad);
    const canvas = document.createElement('canvas');
    canvas.width = W * K;
    canvas.height = H * K;
    const ctx = canvas.getContext('2d');
    ctx.setTransform(K, 0, 0, K, 0, 0);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = '#111111';
    ctx.textBaseline = 'top';

    lines.forEach((ln) => {
      if (ln.sep) {
        ctx.save();
        ctx.setLineDash([5, 4]);
        ctx.strokeStyle = '#888888';
        ctx.beginPath();
        ctx.moveTo(pad, ln.y + 4);
        ctx.lineTo(W - pad, ln.y + 4);
        ctx.stroke();
        ctx.restore();
        return;
      }
      ctx.font = `${ln.bold ? '700 ' : ''}${ln.size}px ${family}`;
      ctx.textAlign = ln.align === 'right' ? 'right' : ln.align === 'center' ? 'center' : 'left';
      const x = ln.align === 'right' ? W - pad : ln.align === 'center' ? W / 2 : pad;
      ctx.fillText(ln.text, x, ln.y);
    });

    return canvas;
  }

  const receiptBlob = (t) => new Promise((resolve) => receiptCanvas(t).toBlob(resolve, 'image/png'));

  async function downloadReceiptPNG() {
    if (!currentReceipt) return;
    const blob = await receiptBlob(currentReceipt);
    download(`struk-${currentReceipt.id}.png`, blob, 'image/png');
    toast('Gambar struk disimpan ke perangkat');
  }

  function canShareFiles() {
    try {
      const f = new File(['x'], 'x.png', { type: 'image/png' });
      return Boolean(navigator.canShare && navigator.canShare({ files: [f] }));
    } catch {
      return false;
    }
  }

  async function shareReceipt() {
    if (!currentReceipt) return;
    const blob = await receiptBlob(currentReceipt);
    const file = new File([blob], `struk-${currentReceipt.id}.png`, { type: 'image/png' });
    try {
      await navigator.share({ files: [file], title: `Struk ${currentReceipt.id}` });
    } catch (err) {
      if (err.name !== 'AbortError') toast('Gagal membagikan struk');
    }
  }

  /* ------------------------------------------------------------------------
     QRIS
     ------------------------------------------------------------------------ */
  // Mengubah gambar menjadi dataURL. fill = warna latar (null = tetap transparan).
  function fileToImageDataUrl(file, max, fill) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        const ctx = c.getContext('2d');
        if (fill) {
          ctx.fillStyle = fill;
          ctx.fillRect(0, 0, c.width, c.height);
        }
        ctx.drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(img.src);
        resolve(c.toDataURL('image/png'));
      };
      img.onerror = () => reject(new Error('Gambar tidak bisa dibaca'));
      img.src = URL.createObjectURL(file);
    });
  }

  async function uploadQris(file) {
    if (!file || !file.type.startsWith('image/')) return toast('Pilih file gambar (PNG atau JPG)');
    try {
      const dataUrl = await fileToImageDataUrl(file, 900, '#ffffff');
      const next = { ...state.settings, qris: dataUrl };
      const ok = await saveSettingsRecord(next);
      if (!ok) return;
      state.settings = next;
      renderQrisPreview();
      renderSummary();
      toast('QRIS disimpan');
    } catch (err) {
      console.error(err);
      toast('Gambar QRIS tidak bisa diproses');
    }
  }

  async function removeQris() {
    const ok = await confirmDialog({ title: 'Hapus QRIS?', message: 'Gambar QRIS toko akan dihapus.', okText: 'Hapus', danger: true });
    if (!ok) return;
    const next = { ...state.settings, qris: null };
    const saved = await saveSettingsRecord(next);
    if (!saved) return;
    state.settings = next;
    renderQrisPreview();
    renderSummary();
    toast('QRIS dihapus');
  }

  function renderQrisPreview() {
    const q = state.settings.qris;
    $('qrisPreview').innerHTML = q
      ? `<img src="${esc(q)}" alt="QRIS toko">`
      : '<span class="muted">Belum ada gambar QRIS</span>';
    $('qrisRemove').disabled = !q;
  }

  function applyLogo() {
    const src = state.settings.logo || 'assets/logo.png';
    $('topLogo').src = src;
    $('loginLogo').src = src;
    $('logoPreview').innerHTML = state.settings.logo
      ? `<img src="${esc(state.settings.logo)}" alt="Logo toko">`
      : '<span class="muted">Memakai logo bawaan</span>';
    $('logoRemove').disabled = !state.settings.logo;
  }

  async function uploadLogo(file) {
    if (!file || !file.type.startsWith('image/')) return toast('Pilih file gambar (PNG, JPG, atau WebP)');
    try {
      const dataUrl = await fileToImageDataUrl(file, 800, null);
      const next = { ...state.settings, logo: dataUrl };
      const ok = await saveSettingsRecord(next);
      if (!ok) return;
      state.settings = next;
      applyLogo();
      toast('Logo disimpan');
    } catch (err) {
      console.error(err);
      toast('Gambar logo tidak bisa diproses');
    }
  }

  async function removeLogo() {
    const next = { ...state.settings, logo: null };
    const ok = await saveSettingsRecord(next);
    if (!ok) return;
    state.settings = next;
    applyLogo();
    toast('Logo bawaan dipakai kembali');
  }

  function openQrisModal() {
    if (!state.settings.qris) return toast('Belum ada QRIS. Unggah di menu Pengaturan.');
    const c = calc();
    $('qrisImg').src = state.settings.qris;
    $('qrisAmount').textContent = `Total bayar: ${rupiah(c.total)}`;
    openModal('qrisModal');
  }

  /* ------------------------------------------------------------------------
     Pengaturan, ekspor, cadangan
     ------------------------------------------------------------------------ */
  async function saveSettings() {
    const next = {
      ...state.settings,
      name: $('storeName').value.trim() || 'Sorentho Garage',
      info: $('storeInfo').value.trim(),
      paper: $('paperSize').value === '80' ? '80' : '58',
    };
    const ok = await saveSettingsRecord(next);
    if (!ok) return;
    state.settings = next;
    renderAll();
    toast('Pengaturan disimpan');
  }

  function fillSettingsForm() {
    $('storeName').value = state.settings.name;
    $('storeInfo').value = state.settings.info || '';
    $('paperSize').value = state.settings.paper;
    renderQrisPreview();
    updateInstallUI();
  }

  function download(filename, content, type) {
    const url = URL.createObjectURL(new Blob([content], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  function exportCSV() {
    if (!state.transactions.length) return toast('Belum ada transaksi untuk diekspor');
    const head = ['No Transaksi', 'Tanggal', 'Pelanggan', 'Item', 'Subtotal', 'Diskon', 'Total', 'Metode', 'Dibayar', 'Referensi', 'Kembalian', 'Status', 'Alasan batal'];
    const rows = state.transactions.map((t) => [
      t.id,
      fmtDateTime(t.date),
      t.customer,
      t.items.map((i) => `${i.name} x${i.qty}`).join('; '),
      t.subtotal,
      t.discount,
      t.total,
      METHOD_LABEL[t.paymentMethod] || 'Tunai',
      t.paid,
      t.reference || '',
      t.change,
      t.status === 'dibatalkan' ? 'Dibatalkan' : 'Selesai',
      t.voidReason || '',
    ]);
    const csv = '\uFEFF' + [head, ...rows]
      .map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(','))
      .join('\r\n');
    download(`riwayat-sorentho-${dateStamp()}.csv`, csv, 'text/csv;charset=utf-8');
  }

  function exportBackup() {
    const payload = {
      app: 'sorentho-kasir',
      version: APP_VERSION,
      exportedAt: new Date().toISOString(),
      settings: state.settings,
      products: state.products,
      transactions: state.transactions,
      movements: state.movements,
    };
    download(`cadangan-sorentho-${dateStamp()}.json`, JSON.stringify(payload, null, 2), 'application/json');
  }

  /* ------------------------------------------------------------------------
     Pemasangan PWA
     ------------------------------------------------------------------------ */
  function isInstalled() {
    return window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  }

  function updateInstallUI() {
    const installed = isInstalled();
    $('installBtn').hidden = installed || !deferredInstall;
    $('installHint').textContent = installed
      ? 'Aplikasi ini sudah terpasang dan berjalan sebagai aplikasi.'
      : deferredInstall
        ? 'Pasang aplikasi agar bisa dibuka langsung dari layar utama.'
        : 'Di Chrome Android: buka menu ⋮ lalu pilih "Instal aplikasi" atau "Tambahkan ke layar utama".';
  }

  /* ------------------------------------------------------------------------
     UI: tab, sheet, modal, konfirmasi, toast
     ------------------------------------------------------------------------ */
  function switchTab(name) {
    ui.tab = name;
    document.body.classList.toggle('kasir-tab', name === 'kasir');
    document.querySelectorAll('.view').forEach((v) => v.classList.toggle('active', v.id === `view-${name}`));
    document.querySelectorAll('.tab').forEach((t) => {
      const active = t.dataset.tab === name;
      t.classList.toggle('active', active);
      if (active) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    $('sheetBar').hidden = name !== 'kasir';
    openSheet(false);
    if (name === 'pengaturan') fillSettingsForm();
    if (name === 'laporan') fillTargets();
    renderAll();
    window.scrollTo({ top: 0 });
  }

  function openSheet(open) {
    if (open) $('cart').scrollTop = 0;
    $('cart').classList.toggle('open', open);
    $('overlay').classList.toggle('open', open);
  }

  function openModal(id) {
    const el = $(id);
    el.classList.add('open');
    setTimeout(() => {
      const f = el.querySelector('input:not([type=file]), select, textarea');
      if (f) f.focus();
    }, 60);
  }

  function closeModal(id) {
    $(id).classList.remove('open');
  }

  const MODAL_IDS = ['productModal', 'restockModal', 'categoryModal', 'movementsModal', 'receiptModal', 'voidModal', 'qrisModal'];
  function closeAllModals() {
    MODAL_IDS.forEach(closeModal);
    settleConfirm(false);
  }

  function confirmDialog({ title, message, okText = 'Ya', danger = false }) {
    $('confirmTitle').textContent = title;
    $('confirmMsg').textContent = message;
    const ok = $('confirmOk');
    ok.textContent = okText;
    ok.className = danger ? 'danger' : 'primary';
    openModal('confirmModal');
    return new Promise((resolve) => { confirmResolve = resolve; });
  }

  function settleConfirm(value) {
    closeModal('confirmModal');
    if (confirmResolve) {
      confirmResolve(value);
      confirmResolve = null;
    }
  }

  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function updateClock() {
    $('clock').textContent = new Date().toLocaleString('id-ID', {
      weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
    });
  }

  /* ------------------------------------------------------------------------
     Event binding
     ------------------------------------------------------------------------ */
  function bindEvents() {
    document.addEventListener('click', (e) => {
      const button = e.target.closest('button');
      if (!button || button.disabled) return;
      button.classList.remove('is-pressed');
      void button.offsetWidth;
      button.classList.add('is-pressed');
      button.addEventListener('animationend', (event) => {
        if (event.animationName === 'button-press' || event.animationName === 'product-press') {
          button.classList.remove('is-pressed');
        }
      }, { once: true });
      setTimeout(() => button.classList.remove('is-pressed'), 300);
    }, true);

    document.querySelectorAll('.theme-toggle').forEach((button) =>
      button.addEventListener('click', toggleTheme));

    // Login
    on('loginForm', 'submit', onLogin);
    on('togglePass', 'click', () => {
      const p = $('loginPass');
      const show = p.type === 'password';
      p.type = show ? 'text' : 'password';
      $('togglePass').textContent = show ? 'Sembunyikan' : 'Lihat';
    });
    on('logoutBtn', 'click', logout);

    // Navigasi
    document.querySelectorAll('.tab').forEach((b) =>
      b.addEventListener('click', () => switchTab(b.dataset.tab)));

    // Kasir
    on('search', 'input', (e) => { ui.search = e.target.value; renderProducts(); });
    $('chips').addEventListener('click', (e) => {
      const b = e.target.closest('.chip');
      if (!b) return;
      if ('low' in b.dataset) {
        ui.lowOnly = !ui.lowOnly;
      } else {
        ui.category = b.dataset.cat;
        ui.lowOnly = false;
      }
      renderAll();
    });
    $('productGrid').addEventListener('click', (e) => {
      const b = e.target.closest('[data-add]');
      if (b && !b.disabled) addToCart(b.dataset.add);
    });
    $('cartList').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.inc) changeQty(b.dataset.inc, 1);
      else if (b.dataset.dec) changeQty(b.dataset.dec, -1);
      else if (b.dataset.rm) setQty(b.dataset.rm, 0);
    });
    on('clearCartBtn', 'click', clearCart);
    on('discount', 'input', renderSummary);
    on('discountType', 'change', renderSummary);
    on('paid', 'input', renderSummary);
    on('ref', 'input', renderSummary);
    $('methods').addEventListener('click', (e) => {
      const b = e.target.closest('[data-method]');
      if (!b) return;
      ui.method = b.dataset.method;
      if (ui.method !== 'tunai') $('paid').value = '';
      renderSummary();
    });
    $('quick').addEventListener('click', (e) => {
      const b = e.target.closest('[data-quick]');
      if (!b) return;
      $('paid').value = b.dataset.quick;
      renderSummary();
    });
    on('showQris', 'click', openQrisModal);
    on('checkoutBtn', 'click', checkout);
    on('openCart', 'click', () => openSheet(true));
    on('closeSheet', 'click', () => openSheet(false));
    on('overlay', 'click', () => openSheet(false));

    // Produk
    on('addProductBtn', 'click', () => openProductModal());
    on('manageSearch', 'input', (e) => { ui.manageSearch = e.target.value; renderManage(); });
    $('manageList').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      if (b.dataset.edit) openProductModal(b.dataset.edit);
      else if (b.dataset.restock) openRestock(b.dataset.restock);
      else if (b.dataset.moves) openMoves(b.dataset.moves);
      else if (b.dataset.toggle) toggleActive(b.dataset.toggle);
    });
    on('pType', 'change', syncTypeFields);
    on('pCancel', 'click', () => closeModal('productModal'));
    on('pSave', 'click', saveProduct);
    on('restockQty', 'input', updateRestockPreview);
    on('rCancel', 'click', () => closeModal('restockModal'));
    on('rSave', 'click', saveRestock);
    on('movClose', 'click', () => closeModal('movementsModal'));

    // Jenis produk
    on('addCatBtn', 'click', () => openCategoryModal());
    $('catList').addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b || b.disabled) return;
      if (b.dataset.catEdit) openCategoryModal(b.dataset.catEdit);
      else if (b.dataset.catDel) deleteCategory(b.dataset.catDel);
    });
    on('catSave', 'click', saveCategory);
    on('catCancel', 'click', () => closeModal('categoryModal'));

    // Laporan
    $('rangeSeg').addEventListener('click', (e) => {
      const b = e.target.closest('[data-range]');
      if (!b) return;
      reportRange = b.dataset.range;
      document.querySelectorAll('#rangeSeg button').forEach((x) => x.classList.toggle('active', x === b));
      renderChart();
    });
    on('saveTargets', 'click', saveTargets);
    on('useSuggest', 'click', useSuggestion);

    // Riwayat
    on('historySearch', 'input', (e) => { ui.historySearch = e.target.value; renderHistory(); });
    on('exportCsvBtn', 'click', exportCSV);
    $('historyList').addEventListener('click', (e) => {
      const b = e.target.closest('[data-view]');
      if (!b) return;
      const t = state.transactions.find((x) => x.id === b.dataset.view);
      if (t) showReceipt(t);
    });
    on('receiptClose', 'click', () => closeModal('receiptModal'));
    on('rPng', 'click', downloadReceiptPNG);
    on('rShare', 'click', shareReceipt);
    on('rPrint', 'click', printReceipt);
    on('rVoid', 'click', openVoid);
    on('voidCancel', 'click', () => closeModal('voidModal'));
    on('voidOk', 'click', confirmVoid);

    // QRIS
    on('qrisFile', 'change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      uploadQris(f);
    });
    on('qrisRemove', 'click', removeQris);
    on('logoFile', 'change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      uploadLogo(f);
    });
    on('logoRemove', 'click', removeLogo);
    on('qrisClose', 'click', () => closeModal('qrisModal'));

    // Pengaturan
    on('saveSettingsBtn', 'click', saveSettings);
    on('backupBtn', 'click', exportBackup);
    on('installBtn', 'click', async () => {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      await deferredInstall.userChoice;
      deferredInstall = null;
      updateInstallUI();
    });

    // Konfirmasi
    on('confirmOk', 'click', () => settleConfirm(true));
    on('confirmCancel', 'click', () => settleConfirm(false));

    // Klik di luar kotak = tutup
    document.querySelectorAll('.modalback').forEach((m) =>
      m.addEventListener('click', (e) => {
        if (e.target !== m) return;
        if (m.id === 'confirmModal') settleConfirm(false);
        else closeModal(m.id);
      }));

    // Escape: tutup lapisan teratas
    document.addEventListener('keydown', (e) => {
      if (e.key !== 'Escape') return;
      if ($('confirmModal').classList.contains('open')) return settleConfirm(false);
      const top = MODAL_IDS.find((id) => $(id).classList.contains('open'));
      if (top) return closeModal(top);
      openSheet(false);
    });

    // Pemasangan PWA
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      deferredInstall = e;
      updateInstallUI();
    });
    window.addEventListener('appinstalled', () => {
      deferredInstall = null;
      updateInstallUI();
      toast('Aplikasi berhasil dipasang');
    });
    window.addEventListener('afterprint', () => { $('print-area').innerHTML = ''; });
  }

  /* ------------------------------------------------------------------------
     Inisialisasi
     ------------------------------------------------------------------------ */
  async function init() {
    $('appVersion').textContent = APP_VERSION;
    applyTheme(loadTheme());
    bindEvents();
    updateClock();
    setInterval(updateClock, 30000);

    const config = window.SORENTHO_SUPABASE_CONFIG;
    if (!config?.url || !config?.anonKey) {
      supabaseSetupError = 'Supabase belum dikonfigurasi. Isi URL proyek dan publishable key di supabase-config.js.';
    } else if (!window.supabase?.createClient) {
      supabaseSetupError = 'Library Supabase gagal dimuat. Periksa koneksi internet lalu muat ulang halaman.';
    } else {
      try {
        supabaseClient = window.supabase.createClient(config.url, config.anonKey, {
          auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
        });
      } catch (err) {
        console.error('Konfigurasi Supabase tidak valid', err);
        supabaseSetupError = 'Konfigurasi Supabase tidak valid. Periksa URL proyek dan publishable key.';
      }
    }

    if (navigator.storage && navigator.storage.persist) {
      navigator.storage.persist().catch(() => {});
    }

    try {
      db = await openDB();
      await loadState();
      storageReady = true;
    } catch (err) {
      console.error(err);
      storageError = err.message.includes('tab lama')
        ? err.message
        : 'Penyimpanan kasir tidak dapat dibuka. Pastikan browser mengizinkan penyimpanan, lalu muat ulang aplikasi.';
    }
    applyLogo();

    let restored = false;
    let startupAuthError = '';
    if (storageReady && supabaseClient) {
      try {
        restored = await restoreSession();
      } catch (err) {
        console.error('Pemulihan sesi cloud gagal', err);
        startupAuthError = `Tidak dapat memuat sesi/data cloud: ${err.message}`;
      }
    }

    if (restored) {
      showApp();
      switchTab('kasir');
    } else {
      showLogin();
      if (!storageReady) {
        $('loginBtn').disabled = true;
        setLoginError(storageError);
      } else if (!supabaseClient) {
        $('loginBtn').disabled = true;
        setLoginError(supabaseSetupError);
      } else if (startupAuthError) {
        setLoginError(startupAuthError);
      }
    }
    setInterval(syncCloudChanges, 20000);
    updateInstallUI();

    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('sw.js').catch((err) => console.error('Service worker gagal', err));
    }
  }

  init();
})();
