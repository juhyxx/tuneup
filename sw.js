// Service worker: precache the whole app so it runs offline (same scheme as ../scalear).
// Locally (VERSION 'dev') the network wins so edits show up on reload; a deploy stamps VERSION.
const VERSION = 'dev';
const CACHE = 'tuneitup-' + VERSION;

const FILES = [
  './',
  'index.html',
  'manifest.webmanifest',
  'src/styles.css',
  'src/main.js',
  'src/pitch.js',
  'src/instruments.js',
  'src/i18n.js',
  'fonts/Silkscreen-Regular.woff2',
  'fonts/ScalearPixelCE.ttf',
  'logo.svg',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/apple-touch-icon.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES.map(f => new Request(f, { cache: 'reload' })))));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith('tuneitup-') && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('message', e => {
  if (e.data === 'skip-waiting') self.skipWaiting();
});

const DEV = VERSION === 'dev';
const cached = (req, options) => caches.open(CACHE).then(c => c.match(req, options));

function fromNetwork(req) {
  return fetch(req).then(res => {
    if (res.ok) {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
    }
    return res;
  });
}

const offline = req => cached(req, { ignoreSearch: true })
  .then(hit => hit || (req.mode === 'navigate' ? cached('index.html') : Response.error()));

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(DEV
    ? fromNetwork(req).catch(() => offline(req))
    : cached(req, { ignoreSearch: true }).then(hit => hit || fromNetwork(req).catch(() => offline(req))));
});
