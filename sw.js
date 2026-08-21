// Dartloggen service worker — gjør appen tilgjengelig uten nett
// NB: nummeret her må følge APP_VERSION i index.html, som viser det på
// startskjermen. Bump begge to i samme endring.
const CACHE = "dartloggen-v35";
const FILES = ["./", "./index.html", "./lydtrening.html", "./voice.js", "./lydtest.html", "./glid.js", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-180.png"];

self.addEventListener("install", e => {
  e.waitUntil(
    caches.open(CACHE)
      // {cache:"reload"} hopper over nettleserens HTTP-cache. Uten dette kan en fersk
      // service worker rekke å lagre en utdatert index.html som ligger igjen der.
      .then(c => Promise.all(FILES.map(f =>
        fetch(f, { cache: "reload" }).then(r => { if (r.ok) return c.put(f, r); })
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  if (new URL(req.url).origin !== self.location.origin) return;

  const isHtml = req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html");

  if (isHtml) {
    // Selve appen: nett først, cache som reserve. Da slår en ny versjon gjennom med én
    // gang den er publisert, i stedet for å vente på at CACHE-navnet bumpes.
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put(req, copy));
          return res;
        })
        .catch(() => caches.match(req).then(hit => hit || caches.match("./index.html")))
    );
    return;
  }

  // Ikoner, manifest o.l. endrer seg sjelden: cache først, hent ved miss.
  e.respondWith(
    caches.match(req).then(hit =>
      hit ||
      fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy));
        return res;
      }).catch(() => caches.match("./index.html"))
    )
  );
});
