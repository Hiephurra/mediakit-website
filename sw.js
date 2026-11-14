/* Gjør at appen åpner uten nett. Appfilene lagres på enheten; dataene ligger i localStorage/IndexedDB og røres ikke her. */
const VERSJON = 'v7';
const LAGER = 'husholdningsokonomi-' + VERSJON;
const XLSX = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
const FILER = ['./', 'index.html', 'style.css?v=7', 'app.js?v=7', 'manifest.webmanifest', 'ikon.svg', 'ikon-180.png', 'ikon-192.png', 'ikon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil((async () => {
    const c = await caches.open(LAGER);
    await c.addAll(FILER.map(f => new Request(f, { cache: 'reload' })));
    try { await c.add(new Request(XLSX, { mode: 'cors' })); } catch (err) { /* hentes ved første bruk i stedet */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('husholdningsokonomi-') && k !== LAGER) await caches.delete(k);
    await self.clients.claim();
  })());
});

// Nett først (så nye versjoner kommer med en gang), lagret kopi hvis nettet mangler eller er tregt.
async function nettForst(req, ventMs) {
  const c = await caches.open(LAGER);
  const lagret = await c.match(req, { ignoreSearch: req.mode === 'navigate' }) || (req.mode === 'navigate' ? await c.match('index.html') : undefined);
  const nett = fetch(req, { cache: 'no-cache' }).then(r => { if (r.ok) c.put(req, r.clone()); return r; });
  if (!lagret) return nett;
  nett.catch(() => { });
  return Promise.race([nett.catch(() => lagret), new Promise(ok => setTimeout(() => ok(lagret), ventMs))]);
}
async function lagerForst(req) {
  const c = await caches.open(LAGER);
  const lagret = await c.match(req);
  if (lagret) return lagret;
  const r = await fetch(req);
  if (r.ok) c.put(req, r.clone());
  return r;
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.href === XLSX) { e.respondWith(lagerForst(req)); return; }
  if (u.origin !== location.origin) return; // GitHub-synk og annet går rett på nett
  e.respondWith(nettForst(req, 2500));
});
