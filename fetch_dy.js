#!/usr/bin/env node
/**
 * fetch_dy.js — Automação de DY de FIIs via Fundamentus
 * Fonte: https://fundamentus.com.br/fii_resultado.php
 */

const cheerio = require('cheerio');
const admin = require('firebase-admin');

const TICKERS = ['JURO11', 'DIVS11', 'CRAA11', 'CDII11', 'MXRF11'];
const URL_FUNDAMENTUS = 'https://fundamentus.com.br/fii_resultado.php';
const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'sparta-fund-monitor';

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
};

function initAdmin() {
  if (admin.apps.length) return;
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    admin.initializeApp({
      credential: admin.credential.applicationDefault(),
      projectId: PROJECT_ID,
    });
  } else {
    console.error("ERRO: Defina a variável GOOGLE_APPLICATION_CREDENTIALS");
    process.exit(1);
  }
}

async function main() {
  initAdmin();
  const db = admin.firestore();
  
  console.log(`\n📡 Buscando dados no Fundamentus...`);
  
  try {
    const response = await fetch(URL_FUNDAMENTUS, { headers: HEADERS });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const html = await response.text();
    const $ = cheerio.load(html);

    let atualizados = 0;

    $('table tbody tr').each((_, row) => {
      const cols = $(row).find('td');
      if (cols.length < 10) return;

      const ticker = $(cols[0]).text().trim().toUpperCase();
      
      if (!TICKERS.includes(ticker)) return;

      // Coluna 2: Cotação (Preço)
      const precoStr = $(cols[2]).text().trim().replace(',', '.');
      const preco = parseFloat(precoStr);

      // Coluna 9: Dividend Yield (já vem em %, ex: "11.69")
      const dyStr = $(cols[9]).text().trim().replace(',', '.');
      const dy_ttm = parseFloat(dyStr);

      if (isNaN(preco) || isNaN(dy_ttm)) {
        console.warn(`⚠️ [${ticker}] Dados numéricos inválidos. P: ${preco}, DY: ${dy_ttm}`);
        return;
      }

      // Usamos o DY TTM como base para o preditivo nesta fonte
      const dy_preditivo = dy_ttm; 

      const payload = {
        dy_ttm: dy_ttm,
        dy_preditivo: dy_preditivo,
        dy_updated_at: admin.firestore.FieldValue.serverTimestamp(),
      };

      db.collection('fundamentals').doc(ticker).set(payload, { merge: true })
        .then(() => {
          console.log(`✅ [${ticker}] dy_ttm=${dy_ttm}% | dy_preditivo=${dy_preditivo}% salvo.`);
          atualizados++;
        })
        .catch(err => {
          console.error(`❌ [${ticker}] Erro ao salvar:`, err.message);
        });
    });

    setTimeout(() => {
      console.log(`\n🏁 Concluído: ${atualizados} fundos atualizados.`);
      process.exit(0);
    }, 2000);

  } catch (err) {
    console.error(`\n❌ Erro fatal ao buscar dados: ${err.message}`);
    process.exit(1);
  }
}

main();