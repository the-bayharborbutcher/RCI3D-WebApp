// ============================================
// RCI3D - Service Worker (PWA)
// ============================================

const CACHE_NAME = 'rci3d-v1.0.0';
const OFFLINE_URL = '/offline.html';

// Files to cache for offline use
const ASSETS_TO_CACHE = [
    '/',
    '/index.html',
    '/style.css',
    '/script.js',
    '/auth.js',
    '/firebase-config.js',
    '/manifest.json',
    '/rci3dstudio.jpeg',
    '/offline.html',
    '/icons/icon-192x192.png',
    '/icons/icon-512x512.png',
    // External CDN resources
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.0.0/css/all.min.css',
];

// ============================================
// INSTALL — Cache all assets
// ============================================
self.addEventListener('install', (event) => {
    console.log('[SW] Installing Service Worker v1.0.0...');

    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('[SW] Caching app shell...');
            // Cache local files (ignore CDN failures)
            const localAssets = ASSETS_TO_CACHE.filter(url => !url.startsWith('http'));
            return cache.addAll(localAssets).catch(err => {
                console.warn('[SW] Some files failed to cache:', err);
            });
        }).then(() => {
            console.log('[SW] Install complete');
            return self.skipWaiting();
        })
    );
});

// ============================================
// ACTIVATE — Clean old caches
// ============================================
self.addEventListener('activate', (event) => {
    console.log('[SW] Activating Service Worker...');

    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter(name => name !== CACHE_NAME)
                    .map(name => {
                        console.log('[SW] Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        }).then(() => {
            console.log('[SW] Activation complete');
            return self.clients.claim();
        })
    );
});

// ============================================
// FETCH — Network first, fallback to cache
// ============================================
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') return;

    // Skip Firebase API calls (always need network)
    if (url.hostname.includes('firebase') ||
        url.hostname.includes('googleapis') ||
        url.hostname.includes('gstatic')) {
        return;
    }

    // Skip OctoPrint API calls (always need network — ports 5000 ET 80 via Nginx)
    if (url.port === '5000') return;
    if (url.hostname === '10.29.43.197') return; // Pi direct — jamais cacher

    // For HTML pages — Network first, cache fallback
    if (request.headers.get('accept') && request.headers.get('accept').includes('text/html')) {
        event.respondWith(
            fetch(request)
                .then(response => {
                    // Cache the fresh response
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
                    return response;
                })
                .catch(() => {
                    // Offline — serve from cache or offline page
                    return caches.match(request)
                        .then(cached => cached || caches.match(OFFLINE_URL));
                })
        );
        return;
    }

    // For other assets (CSS, JS, images) — Cache first, network fallback
    event.respondWith(
        caches.match(request).then(cached => {
            if (cached) return cached;

            return fetch(request).then(response => {
                // Cache new resources
                if (response && response.status === 200) {
                    const responseClone = response.clone();
                    caches.open(CACHE_NAME).then(cache => cache.put(request, responseClone));
                }
                return response;
            }).catch(() => {
                console.warn('[SW] Failed to fetch:', request.url);
            });
        })
    );
});

// ============================================
// PUSH NOTIFICATIONS (future use)
// ============================================
self.addEventListener('push', (event) => {
    if (!event.data) return;

    const data = event.data.json();
    const options = {
        body: data.body || 'Print notification',
        icon: '/icons/icon-192x192.png',
        badge: '/icons/icon-72x72.png',
        vibrate: [200, 100, 200],
        data: { url: data.url || '/' },
        actions: [
            { action: 'view',    title: 'View',   icon: '/icons/icon-72x72.png' },
            { action: 'dismiss', title: 'Dismiss' }
        ]
    };

    event.waitUntil(
        self.registration.showNotification(data.title || 'RCI3D', options)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    if (event.action === 'view' || !event.action) {
        event.waitUntil(clients.openWindow(event.notification.data.url));
    }
});

console.log('[SW] Service Worker script loaded');
