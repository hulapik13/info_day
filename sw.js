const V='br-v40';
const SHELL=['./','./index.html','./app.js?v=40','./config.js?v=40','./vendor/leaflet.js','./vendor/leaflet.css','./icon-192.png','./icon-512.png'];
self.addEventListener('install',e=>{e.waitUntil(caches.open(V).then(c=>c.addAll(SHELL).catch(()=>{})).then(()=>self.skipWaiting()));});
self.addEventListener('activate',e=>{e.waitUntil(caches.keys().then(ks=>Promise.all(ks.filter(k=>k!==V).map(k=>caches.delete(k)))).then(()=>self.clients.claim()));});
self.addEventListener('fetch',e=>{
  const u=new URL(e.request.url);
  if(e.request.method!=='GET')return;
  if(u.origin!==location.origin)return; // тайлы/tomtom/yandex/firebase не трогаем
  // ВСЁ своё — сначала сеть (всегда свежее), кэш только как офлайн-запас
  e.respondWith(
    fetch(e.request).then(r=>{const cp=r.clone();caches.open(V).then(c=>c.put(e.request,cp));return r;})
      .catch(()=>caches.match(e.request).then(hit=>hit||caches.match('./index.html')))
  );
});
