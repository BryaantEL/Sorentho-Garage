/* Sorentho Garage Kasir — service worker
 * Strategi: network-first dengan cadangan cache.
 * - Saat online: selalu ambil versi terbaru, lalu simpan ke cache.
 * - Saat offline: gunakan salinan dari cache.
 * Naikkan CACHE_VERSION setiap kali ada perubahan file agar cache lama dibersihkan.
 */
const CACHE_VERSION = 'sorentho-kasir-v2.2.2';

const APP_SHELL = [
  './',
  './index.html',
  './styles.css',
  './app.js',
  './supabase-config.js',
  './manifest.webmanifest',
  './assets/logo.png',
  './assets/icon-192.png',
  './assets/icon-512.png',
  './assets/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_VERSION)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_VERSION).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() =>
        caches.match(request, { ignoreSearch: true })
          .then((hit) => hit || (request.mode === 'navigate' ? caches.match('./index.html') : undefined))),
  );
});
