#!/usr/bin/env node
/**
 * fetch_dy.js — Automação de DY via Fundamentus
 * Princípio: Atualiza apenas dados verificados. Sem fallbacks, sem poluição.
 */

import * as cheerio from 'cheerio';
import admin from 'firebase-admin';

const TICKERS = ['MXRF11', 'CRAA11', 'JURO11', 'DIVS11', 'CDII11'];
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
  
  console.log(`\n📡 Buscando dados verificados no Fundamentus...`);
  let atualizados = 0;

  try {
    const response = await fetch('https://fundamentus.com.br/fii_resultado.php', { headers: HEADERS });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    const $ = cheerio.load(html);

    $('table tbody tr').each((_, row) => {
      const cols = $(row).find('td');
      if (cols.length < 5) return;
      
      const ticker = $(cols[0]).text().trim().toUpperCase();
      if (!TICKERS.includes(ticker)) return;

      const preco = parseFloat($(cols[2]).text().trim().replace(',', '.'));
      const dyStr = $(cols[4]).text().trim().replace(',', '.').replace('%', '');
      const dy_ttm = parseFloat(dyStr);

      if (!isNaN(dy_ttm) && dy_ttm > 0) {
        const payload = {
          dy_ttm: dy_ttm,
          dy_preditivo: dy_ttm,
          dy_updated_at: admin.firestore.FieldValue.serverTimestamp(),
        };

        db.collection('fundamentals').doc(ticker).set(payload, { merge: true })
          .then(() => {
            console.log(`✅ [${ticker}] dy_ttm=${dy_ttm}% salvo.`);
            atualizados++;
          })
          .catch(err => {
            console.error(`❌ [${ticker}] Erro:`, err.message);
          });
      }
    });

    setTimeout(() => {
      console.log(`\n🏁 Concluído: ${atualizados} fundos atualizados.`);
      process.exit(0);
    }, 1500);

  } catch (err) {
    console.error(`\n❌ Erro fatal: ${err.message}`);
    process.exit(1);
  }
}

main();