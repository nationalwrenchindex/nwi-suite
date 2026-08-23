/* eslint-disable */
/**
 * NWI Suite service worker.
 *
 * Plain JS, served from /sw.js at root scope (src/middleware.ts deliberately
 * excludes sw.js from the auth matcher so it is returned untouched). There is no
 * build step for this file — do not add imports or TypeScript syntax.
 *
 * WHY THIS EXISTS
 * A driver doing a legally-required pre-trip inspection is standing inside a steel
 * warehouse or in a rural yard with no bars. The inspection still has to happen and
 * still has to be recorded. Three surfaces must survive a dead connection:
 *
 *   1. /inspect/<unitId>            driver pre-trip forms   (highest priority)
 *   2. /hd/work-orders?new=1        work order creation
 *   3. /hd/dot-inspections/new      DOT inspection forms
 *
 * Everything else gets the branded /offline page instead of the browser's dinosaur.
 *
 * BUMPING: change VERSION and every cache below is rebuilt on the next activate.
 */

const VERSION = 'v1';

const PRECACHE_CACHE = `nwi-precache-${VERSION}`; // app shell, never changes within a version
const PAGES_CACHE    = `nwi-pages-${VERSION}`;    // HTML for the offline-capable routes
const STATIC_CACHE   = `nwi-static-${VERSION}`;   // content-hashed immutable assets
const API_CACHE      = `nwi-api-${VERSION}`;      // /api/inspect/* only

const OWNED_CACHES = [PRECACHE_CACHE, PAGES_CACHE, STATIC_CACHE, API_CACHE];

/** How long a navigation waits for the network before falling back to cache. */
const NAV_TIMEOUT_MS = 4000;

/** Background Sync tag the pre-trip page registers. Keep in sync with the page. */
const PRETRIP_SYNC_TAG = 'nwi-pretrip-sync';

/**
 * The one asset the install refuses to go without. If /offline is not in the cache,
 * the entire point of this worker is gone, so a failure here should fail the install
 * and leave the previous worker (or no worker) in charge.
 */
const SHELL_ASSETS = ['/offline'];

/**
 * Icons and the manifest — precached BEST-EFFORT.
 *
 * /icon/<size> is generated on demand by src/app/icon/[size]/route.tsx (next/og),
 * and /manifest.webmanifest comes from src/app/manifest.ts. Both are rendered, not
 * files on disk, so either can be slow or transiently fail. Warming them is nice —
 * the installed-PWA splash screen then works offline — but it is never worth
 * aborting the install over, hence allSettled rather than addAll.
 */
const ICON_ASSETS = [
  '/manifest.webmanifest',
  '/icon/192',
  '/icon/512',
  '/apple-touch-icon.png',
  '/favicon.ico',
];

/**
 * The authenticated routes that must render offline.
 *
 * These are precached BEST-EFFORT into PAGES_CACHE, not into the shell cache:
 *  - they can legitimately fail (a logged-out user 302s to /hd/login), and a failed
 *    fetch here must not abort the whole install;
 *  - they are user-specific HTML, so they live in the cache that CLEAR_CACHES purges.
 *
 * SHARED-DEVICE CAVEAT: on a yard tablet that several drivers sign into, cached HTML
 * for user A could be shown to user B if B is offline. Navigations are network-first
 * precisely so this only happens with no connection at all, and the app should post
 * { type: 'CLEAR_CACHES' } to the SW on sign-out to purge PAGES_CACHE and API_CACHE.
 *
 * /inspect/<unitId> is dynamic, so there is nothing to precache — it is cached at
 * runtime the first time the driver opens it (typically at the yard gate, with signal).
 */
const OFFLINE_ROUTES = [
  '/hd/work-orders?new=1',
  '/hd/dot-inspections/new',
];

/** Path prefixes whose navigation HTML we are willing to keep. */
const CACHEABLE_PAGE_PREFIXES = [
  '/inspect/',
  '/hd/work-orders',
  '/hd/dot-inspections/new',
];

// ───────────────────────────────────────────────────────────── helpers ──────

function isSupabaseRequest(url) {
  return url.hostname.endsWith('.supabase.co') || url.hostname.endsWith('.supabase.in');
}

/**
 * Auth traffic is NEVER cached. Storing a session response — or a page rendered
 * from one — and replaying it to the next request is a straightforward account
 * takeover on a shared device, not a performance nicety.
 */
function isAuthRequest(url) {
  return (
    url.pathname.startsWith('/api/auth') ||
    url.pathname.startsWith('/auth/') ||
    isSupabaseRequest(url)
  );
}

function isStaticAsset(url) {
  return (
    url.pathname.startsWith('/_next/static/') ||
    url.pathname.startsWith('/_next/image') ||
    url.pathname.startsWith('/icon/') ||
    url.pathname === '/manifest.webmanifest' ||
    url.pathname === '/site.webmanifest' ||
    /\.(?:js|css|png|jpg|jpeg|gif|svg|webp|ico|woff2?|ttf|otf)$/i.test(url.pathname)
  );
}

function isCacheablePage(url) {
  if (url.pathname === '/offline') return true;
  return CACHEABLE_PAGE_PREFIXES.some((p) => url.pathname.startsWith(p));
}

/**
 * Only store responses that are safe and legal to replay.
 * `redirected` matters: returning a redirected Response to a navigation from a
 * service worker throws a TypeError, so a cached /hd/login redirect would break the
 * page far more visibly than a cache miss.
 */
function isStorable(response) {
  return (
    !!response &&
    response.status === 200 &&
    response.type === 'basic' &&
    !response.redirected
  );
}

function fetchWithTimeout(request, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('sw-timeout')), ms);
    fetch(request).then(
      (res) => { clearTimeout(timer); resolve(res); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

// ───────────────────────────────────────────────────────────── install ──────

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const shell = await caches.open(PRECACHE_CACHE);
      await shell.addAll(SHELL_ASSETS);

      // Best-effort from here down: a rendered icon that 500s, or one 302-to-login,
      // must not sink the install and leave drivers with no offline page at all.
      await Promise.allSettled(
        ICON_ASSETS.map(async (asset) => {
          const res = await fetch(asset, { credentials: 'same-origin' });
          if (isStorable(res)) await shell.put(asset, res);
        }),
      );

      const pages = await caches.open(PAGES_CACHE);
      await Promise.allSettled(
        OFFLINE_ROUTES.map(async (route) => {
          const res = await fetch(route, { credentials: 'same-origin' });
          if (isStorable(res)) await pages.put(route, res);
        }),
      );

      // Take over immediately rather than waiting for every tab to close — an
      // offline fix that ships next week is not a fix.
      await self.skipWaiting();
    })(),
  );
});

// ──────────────────────────────────────────────────────────── activate ──────

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n.startsWith('nwi-') && !OWNED_CACHES.includes(n))
          .map((n) => caches.delete(n)),
      );
      await self.clients.claim();
    })(),
  );
});

// ─────────────────────────────────────────────────────────── strategies ─────

/**
 * NAVIGATIONS — network-first with a timeout, then cache, then /offline.
 *
 * Network-first (not cache-first) is a security decision, not a perf one. This is an
 * authenticated app: cache-first would hand whoever signs in next on a shared yard
 * tablet the previous driver's rendered page, complete with their fleet, units and
 * work orders. Going to the network first means the server re-authorises every
 * navigation whenever there is any signal at all, and the cache is only ever reached
 * when the alternative is a dead browser error page.
 *
 * Note this only covers real document loads. A <Link> click is an RSC fetch, not a
 * navigate, and is left to the network — offline it fails and Next falls back to a
 * hard navigation, which then arrives here and is served from cache. Slower, but it
 * lands on the right page instead of half-applying a router transition.
 */
async function handleNavigation(event, request) {
  const url = new URL(request.url);

  try {
    const response = await fetchWithTimeout(request, NAV_TIMEOUT_MS);
    if (isCacheablePage(url) && isStorable(response)) {
      const copy = response.clone();
      // waitUntil so the write is not killed when respondWith settles.
      event.waitUntil(caches.open(PAGES_CACHE).then((c) => c.put(request, copy)));
    }
    return response;
  } catch {
    // ignoreVary everywhere below: Next's App Router sets `Vary: RSC,
    // Next-Router-State-Tree, ...` on HTML responses. Cache matching honours Vary by
    // default, so a stored page can silently fail to match a request that differs in
    // headers the driver has no control over — a cache that looks full and behaves
    // empty. These entries are keyed by URL on purpose.

    // Exact URL (including query — /hd/work-orders?new=1 is a distinct page).
    const exact = await caches.match(request, { ignoreVary: true });
    if (exact) return exact;

    // Then the same path with any query: /hd/work-orders offline is better served
    // by the cached creation form than by a generic offline card.
    const loose = await caches.match(request, { ignoreSearch: true, ignoreVary: true });
    if (loose) return loose;

    const offline = await caches.match('/offline', { ignoreVary: true });
    if (offline) return offline;

    return new Response('Offline', {
      status: 503,
      headers: { 'Content-Type': 'text/plain' },
    });
  }
}

/** STATIC — cache-first. Everything here is content-hashed or versioned. */
async function handleStatic(event, request) {
  const cached = await caches.match(request);
  if (cached) return cached;

  const response = await fetch(request);
  if (isStorable(response)) {
    const copy = response.clone();
    event.waitUntil(caches.open(STATIC_CACHE).then((c) => c.put(request, copy)));
  }
  return response;
}

/**
 * /api/inspect/* — stale-while-revalidate.
 *
 * The only API surface allowed in a cache. The pre-trip form needs the unit and its
 * checklist to render, and a slightly stale checklist beats a form that cannot open.
 * Every other API GET is network-only: stale work orders, invoices or DOT records
 * would be read as current and acted on.
 */
async function handleInspectApi(event, request) {
  const cache = await caches.open(API_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (isStorable(response)) return cache.put(request, response.clone()).then(() => response);
      return response;
    })
    .catch(() => undefined);

  if (cached) {
    // Revalidate in the background; hand back the cached copy now. waitUntil keeps
    // the SW alive long enough for the refresh to land.
    event.waitUntil(network);
    return cached;
  }

  const fresh = await network;
  if (fresh) return fresh;

  return new Response(JSON.stringify({ error: 'offline' }), {
    status: 503,
    headers: { 'Content-Type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────────── fetch ──────

self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Writes are never cached and never intercepted. A queued pre-trip must not be
  // silently "answered" from a cache — the page owns its own retry queue, and the
  // failure is the signal that tells it to enqueue.
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch {
    return;
  }

  // Cross-origin (and Supabase in particular) goes straight to the network.
  if (url.origin !== self.location.origin) return;

  // Auth: never touched, never stored.
  if (isAuthRequest(url)) return;

  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(event, request));
    return;
  }

  if (isStaticAsset(url)) {
    event.respondWith(handleStatic(event, request));
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (url.pathname.startsWith('/api/inspect/') || url.pathname === '/api/inspect') {
      event.respondWith(handleInspectApi(event, request));
    }
    // Every other API GET: fall through to the network untouched.
    return;
  }

  // Anything else (RSC payloads, .txt flight data, etc.) — network, no cache.
});

// ────────────────────────────────────────────────────── background sync ─────

/**
 * THE CONSTRAINT THAT BREAKS NAIVE IMPLEMENTATIONS
 *
 * The pre-trip page keeps its pending-submission queue in localStorage. A service
 * worker runs on a worker thread and has NO access to localStorage — `localStorage`
 * is simply not defined in this scope. So the SW cannot read the queue, cannot
 * replay the POSTs, and cannot mark them sent.
 *
 * Any implementation that "drains the queue from the sync handler" therefore either
 * throws on the first line or, worse, resolves successfully having done nothing —
 * which consumes the sync registration and means the data never syncs, silently.
 *
 * What this SW does instead: it is a doorbell. On `sync` it wakes every window
 * client and tells it to flush its own queue, because the page CAN read
 * localStorage. If no window is open, we cannot flush — the page will flush on its
 * next load via its own `online` listener.
 *
 * (Moving the queue to IndexedDB would let the SW drain it without a page. That is
 * the right long-term fix; it is not this file's call to make.)
 */
async function askClientsToFlush() {
  const clientList = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true,
  });
  for (const client of clientList) {
    client.postMessage({ type: 'NWI_FLUSH_QUEUE', tag: PRETRIP_SYNC_TAG });
  }
  return clientList.length;
}

/**
 * Guarded because Background Sync does not exist at all in Safari — iOS included,
 * which is most of the tablets and phones in a yard. On those devices this listener
 * never runs, so the page's own `window.addEventListener('online', ...)` flush is
 * not a nice-to-have fallback, it is the primary sync mechanism. Background Sync is
 * the optional half, not the other way round.
 */
if ('sync' in self.registration) {
  self.addEventListener('sync', (event) => {
    if (event.tag !== PRETRIP_SYNC_TAG) return;
    event.waitUntil(askClientsToFlush());
  });
}

// ───────────────────────────────────────────────────────────── messages ─────

self.addEventListener('message', (event) => {
  const data = event.data;
  if (!data || typeof data.type !== 'string') return;

  if (data.type === 'FLUSH_QUEUE') {
    event.waitUntil(askClientsToFlush());
    return;
  }

  if (data.type === 'SKIP_WAITING') {
    self.skipWaiting();
    return;
  }

  // Sign-out hook: drop everything user-specific, keep the public shell and the
  // immutable static assets.
  if (data.type === 'CLEAR_CACHES') {
    event.waitUntil(
      Promise.all([caches.delete(PAGES_CACHE), caches.delete(API_CACHE)]),
    );
  }
});
