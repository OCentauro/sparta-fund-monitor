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
 *   2. Extrai do JSON: dividendYield (decimal → %), lastDividend, regularMarketPrice
 *   3. Calcula: dy_preditivo = (lastDividend * 12 / regularMarketPrice) * 100
 *   4. Salva no Firestore: fundamentals/{ticker} com { merge: true }
 *
 * Auth do firebase-admin: use UMA das opções abaixo:
 *   a) export GOOGLE_APPLICATION_CREDENTIALS=/caminho/serviceAccountKey.json
 *   b) export FIREBASE_SERVICE_ACCOUNT='<conteúdo JSON da chave>'
 */

import admin from 'firebase-admin';

// ─── Configuração ────────────────────────────────────────────────────────────
const TICKERS = ['JURO11', 'DIVS11', 'CRAA11', 'CDII11', 'MXRF11'];
const BASE_URL = 'https://brapi.dev/api/quote/';
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
      const url = `${BASE_URL}${ticker}?token=${BRAPI_TOKEN}`;
      console.log(`\n[${ticker}] GET ${BASE_URL}${ticker}?token=***`);
      const json = await fetchJson(url);

      const result = Array.isArray(json?.results) ? json.results[0] : null;
      if (!result) {
        console.warn(`⚠️  [${ticker}] resposta sem "results" — pulando.`);
        pulados++;
        continue;
      }

      // 1) DY TTM: Brapi retorna em decimal (ex: 0.1169) → converte para % (11.69)
      const dyDecimal = toNumber(result.dividendYield);
      const dyTtm = Number.isFinite(dyDecimal)
        ? Math.round(dyDecimal * 100 * 100) / 100
        : NaN;

      // 2) Último provento pago (R$/cota)
      const lastDividend = toNumber(result.lastDividend);

      // 3) Preço atual de mercado
      const precoAtual = toNumber(result.regularMarketPrice);

      if (!Number.isFinite(dyTtm)) {
        console.warn(`⚠️  [${ticker}] dividendYield indisponível na API — pulando.`);
        pulados++;
        continue;
      }

      // 4) DY preditivo: (lastDividend * 12) / regularMarketPrice * 100
      let dyPreditivo = null;
      if (Number.isFinite(lastDividend) && Number.isFinite(precoAtual) && precoAtual > 0) {
        dyPreditivo = Math.round(((lastDividend * 12) / precoAtual) * 100 * 100) / 100;
      } else {
        console.warn(
          `⚠️  [${ticker}] lastDividend/preço indisponíveis — salvando apenas dy_ttm.`
        );
      }

      const payload = {
        dy_ttm: dyTtm,
        dy_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      };
      if (dyPreditivo !== null) payload.dy_preditivo = dyPreditivo;

      await db.collection('fundamentals').doc(ticker).set(payload, { merge: true });
      console.log(
        `✅ [${ticker}] dy_ttm=${dyTtm}% | dy_preditivo=${dyPreditivo ?? 'n/d'}% salvo.`
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
