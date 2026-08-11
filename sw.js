const CACHE_NAME="sharoshi-v54-pdf-black-bold-masks";
const APP_FILES=[
  "./","./index.html","./style.css?v=54","./app.js?v=51","./pdf-debug.js?v=54",
  "./manifest.webmanifest?v=50","./questions-data.js?v=51",
  "./icon-180.png?v=50","./icon-512.png?v=50"
];
self.addEventListener("install",event=>{
  event.waitUntil(caches.open(CACHE_NAME).then(cache=>cache.addAll(APP_FILES)));
  self.skipWaiting();
});
self.addEventListener("activate",event=>{
  event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE_NAME).map(k=>caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener("fetch",event=>{
  if(event.request.method!=="GET")return;
  const url=new URL(event.request.url);
  if(url.origin!==self.location.origin)return;
  event.respondWith(
    fetch(event.request,{cache:"no-store"}).then(response=>{
      const copy=response.clone();
      caches.open(CACHE_NAME).then(cache=>cache.put(event.request,copy));
      return response;
    }).catch(()=>caches.match(event.request).then(r=>r||caches.match("./index.html")))
  );
});
