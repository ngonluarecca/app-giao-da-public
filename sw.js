const CACHE_NAME = 'da-thaiha-pwa-v2.1.0';
const ASSETS_TO_CACHE = [
  './',
  './index.html',
  './manifest.json',
  './assets/logo.jpg',
  './assets/logo_banner.png',
  './css/main.css',
  './css/components.css',
  './css/responsive.css',
  './js/libs/xlsx.bundle.js',
  './js/libs/html2pdf.bundle.min.js',
  './js/bundle.min.js'
];

// 1. Cài đặt Service Worker và lưu bộ nhớ đệm
self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      console.log('[SW] Pre-caching offline assets v1.6.11');
      return cache.addAll(ASSETS_TO_CACHE).catch((err) => {
        console.warn('[SW] Caching warning:', err);
      });
    })
  );
});

// 2. Kích hoạt và dọn dẹp triệt để các cache phiên bản cũ
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            console.log('[SW] Xóa cache cũ:', key);
            return caches.delete(key);
          }
        })
      );
    })
  );
  self.clients.claim();
});

// 3. Xử lý yêu cầu Fetch: Network-First cho tài nguyên tĩnh để luôn cập nhật tức thì trên mobile
self.addEventListener('fetch', (event) => {
  const url = event.request.url;

  // TUYỆT ĐỐI KHÔNG CHẶN CÁC YÊU CẦU API VÀ DỊCH VỤ NGOÀI (Bỏ qua Service Worker hoàn toàn)
  if (
    event.request.method !== 'GET' ||
    url.includes('/api/') ||
    url.includes('script.google.com') ||
    url.includes('api.telegram.org') ||
    url.includes('accounts.google.com') ||
    url.includes('googleusercontent.com')
  ) {
    return;
  }

  // Network-First: Ưu tiên lấy bản mới nhất từ mạng, cập nhật cache ngầm; nếu mất mạng thì lấy từ cache
  event.respondWith(
    fetch(event.request)
      .then((networkResponse) => {
        if (networkResponse && networkResponse.status === 200) {
          const responseToCache = networkResponse.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseToCache));
        }
        return networkResponse;
      })
      .catch(() => {
        // Khi offline / không có mạng -> lấy từ cache
        return caches.match(event.request).then((cachedResponse) => {
          if (cachedResponse) return cachedResponse;
          if (event.request.mode === 'navigate' || event.request.headers.get('accept')?.includes('text/html')) {
            return caches.match('./index.html').then((htmlRes) => htmlRes || new Response('Offline', { status: 200, headers: { 'Content-Type': 'text/html' } }));
          }
          return new Response('', { status: 408, statusText: 'Offline' });
        });
      })
  );
});
