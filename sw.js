const CACHE_NAME="sharoshi-v301-iphone";
const APP_FILES=["./","./index.html","./style.css","./app.js","./manifest.webmanifest","./questions-data.js","./icon-180.png","./icon-512.png","./data/manifest.json","./data/rouki_truefalse.json","./data/anei_truefalse.json","./data/rousai_truefalse.json","./data/koyou_truefalse.json","./data/choushu_truefalse.json","./data/rouichi_truefalse.json","./data/shaichi_truefalse.json","./data/kenpo_truefalse.json","./data/kounen_truefalse.json","./data/kokunen_truefalse.json","./data/selection_mock_2026.json"];
self.addEventListener("install",e=>{e.waitUntil(caches.open(CACHE_NAME).then(c=>c.addAll(APP_FILES)));self.skipWaiting();});
self.addEventListener("activate",e=>{e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));self.clients.claim();});
self.addEventListener("fetch",e=>{
  const u=new URL(e.request.url);
  if(u.pathname.endsWith(".json")){e.respondWith(fetch(e.request,{cache:"no-store"}).catch(()=>caches.match(e.request)));return;}
  e.respondWith(fetch(e.request).catch(()=>caches.match(e.request)));
});