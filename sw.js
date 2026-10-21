// GitHub Pages sends every file with Cache-Control: max-age=600 and there's
// no way to change its headers, so for 10 minutes after a deploy the browser
// keeps serving the old page and modules - even on reload. This worker sits
// in front of every same-origin GET and asks the server first (cache:'no-cache'
// = a conditional request: an unchanged file comes back as a tiny 304, a
// changed one comes through new). The responses' max-age is swapped for
// no-cache too: otherwise Chrome's in-memory cache keeps handing the page the
// old modules on reload without ever asking this worker. Nothing is cached
// here; offline isn't a goal. Cross-origin requests (Firebase, Google Fonts)
// are left alone.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  // A navigation request can't be copied with new options, so the page itself
  // is fetched again by URL, and its response passed through as-is (a rebuilt
  // response would lose the URL it was redirected to, if any).
  if (req.mode === 'navigate') {
    event.respondWith(fetch(new Request(req.url, { cache: 'no-cache', credentials: 'same-origin' })));
    return;
  }
  event.respondWith(fetch(new Request(req, { cache: 'no-cache' })).then(res => {
    const headers = new Headers(res.headers);
    headers.set('Cache-Control', 'no-cache');
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
  }));
});
