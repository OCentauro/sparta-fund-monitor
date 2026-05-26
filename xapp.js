const CONFIG = {
  API_KEY: 'SEU_TOKEN_BRAPIDEV', // 🔑 Troque pelo seu token da BrAPI
  FUNDS: ['SPRI11', 'SPTW11', 'SPFG11', 'SPIM11'],
  CACHE_TIME: 60 * 60 * 1000, // 1 hora
  BASE_URL: 'https://brapi.dev/api/quote'
};

const grid = document.getElementById('grid');
const refreshBtn = document.getElementById('refresh-btn');
const lastUpdateEl = document.getElementById('last-update');
const cacheKey = 'sparta_funds_cache';
const cacheTimeKey = 'sparta_funds_ts';

function formatNumber(val, decimals = 2, suffix = '') {
  if (val === null || val === undefined || isNaN(val)) return '-';
  return Number(val).toFixed(decimals) + suffix;
}

function createCard(data) {
  const { symbol, regularMarketPrice, pbRatio, priceToFFO, dividendYield, longName } = data;
  const googleUrl = `https://www.google.com/finance/quote/${symbol}:BVMF`;
  const tvUrl = `https://br.tradingview.com/symbols/BVMF-${symbol}/`;

  return `
    <div class="card">
      <div class="ticker">${symbol}</div>
      <div class="name">${longName || symbol}</div>
      <div class="metrics">
        <div class="metric"><span class="label">Preço</span><span class="value">R$ ${formatNumber(regularMarketPrice)}</span></div>
        <div class="metric"><span class="label">P/VP</span><span class="value">${formatNumber(pbRatio)}</span></div>
        <div class="metric"><span class="label">P/FFO</span><span class="value">${formatNumber(priceToFFO)}</span></div>
        <div class="metric"><span class="label">DY</span><span class="value">${formatNumber(dividendYield, 2)}%</span></div>
      </div>
      <div class="links">
        <a href="${googleUrl}" target="_blank" class="link">Google Finance</a>
        <a href="${tvUrl}" target="_blank" class="link">TradingView</a>
      </div>
      <div class="note">📊 P/FFO é o multiplicador padrão para FIIs. Valores < 10x indicam potencial de desconto relativo à geração de caixa.</div>
    </div>
  `;
}

function renderSkeleton() {
  grid.innerHTML = Array(CONFIG.FUNDS.length).fill('').map(() => `
    <div class="card">
      <div class="skeleton" style="width: 60%; height: 24px; margin-bottom: 8px;"></div>
      <div class="skeleton" style="width: 40%; height: 16px; margin-bottom: 16px;"></div>
      <div class="metrics">
        ${Array(4).fill('').map(() => `<div class="metric"><div class="skeleton" style="height: 14px;"></div></div>`).join('')}
      </div>    </div>
  `).join('');
}

async function fetchData(force = false) {
  const now = Date.now();
  const cached = localStorage.getItem(cacheKey);
  const cachedTs = localStorage.getItem(cacheTimeKey);

  if (!force && cached && cachedTs && (now - Number(cachedTs) < CONFIG.CACHE_TIME)) {
    renderData(JSON.parse(cached));
    lastUpdateEl.textContent = `Atualizado: ${new Date(Number(cachedTs)).toLocaleString('pt-BR')}`;
    return;
  }

  refreshBtn.disabled = true;
  refreshBtn.textContent = 'Atualizando...';
  renderSkeleton();

  try {
    const requests = CONFIG.FUNDS.map(ticker => 
      fetch(`${CONFIG.BASE_URL}/${ticker}?token=${CONFIG.API_KEY}`).then(r => r.json())
    );
    const results = await Promise.all(requests);
    const valid = results.filter(r => r.results?.length).map(r => r.results[0]);

    localStorage.setItem(cacheKey, JSON.stringify(valid));
    localStorage.setItem(cacheTimeKey, String(now));
    renderData(valid);
    lastUpdateEl.textContent = `Atualizado: ${new Date(now).toLocaleString('pt-BR')}`;
  } catch (err) {
    grid.innerHTML = `<div class="status">⚠️ Erro ao buscar dados.<br><small>${err.message}</small></div>`;
  } finally {
    refreshBtn.disabled = false;
    refreshBtn.textContent = 'Atualizar';
  }
}

function renderData(data) {
  if (!data.length) { 
    grid.innerHTML = `<div class="status">Nenhum dado retornado. Verifique os tickers.</div>`; 
    return; 
  }
  grid.innerHTML = data.map(createCard).join('');
}

document.getElementById('refresh-btn').addEventListener('click', () => fetchData(true));
setInterval(() => { 
  if (new Date().getHours() === 9 && new Date().getMinutes() === 0) fetchData(true); 
}, 60000);
document.addEventListener('DOMContentLoaded', fetchData);