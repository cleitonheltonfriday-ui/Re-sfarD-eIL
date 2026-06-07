// Re:sfarDô:elL — Service Worker
// Intercepta imagens de mangá quando carregadas normalmente pelo browser
// e as armazena no cache para o site poder empacotar em ZIP

const CACHE_NAME = 'rsfardoell-imgs-v1';
const MANGA_PATTERNS = [
  /cdn\.mugiverso\.com/,
  /cdn\.mugi/,
  /\/\d{2}\.jpg/,
];

function isMangaImage(url) {
  return MANGA_PATTERNS.some(p => p.test(url));
}

self.addEventListener('install', e => {
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(clients.claim());
});

self.addEventListener('fetch', e => {
  const url = e.request.url;
  
  if (!isMangaImage(url)) return; // ignora requisições que não são imagens de mangá

  e.respondWith(
    caches.open(CACHE_NAME).then(async cache => {
      // Verifica se já está em cache
      const cached = await cache.match(e.request);
      if (cached) return cached;

      // Faz a requisição normal
      try {
        const response = await fetch(e.request);
        if (response.ok) {
          // Armazena uma cópia no cache
          cache.put(e.request, response.clone());
        }
        return response;
      } catch(err) {
        return new Response('', { status: 503 });
      }
    })
  );
});

// Mensagem do site pedindo as imagens cacheadas
self.addEventListener('message', async e => {
  if (e.data.type === 'GET_CACHED_IMAGES') {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const mangaKeys = keys.filter(req => isMangaImage(req.url));
    const payload = { type: 'CACHED_IMAGES_LIST', urls: mangaKeys.map(r => r.url) };
    // Responde pelo port do MessageChannel se disponível, senão via source
    if (e.ports && e.ports[0]) {
      e.ports[0].postMessage(payload);
    } else {
      e.source.postMessage(payload);
    }
  }

  if (e.data.type === 'FETCH_CACHED_BLOB') {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(e.data.url);
    if (response) {
      const blob = await response.blob();
      const ab = await blob.arrayBuffer();
      e.source.postMessage({
        type: 'BLOB_RESULT',
        url: e.data.url,
        buffer: ab,
        mime: blob.type || 'image/jpeg'
      }, [ab]); // transferable
    } else {
      e.source.postMessage({ type: 'BLOB_RESULT', url: e.data.url, buffer: null });
    }
  }

  if (e.data.type === 'CLEAR_CACHE') {
    await caches.delete(CACHE_NAME);
    const payload = { type: 'CACHE_CLEARED' };
    if (e.ports && e.ports[0]) e.ports[0].postMessage(payload);
    else e.source.postMessage(payload);
  }
});
