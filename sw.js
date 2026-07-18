const C="dezhou-login-fix-v75";
const ASSETS=["./","./index.html","./styles.css?v=75","./app.js?v=75","./poker-judge.js?v=v35","./manifest.webmanifest?v=30"];
self.addEventListener("install",e=>{self.skipWaiting();e.waitUntil(caches.open(C).then(c=>c.addAll(ASSETS)))});
self.addEventListener("activate",e=>e.waitUntil(Promise.all([self.clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==C).map(k=>caches.delete(k))))])));
self.addEventListener("fetch",e=>{if(e.request.method!=="GET")return;e.respondWith(fetch(e.request,{cache:"no-store"}).then(r=>{const copy=r.clone();caches.open(C).then(c=>c.put(e.request,copy));return r}).catch(()=>caches.match(e.request).then(r=>r||caches.match("./index.html"))))});
