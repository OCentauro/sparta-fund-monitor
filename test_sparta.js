/**
 * test_sparta.js — validação da extração de DY dos fundos Sparta
 *
 * Roda EXATAMENTE o mesmo parser do fetch_dy.js (importado, não duplicado) e imprime
 * todo o rastro da extração, sem gravar nada no Firestore.
 *
 * Uso:  node test_sparta.js [TICKER ...]
 *       node test_sparta.js JURO11
 *
 * Estrutura do site (WordPress + wpDataTables RENDERIZADO NO SERVIDOR):
 *   <input type="hidden" id="table_1_desc" value='{"tableWpId":67,"dataTableParams":{"columnDefs":[...]}}'/>
 *   <tr id="table_67_row_0" data-row-index="0"><td>93,97</td><td>97,30</td><td>1,20</td></tr>
 *   <tr id="table_67_row_1" data-row-index="1"><td>Ref.: 25/09/2026 12:38</td>...</tr>
 */
import * as cheerio from 'cheerio';
import {
  fetchText,
  readWpDataTables,
  extractSparta,
  computeSpartaDy,
  readFundamentusTable,
  readFundamentusProventos,
  SPARTA_FUNDS,
  FUNDAMENTUS,
} from './fetch_dy.js';

const only = process.argv.slice(2).map((t) => t.toUpperCase());
const targets = only.length ? SPARTA_FUNDS.filter((f) => only.includes(f.ticker)) : SPARTA_FUNDS;

const fmt = (v) => (Number.isFinite(v) ? v : '-');
const round2 = (v) => Math.round(v * 100) / 100;
let falhas = 0;

for (const fund of targets) {
  console.log(`\n${'='.repeat(74)}\n# ${fund.ticker} — ${fund.url}\n${'='.repeat(74)}`);

  try {
    const html = await fetchText(fund.url);

    // 1) Diagnóstico: mostra as tabelas que o parser enxerga (útil se o site mudar de layout)
    for (const t of readWpDataTables(cheerio.load(html))) {
      console.log(`  tabela wpId=${t.wpId} (${t.rows.length} linhas) cols=${JSON.stringify(t.cols)}`);
    }

    // 2) Extração — mesmas funções usadas em produção
    const data = extractSparta(html);
    const dy = computeSpartaDy(data);

    console.log(`  cota de mercado     : ${fmt(data.cotaMercado)}`);
    console.log(`  cota patrimonial    : ${fmt(data.cotaPatrimonial)}`);
    console.log(`  última distribuição : ${fmt(data.ultimaDistribuicao)}`);
    console.log(`  Σ 12 distribuições  : ${fmt(data.soma12)}`);
    console.log(`  DY 12m publicado    : ${fmt(data.dyPublicado)}`);
    console.log('  ---------------------------------------------');
    console.log(`  ✅ dy_ttm            : ${fmt(dy.dy_ttm)}%   (origem: ${dy.dy_ttm_origem})`);
    console.log(`  ✅ dy_preditivo      : ${fmt(dy.dy_preditivo)}%`);

    if (!Number.isFinite(dy.dy_ttm) && !Number.isFinite(dy.dy_preditivo)) {
      console.error('  ❌ Nenhum DY válido extraído');
      falhas++;
    }
  } catch (err) {
    console.error(`  ❌ ERRO: ${err.message}`);
    falhas++;
  }
}

// Fundamentus (MXRF11) — mesmo caminho do fetch_dy.js
if (!only.length || only.includes('MXRF11')) {
  console.log(`\n${'='.repeat(74)}\n# Fundamentus — ${FUNDAMENTUS.tickers.join(', ')}\n${'='.repeat(74)}`);
  try {
    const table = readFundamentusTable(await fetchText(FUNDAMENTUS.url, 'latin1'), FUNDAMENTUS.tickers);

    for (const [ticker, info] of table) {
      const url = FUNDAMENTUS.proventosUrl.replace('{TICKER}', ticker);
      const valores = readFundamentusProventos(await fetchText(url, 'latin1'));
      const soma12 = Math.round(valores.slice(0, 12).reduce((a, b) => a + b, 0) * 100) / 100;

      console.log(`  cotação Fundamentus  : ${fmt(info.preco)}`);
      console.log(`  DY coluna Fundamentus: ${fmt(info.dyPublicado)}%  (referência, não usada)`);
      console.log(`  últimos 12 rendimentos: ${JSON.stringify(valores.slice(0, 12))}`);
      console.log(`  Σ 12 rendimentos     : ${fmt(soma12)}`);
      console.log(`  ---------------------------------------------`);
      console.log(`  ✅ dy_ttm            : ${round2(soma12 / info.preco * 100)}%   (Σ12 ÷ cotação)`);
      console.log(`  ✅ dy_preditivo      : ${round2(valores[0] * 12 / info.preco * 100)}%`);
    }
  } catch (err) {
    console.error(`  ❌ ERRO: ${err.message}`);
    falhas++;
  }
}

console.log(falhas ? `\n🏁 FIM com ${falhas} falha(s).` : '\n🏁 FIM — todos os fundos extraídos com sucesso.');
process.exit(falhas ? 1 : 0);
