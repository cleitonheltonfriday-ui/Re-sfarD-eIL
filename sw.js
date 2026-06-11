// Re:sfarDô:elL — Service Worker v3
// Estratégia: intercepta <img> tags carregadas pelo browser.
// O browser carrega a imagem normalmente (sem CORS pois é uma navegação).
// O SW faz um segundo fetch independente com mode:'cors' para obter os bytes legíveis.
// CDNs de manga geralmente aceitam CORS de qualquer origin quando acessados diretamente.

const CACHE_NAME = 'rsfardoell-v3';
const PROXY = 'https://corsproxy.io/?';

function isMangaImage(url) {
  return (
    url.includes('cdn.mugiverso.com') ||
    url.includes('cdn.mugi') ||
    /\/\d{2,3}\.jpe?g/i.test(url)
  );
}

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(clients.claim()));

// Intercepta requests de imagens de mangá
self.addEventListener('fetch', e => {
  if (!isMangaImage(e.request.url)) return;

  const url = e.request.url;

  e.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);

    // Já temos bytes legíveis em cache?
    const cached = await cache.match(url);
    if (cached) return cached;

    // 1. Tenta fetch cors direto (dentro do SW, sem as restrições de "cross-origin-read-blocking" do browser principal)
    try {
      const res = await fetch(url, { mode: 'cors', credentials: 'omit' });
      if (res.ok) {
        cache.put(url, res.clone()); // armazena bytes legíveis
        return res;
      }
    } catch(e1) {}

    // 2. Tenta via proxy (bytes legíveis garantidos)
    try {
      const res = await fetch(PROXY + encodeURIComponent(url));
      if (res.ok) {
        // Recria response com a URL original para o cache.match funcionar
        const buf = await res.arrayBuffer();
        const proxiedRes = new Response(buf, {
          status: 200,
          headers: { 'Content-Type': 'image/jpeg', 'X-Via-Proxy': '1' }
        });
        cache.put(url, proxiedRes.clone());
        return proxiedRes;
      }
    } catch(e2) {}

    // 3. Último recurso: no-cors (bytes opacos — serve para exibir a imagem mas não para ler)
    try {
      const res = await fetch(url, { mode: 'no-cors', credentials: 'omit' });
      return res; // não cacheia pois não é legível
    } catch(e3) {}

    return new Response('', { status: 503 });
  })());
});

// ── Mensagens do site ────────────────────────────────────────────────────────

self.addEventListener('message', async e => {

  if (e.data.type === 'GET_CACHED_IMAGES') {
    const cache = await caches.open(CACHE_NAME);
    const keys = await cache.keys();
    const urls = keys.map(r => typeof r === 'string' ? r : r.url).filter(u => isMangaImage(u));
    const reply = { type: 'CACHED_IMAGES_LIST', urls };
    if (e.ports?.[0]) e.ports[0].postMessage(reply);
    else e.source.postMessage(reply);
  }

  if (e.data.type === 'FETCH_CACHED_BLOB') {
    const cache = await caches.open(CACHE_NAME);
    let response = await cache.match(e.data.url);

    // Se não está em cache, tenta buscar agora
    if (!response) {
      try {
        const r = await fetch(e.data.url, { mode: 'cors', credentials: 'omit' });
        if (r.ok) { cache.put(e.data.url, r.clone()); response = r; }
      } catch(_) {}
    }
    if (!response) {
      try {
        const r = await fetch(PROXY + encodeURIComponent(e.data.url));
        if (r.ok) { cache.put(e.data.url, r.clone()); response = r; }
      } catch(_) {}
    }

    if (response) {
      try {
        const blob = await response.blob();
        if (blob.size > 500) {
          const ab = await blob.arrayBuffer();
          e.source.postMessage(
            { type: 'BLOB_RESULT', url: e.data.url, buffer: ab, mime: 'image/jpeg' },
            [ab]
          );
          return;
        }
      } catch(_) {}
    }
    e.source.postMessage({ type: 'BLOB_RESULT', url: e.data.url, buffer: null });
  }

  if (e.data.type === 'CLEAR_CACHE') {
    await caches.delete(CACHE_NAME);
    const reply = { type: 'CACHE_CLEARED' };
    if (e.ports?.[0]) e.ports[0].postMessage(reply);
    else e.source.postMessage(reply);
  }

  // Força fetch imediato de uma lista de URLs (preload pedido pelo site)
  if (e.data.type === 'PREFETCH_URLS') {
    const cache = await caches.open(CACHE_NAME);
    const results = [];
    for (const url of (e.data.urls || [])) {
      let ok = false;
      if (!(await cache.match(url))) {
        try {
          const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
          if (r.ok) { cache.put(url, r.clone()); ok = true; }
        } catch(_) {}
        if (!ok) {
          try {
            const r = await fetch(PROXY + encodeURIComponent(url));
            if (r.ok) { cache.put(url, r.clone()); ok = true; }
          } catch(_) {}
        }
      } else { ok = true; }
      results.push({ url, ok });
    }
    e.source.postMessage({ type: 'PREFETCH_DONE', results });
  }

});
