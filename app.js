// Remova a linha: const API_KEY = 'SEU_TOKEN_BRAPIDEV';
// Adicione no topo:
const API_KEY = window.BRAPIDEV_TOKEN || '';

const CONFIG = {
  API_KEY,
  FUNDS: ['SPRI11', 'SPTW11', 'SPFG11', 'SPIM11'],
  CACHE_TIME: 60 * 60 * 1000,
  BASE_URL: 'https://brapi.dev/api/quote'
};
// ... (resto do código permanece igual)