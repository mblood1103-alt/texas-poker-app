const C="dezhou-v76";
const ASSETS=["./","./index.html?v=76","./styles.css?v=76","./app.js?v=76","./poker-judge.js?v=76","./manifest.webmanifest?v=76"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>Promise.allSettled(ASSETS.map(a=>c.add(a)))))});
self.addEventListener("activate",e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k))))])));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;const u=new URL(e.request.url);if(u.origin!==location.origin)return;e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{if(r&&r.ok){const copy=r.clone();caches.open(C).then(c=>c.put(e.request,copy)).catch(()=>{})}return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("./index.html?v=76"))))});
