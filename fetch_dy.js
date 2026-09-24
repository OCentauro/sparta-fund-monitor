#!/usr/bin/env node
/**
 * fetch_dy.js — Automação de DY (Dividend Yield) de FIIs via Brapi API
 *
 * Uso:
 *   export BRAPI_TOKEN='seu-token'
 *   node fetch_dy.js
 *
 * Para cada ticker:
 *   1. GET https://brapi.dev/api/quote/${TICKER}?token=${BRAPI_TOKEN}
 *      → extrai regularMarketPrice (preço atual)
 *   2. GET https://brapi.dev/api/dividends/${TICKER}?token=${BRAPI_TOKEN}
 *      → filtra pagamentos dos últimos 12 meses e soma (soma_12m);
 *        pega o provento mais recente (ultimo_provento)
 *   3. Calcula:
 *        dy_ttm       = (soma_12m / preco) * 100
 *        dy_preditivo = (ultimo_provento * 12 / preco) * 100
 *   4. Salva no Firestore: fundamentals/{ticker} com { merge: true }
 *
 * Auth do firebase-admin: use UMA das opções abaixo:
 *   a) export GOOGLE_APPLICATION_CREDENTIALS=/caminho/serviceAccountKey.json
 *   b) export FIREBASE_SERVICE_ACCOUNT='<conteúdo JSON da chave>'
 */

import admin from 'firebase-admin';

// ─── Configuração ────────────────────────────────────────────────────────────
const TICKERS = ['JURO11', 'DIVS11', 'CRAA11', 'CDII11', 'MXRF11'];
const QUOTE_URL = 'https://brapi.dev/api/quote/';
const DIVIDENDS_URL = 'https://brapi.dev/api/dividends/';
const TIMEOUT_MS = 10_000; // 10s por requisição
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'sparta-fund-monitor';

const BRAPI_TOKEN = process.env.BRAPI_TOKEN;
if (!BRAPI_TOKEN) {
  console.error('❌ BRAPI_TOKEN não configurado. Defina a variável de ambiente antes de rodar.');
  console.error('   Ex.: export BRAPI_TOKEN="seu-token-aqui" && node fetch_dy.js');
  process.exit(1);
}

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'application/json',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Faz o GET com timeout de 10s e retorna o JSON parseado. */
async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

/** Garante que o valor é um número finito (ou NaN). */
function toNumber(v) {
  const n = typeof v === 'string' ? parseFloat(v.replace(',', '.')) : Number(v);
  return Number.isFinite(n) ? n : NaN;
}

/** Arredonda para 2 casas decimais. */
function round2(n) {
  return Math.round(n * 100) / 100;
}

/**
 * Normaliza a resposta do endpoint /dividends em uma lista ordenada
 * (mais recente primeiro) de objetos { date: Date, value: number }.
 * Aceita variações de formato da Brapi (results[], array puro,
 * campos dividend/dividendo/value, date/data/compositionDate).
 */
function normalizarDividendos(json) {
  let raw = [];
  if (Array.isArray(json?.results)) raw = json.results;
  else if (Array.isArray(json?.data)) raw = json.data;
  else if (Array.isArray(json)) raw = json;
  else if (json?.results && !Array.isArray(json.results)) raw = [json.results];

  const list = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;

    const dateRaw =
      item.date ?? item.data ?? item.compositionDate ??
      item.pay_date ?? item.paymentDate ?? null;
    const d = dateRaw ? new Date(dateRaw) : null;
    if (!d || Number.isNaN(d.getTime())) continue;

    const valueRaw =
      item.dividend ?? item.dividendo ?? item.value ??
      item.amount ?? item.provento ?? item.unitAmount ?? null;
    const v = toNumber(valueRaw);
    if (!Number.isFinite(v)) continue;

    list.push({ date: d, value: v });
  }

  // Mais recente primeiro
  list.sort((a, b) => b.date - a.date);
  return list;
}

// ─── Inicialização do Firebase Admin ────────────────────────────────────────
function initAdmin() {
  if (admin.apps.length) return;
  const inlineKey = process.env.FIREBASE_SERVICE_ACCOUNT;
  if (inlineKey) {
    admin.initializeApp({
      credential: admin.credential.cert(JSON.parse(inlineKey)),
      projectId: PROJECT_ID,
    });
  } else {
    // usa GOOGLE_APPLICATION_CREDENTIALS automaticamente
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT_ID,
    });
  }
}

// ─── Loop principal ──────────────────────────────────────────────────────────
async function main() {
  initAdmin();
  const db = admin.firestore();
  let ok = 0, pulados = 0;

  for (const ticker of TICKERS) {
    try {
      // 1) Preço atual via /quote
      console.log(`\n[${ticker}] GET ${QUOTE_URL}${ticker}?token=***`);
      const quoteJson = await fetchJson(`${QUOTE_URL}${ticker}?token=${BRAPI_TOKEN}`);
      const result = Array.isArray(quoteJson?.results) ? quoteJson.results[0] : null;
      const precoAtual = toNumber(result?.regularMarketPrice);

      if (!Number.isFinite(precoAtual) || precoAtual <= 0) {
        console.warn(`⚠️  [${ticker}] regularMarketPrice indisponível — pulando.`);
        pulados++;
        continue;
      }

      // 2) Histórico de proventos via /dividends
      console.log(`[${ticker}] GET ${DIVIDENDS_URL}${ticker}?token=***`);
      const divJson = await fetchJson(`${DIVIDENDS_URL}${ticker}?token=${BRAPI_TOKEN}`);
      const dividendos = normalizarDividendos(divJson);

      if (dividendos.length === 0) {
        console.warn(`⚠️  [${ticker}] nenhum provento retornado por /dividends — pulando.`);
        pulados++;
        continue;
      }

      // Filtra últimos 12 meses
      const corte = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const ultimos12m = dividendos.filter((d) => d.date >= corte);

      const soma12m = ultimos12m.reduce((acc, d) => acc + d.value, 0);
      const ultimoProvento = dividendos[0].value; // já ordenado (mais recente primeiro)

      // 3) Cálculos
      const dyTtm = round2((soma12m / precoAtual) * 100);

      let dyPreditivo = null;
      if (Number.isFinite(ultimoProvento)) {
        dyPreditivo = round2(((ultimoProvento * 12) / precoAtual) * 100);
      }

      // 4) Persistência
      const payload = {
        dy_ttm: dyTtm,
        dy_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (dyPreditivo !== null) payload.dy_preditivo = dyPreditivo;

      await db.collection('fundamentals').doc(ticker).set(payload, { merge: true });
      console.log(
        `✅ [${ticker}] dy_ttm=${dyTtm}% (${ultimos12m.length} proventos/12m) | ` +
        `dy_preditivo=${dyPreditivo ?? 'n/d'}% salvo.`
      );
      ok++;
    } catch (err) {
      // Erro em UM ticker não pode quebrar o loop
      console.warn(`⚠️  [${ticker}] erro (${err.message}) — pulando.`);
      pulados++;
    }
  }

  console.log(`\nConcluído: ${ok} atualizados, ${pulados} pulados.`);
  process.exit(pulados === TICKERS.length ? 1 : 0);
}

main().catch((err) => {
  console.error('Erro fatal:', err.message);
  process.exit(1);
});
