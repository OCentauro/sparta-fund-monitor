#!/usr/bin/env node
/**
 * fetch_dy.js — Automação de DY (Dividend Yield) de FIIs via Status Invest
 *
 * Uso:  node fetch_dy.js
 *
 * Para cada ticker:
 *   1. GET https://statusinvest.com.br/fundos-imobiliarios/${TICKER}
 *   2. Extrai: DY 12m (dy_ttm), último provento (R$) e preço atual (R$)
 *   3. Calcula: dy_preditivo = (ultimo_provento * 12 / preco_atual) * 100
 *   4. Salva no Firestore: fundamentals/{ticker} com { merge: true }
 *
 * Auth do firebase-admin: use UMA das opções abaixo:
 *   a) export GOOGLE_APPLICATION_CREDENTIALS=/caminho/serviceAccountKey.json
 *   b) export FIREBASE_SERVICE_ACCOUNT='<conteúdo JSON da chave>'
 */

import * as cheerio from 'cheerio';
import admin from 'firebase-admin';

// ─── Configuração ────────────────────────────────────────────────────────────
const TICKERS = ['JURO11', 'DIVS11', 'CRAA11', 'CDII11', 'MXRF11'];
const BASE_URL = 'https://statusinvest.com.br/fundos-imobiliarios/';
const TIMEOUT_MS = 10_000; // 10s por requisição
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'sparta-fund-monitor';

const HEADERS = {
  'User-Agent':
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept':
    'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9,en;q=0.8',
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Converte "12,45 %" / "R$ 8,50" / "12.45" em number (NaN se falhar). */
function parseBR(texto) {
  if (!texto) return NaN;
  const limpo = texto.replace(/[^\d.,-]/g, '').trim();
  if (!limpo) return NaN;
  let n;
  if (limpo.includes(',')) {
    // formato brasileiro: remove pontos de milhar, vírgula → decimal
    n = parseFloat(limpo.replace(/\./g, '').replace(',', '.'));
  } else {
    n = parseFloat(limpo);
  }
  return Number.isFinite(n) ? n : NaN;
}

/** Busca um valor numérico na página a partir de um rótulo de coluna. */
function extrairValor($, labelRegex) {
  let valor = null;
  $('.column-label, .card-title, strong, span').each((_, el) => {
    const $el = $(el);
    const txt = $el.text().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    if (!labelRegex.test(txt)) return;
    // 1º tentativa: número dentro do próprio elemento
    let v = parseBR($el.text());
    if (!Number.isFinite(v)) {
      // 2º tentativa: elemento irmão / parente próximo (layout do Status Invest)
      const proximo =
        $el.next().first() ||
        $el.parent().children().last();
      v = parseBR(proximo.text());
    }
    if (!Number.isFinite(v)) {
      // 3º tentativa: texto completo do card pai
      v = parseBR($el.closest('.column-wrapper, .card, div').first().text());
    }
    if (Number.isFinite(v)) {
      valor = v;
      return false; // interrompe o .each()
    }
  });
  return valor;
}

/** Faz o GET com timeout de 10s e user-agent realista. */
async function fetchHtml(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: HEADERS,
      signal: controller.signal,
      redirect: 'follow',
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
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
      const url = `${BASE_URL}${ticker.toLowerCase()}`;
      console.log(`\n[${ticker}] GET ${url}`);
      const html = await fetchHtml(url);
      const $ = cheerio.load(html);

      // 1) DY 12 meses (TTM)
      const dyTtm = extrairValor($, /dividend\s*yield\s*\(?\s*12\s*(meses|m)/i);

      // 2) Último provento (valor em R$/cota)
      const ultimoProvento = extrairValor($, /ultimo\s*provento/i);

      // 3) Preço atual da cota
      const precoAtual = extrairValor($, /preco\s*atual/i);

      // Validação mínima: precisa ter ao menos o DY TTM
      if (!Number.isFinite(dyTtm)) {
        console.warn(`⚠️  [${ticker}] DY 12m não encontrado no HTML — pulando.`);
        pulados++;
        continue;
      }

      // 4) DY preditivo: (ultimo_provento * 12) / preco_atual * 100
      let dyPreditivo = null;
      if (
        Number.isFinite(ultimoProvento) &&
        Number.isFinite(precoAtual) &&
        precoAtual > 0
      ) {
        dyPreditivo = Math.round(((ultimoProvento * 12) / precoAtual) * 100 * 100) / 100;
      } else {
        console.warn(
          `⚠️  [${ticker}] provento/preço indisponíveis — salvando apenas dy_ttm.`
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
