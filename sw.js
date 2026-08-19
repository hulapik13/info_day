const V='br-v21';
const SHELL=['./','./index.html','./app.js?v=21','./config.js?v=21','./vendor/leaflet.js','./vendor/leaflet.css','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL).catch(()=>{})).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET')return;
  // внешние (тайлы, tomtom, yandex, firebase) — не трогаем
  if(u.origin!==location.origin)return;
  // live.json — сеть вперёд, кэш как запас
  if(u.pathname.endsWith('live.json')){
    e.respondWith(fetch(e.request).then(r=>{const cp=r.clone();caches.open(V).then(c=>c.put(e.request,cp));return r;}).catch(()=>caches.match(e.request)));
    return;
  }
  // оболочка — кэш вперёд, обновляем в фоне
  e.respondWith(caches.match(e.request).then(hit=>hit||fetch(e.request).then(r=>{const cp=r.clone();caches.open(V).then(c=>c.put(e.request,cp));return r;})));
});
