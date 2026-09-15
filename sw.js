const CACHE_NAME = 'sparta-fund-monitor-v4';
const urlsToCache = [
  '/sparta-fund-monitor/',
  '/sparta-fund-monitor/index.html',
  '/sparta-fund-monitor/fundamentals.json'
];

// Instalação: cacheia arquivos essenciais
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
      .then(() => self.skipWaiting()) // Força ativação imediata
  );
});

// Ativação: limpa caches antigos
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            console.log('️ Removendo cache antigo:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    }).then(() => self.clients.claim()) // Assume controle imediato
  );
});

// Interceptação: estratégia network-first para HTML, cache-first para resto
self.addEventListener('fetch', event => {
  const requestUrl = new URL(event.request.url);
  
  // Para HTML e JSON: sempre tenta a rede primeiro
  if (requestUrl.pathname.endsWith('.html') || 
      requestUrl.pathname.endsWith('.json') ||
      requestUrl.pathname === '/' ||
      requestUrl.pathname === '/sparta-fund-monitor/') {
    
    event.respondWith(
      fetch(event.request)
        .then(response => {
          if (response.ok) {
            const responseClone = response.clone();
            caches.open(CACHE_NAME).then(cache => {
              cache.put(event.request, responseClone);
            });
          }
          return response;
        })
        .catch(() => caches.match(event.request))
    );
  } else {
    // Para outros recursos (CSS, JS, imagens): cache-first
    event.respondWith(
      caches.match(event.request)
        .then(response => response || fetch(event.request))
    );
  }
});