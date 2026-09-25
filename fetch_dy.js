#!/usr/bin/env node
/**
 * fetch_dy.js — Automação de DY 12m (TTM) e DY preditivo
 *
 * FONTES (dados oficiais, sem fallback manual):
 *   1) Sparta RI — JURO11, DIVS11, CDII11, CRAA11
 *      As páginas são WordPress + wpDataTables RENDERIZADAS NO SERVIDOR: basta
 *      fetch + cheerio para ler
 *        • Cota de Mercado / Cota Patrimonial / Última Distribuição
 *        • "Mês de referência | Data Pagamento | Distribuições (R$/Cota) [| Dividend Yield em 12m]"
 *   2) Fundamentus — MXRF11
 *      • fii_resultado.php → cotação + coluna "Dividend Yield" (conferência)
 *      • fii_proventos.php → histórico de rendimentos, para calcular o DY 12m
 *      Obs.: a coluna "Dividend Yield" do Fundamentus NÃO bate com a soma dos 12
 *      rendimentos ÷ cotação (MXRF11: 14,18% vs 13,29%), por isso o cálculo do
 *      histórico é a fonte primária e a divergência é registrada no log.
 *
 * DEFINIÇÕES
 *   dy_ttm       = "Dividend Yield em 12m" publicado pela gestora, quando a coluna existe;
 *                  senão Σ(12 últimas distribuições) ÷ cota de mercado × 100.
 *   dy_preditivo = run-rate da última distribuição anunciada:
 *                  última distribuição × 12 ÷ cota de mercado × 100.
 *
 * INTEGRIDADE: nada é estimado nem "chutado". Se a extração falhar, o ticker é
 * simplesmente ignorado (o app exibe "-") e o valor antigo no Firestore é preservado.
 *
 * USO
 *   node fetch_dy.js             → grava no Firestore (requer GOOGLE_APPLICATION_CREDENTIALS)
 *   node fetch_dy.js --dry-run   → apenas imprime o resultado (não requer credencial)
 */
import * as cheerio from 'cheerio';
import admin from 'firebase-admin';
import { pathToFileURL } from 'node:url';

const PROJECT_ID = process.env.FIREBASE_PROJECT_ID || 'sparta-fund-monitor';
const DRY_RUN = process.argv.includes('--dry-run') || process.env.DRY_RUN === '1';

// Faixa plausível de DY (%) — evita gravar lixo se o layout de algum site mudar
const DY_MIN = 0.5;
const DY_MAX = 40;

const HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'pt-BR,pt;q=0.9',
};

// Fundos da Sparta Asset — o site oficial publica cota + histórico de distribuições
const SPARTA_FUNDS = [
  { ticker: 'JURO11', url: 'https://www.sparta.com.br/sparta-fi-infra/' },
  { ticker: 'DIVS11', url: 'https://www.sparta.com.br/divs11/' },
  { ticker: 'CDII11', url: 'https://www.sparta.com.br/sparta-cdii11/' },
  { ticker: 'CRAA11', url: 'https://www.sparta.com.br/craa11/' },
];

// Fundos que só existem no Fundamentus (não estão no site da Sparta)
const FUNDAMENTUS = {
  url: 'https://fundamentus.com.br/fii_resultado.php',
  proventosUrl: 'https://fundamentus.com.br/fii_proventos.php?papel={TICKER}&tipo=1',
  dyColumn: 'Dividend Yield',
  priceColumn: 'Cotação',
  tickers: ['MXRF11'],
};

/** GET com headers de navegador. `encoding` cobre o iso-8859-1 do Fundamentus. */
async function fetchText(url, encoding = 'utf-8') {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`HTTP ${res.status} em ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  return buf.toString(encoding);
}

/** Converte "1.234,56" / "R$ 1,20" / "10,2%" em número. NaN se não for numérico. */
function parseNumber(raw) {
  if (raw == null) return NaN;
  const cleaned = String(raw).replace(/[^\d,.-]/g, '');
  if (!/\d/.test(cleaned)) return NaN;
  return parseFloat(cleaned.replace(/\./g, '').replace(',', '.'));
}

const isPlausibleDy = (v) => Number.isFinite(v) && v > DY_MIN && v < DY_MAX;
const round2 = (v) => Math.round(v * 100) / 100;

/**
 * Lê as tabelas wpDataTables pré-renderizadas no HTML do site da Sparta.
 * Estrutura: <input type="hidden" id="table_N_desc" value='{"tableWpId":67,"dataTableParams":{"columnDefs":[...]}}'>
 *            <tr id="table_<wpId>_row_<i>"><td>...</td></tr>
 */
function readWpDataTables($) {
  const tables = new Map();

  $('input[id$="_desc"]').each((_, el) => {
    const raw = $(el).attr('value');
    if (!raw) return;
    let cfg;
    try { cfg = JSON.parse(raw); } catch { return; }
    // O mesmo tableWpId aparece 2x (template desktop/mobile) — conta apenas uma vez
    if (!cfg?.tableWpId || tables.has(cfg.tableWpId)) return;
    const cols = (cfg.dataTableParams?.columnDefs || []).map((c) => c.name || '');
    tables.set(cfg.tableWpId, { wpId: cfg.tableWpId, cols, rows: [] });
  });

  $('tr[id^="table_"]').each((_, tr) => {
    const match = /^table_(\d+)_row_/.exec($(tr).attr('id') || '');
    const table = match && tables.get(Number(match[1]));
    if (!table) return;
    const cells = $(tr).find('td').map((__, td) => $(td).text().trim()).get();
    if (cells.length) table.rows.push(cells);
  });

  return [...tables.values()];
}

/** Extrai cota de mercado, cota patrimonial, última distribuição e histórico de 12 meses. */
function extractSparta(html) {
  const $ = cheerio.load(html);
  const tables = readWpDataTables($);

  const quote = tables.find((t) => t.cols.some((c) => /Cota Patrimonial/i.test(c)));
  const history = tables.find((t) => t.cols.some((c) => /Data Pagamento/i.test(c)));

  if (!quote?.rows.length) throw new Error('tabela de cotas não encontrada');

  const dataRow = quote.rows.find((r) => !r.some((c) => /^Ref/i.test(c)));
  if (!dataRow) throw new Error('linha de valores de cota não encontrada');

  const col = (cols, re) => cols.findIndex((c) => re.test(c));
  const cotaMercado = parseNumber(dataRow[col(quote.cols, /Cota de Mercado/i)]);
  const cotaPatrimonial = parseNumber(dataRow[col(quote.cols, /Cota Patrimonial/i)]);
  const ultimaDistribuicao = parseNumber(dataRow[col(quote.cols, /ltima Distribui/i)]);

  if (!(cotaMercado > 0)) throw new Error(`cota de mercado inválida (${cotaMercado})`);

  let soma12 = NaN;
  let dyPublicado = NaN;

  if (history?.rows.length) {
    const iValor = col(history.cols, /Distribui/i);
    const iDy = col(history.cols, /Dividend Yield/i);

    const valores = history.rows.map((r) => parseNumber(r[iValor])).filter(Number.isFinite);
    soma12 = round2(valores.slice(0, 12).reduce((a, b) => a + b, 0));

    if (iDy > -1) {
      dyPublicado = history.rows.map((r) => parseNumber(r[iDy])).find(Number.isFinite);
    }
  }

  return { cotaMercado, cotaPatrimonial, ultimaDistribuicao, soma12, dyPublicado };
}

/** Converte os dados do Sparta em { dy_ttm, dy_preditivo }, descartando valores implausíveis. */
function computeSpartaDy(data) {
  // DY 12m: prioriza o número publicado pela gestora; senão soma as 12 últimas distribuições
  const publicado = isPlausibleDy(data.dyPublicado) ? data.dyPublicado : NaN;
  const calculado = isPlausibleDy(data.soma12) && data.soma12 > 0
    ? round2((data.soma12 / data.cotaMercado) * 100)
    : NaN;

  const dyTtm = isPlausibleDy(publicado) ? round2(publicado) : calculado;
  const dyPreditivo = round2((data.ultimaDistribuicao * 12 / data.cotaMercado) * 100);

  return {
    dy_ttm: isPlausibleDy(dyTtm) ? dyTtm : NaN,
    dy_preditivo: isPlausibleDy(dyPreditivo) ? dyPreditivo : NaN,
    dy_ttm_origem: isPlausibleDy(publicado) ? 'gestora' : 'calculo_12m',
  };
}

/**
 * Lê a cotação e o DY publicado na tabela de FIIs do Fundamentus.
 * @returns {Map<string, {preco: number, dyPublicado: number}>}
 */
function readFundamentusTable(html, tickers) {
  const $ = cheerio.load(html);
  const headers = $('table thead th').map((_, th) => $(th).text().trim()).get();
  const colDy = headers.findIndex((h) => h.toLowerCase() === FUNDAMENTUS.dyColumn.toLowerCase());
  const colPreco = headers.findIndex((h) => h.toLowerCase() === FUNDAMENTUS.priceColumn.toLowerCase());

  if (colPreco < 1 || colDy < 1) {
    throw new Error(`colunas "${FUNDAMENTUS.priceColumn}"/"${FUNDAMENTUS.dyColumn}" não encontradas`);
  }

  const found = new Map();
  $('table tbody tr').each((_, row) => {
    const cells = $(row).find('td');
    if (cells.length <= colDy) return;

    const ticker = $(cells[0]).text().trim().toUpperCase();
    if (!tickers.includes(ticker)) return;

    found.set(ticker, {
      preco: parseNumber($(cells[colPreco]).text().trim()),
      dyPublicado: parseNumber($(cells[colDy]).text().trim()),
    });
  });

  return found;
}

/** Lê o histórico de proventos (Data | Tipo | Pagamento | Valor) e devolve os rendimentos, do mais recente ao mais antigo. */
function readFundamentusProventos(html) {
  const $ = cheerio.load(html);
  const valores = [];

  $('table tr').each((_, row) => {
    const cells = $(row).find('td').map((__, td) => $(td).text().trim()).get();
    if (cells.length !== 4) return;
    if (!/Rendimento/i.test(cells[1])) return; // ignora amortizações
    valores.push(parseNumber(cells[3]));
  });

  return valores.filter(Number.isFinite);
}

/** Coleta o DY dos fundos que só existem no Fundamentus. */
async function collectFundamentus() {
  const results = [];
  let table;

  try {
    table = readFundamentusTable(await fetchText(FUNDAMENTUS.url, 'latin1'), FUNDAMENTUS.tickers);
  } catch (err) {
    console.error(`⚠️  [fundamentus] ignorado: ${err.message}`);
    return results;
  }

  for (const [ticker, info] of table) {
    try {
      const url = FUNDAMENTUS.proventosUrl.replace('{TICKER}', ticker);
      const valores = readFundamentusProventos(await fetchText(url, 'latin1'));

      const soma12 = round2(valores.slice(0, 12).reduce((a, b) => a + b, 0));
      const dyCalculado = round2((soma12 / info.preco) * 100);
      const usaCalculado = soma12 > 0 && isPlausibleDy(dyCalculado);

      if (!usaCalculado && !isPlausibleDy(info.dyPublicado)) {
        throw new Error('sem DY confiável (nem histórico de proventos nem coluna Dividend Yield)');
      }

      if (usaCalculado && isPlausibleDy(info.dyPublicado) && Math.abs(dyCalculado - info.dyPublicado) > 0.5) {
        console.warn(`ℹ️  [${ticker}] coluna Fundamentus = ${info.dyPublicado}% | Σ12÷cotação = ${dyCalculado}% → usando o cálculo`);
      }

      const dyTtm = usaCalculado ? dyCalculado : round2(info.dyPublicado);
      const dyPreditivo = round2(((valores[0] ?? NaN) * 12 / info.preco) * 100);

      results.push({
        ticker,
        dy_ttm: dyTtm,
        dy_preditivo: isPlausibleDy(dyPreditivo) ? dyPreditivo : dyTtm,
        dy_source: 'fundamentus.com.br',
        dy_origem: usaCalculado ? 'proventos_12m' : 'coluna_dy',
        preco: info.preco,
        soma12,
      });
    } catch (err) {
      console.error(`⚠️  [${ticker}] ignorado: ${err.message}`);
    }
  }

  return results;
}

/** Coleta o DY de todos os fundos do site da Sparta. Falhas isoladas não abortam o lote. */
async function collectSparta() {
  const results = [];

  for (const fund of SPARTA_FUNDS) {
    try {
      const html = await fetchText(fund.url);
      const data = extractSparta(html);
      const dy = computeSpartaDy(data);

      if (!Number.isFinite(dy.dy_ttm) && !Number.isFinite(dy.dy_preditivo)) {
        throw new Error('DY fora da faixa plausível');
      }

      results.push({
        ticker: fund.ticker,
        dy_ttm: dy.dy_ttm,
        dy_preditivo: dy.dy_preditivo,
        dy_source: 'sparta.com.br',
        dy_origem: dy.dy_ttm_origem,
        cotaMercado: data.cotaMercado,
        soma12: data.soma12,
      });
    } catch (err) {
      console.error(`⚠️  [${fund.ticker}] ignorado: ${err.message}`);
    }
  }

  return results;
}

function initAdmin() {
  if (admin.apps.length) return;
  if (!process.env.GOOGLE_APPLICATION_CREDENTIALS) {
    console.error('❌ Defina a variável GOOGLE_APPLICATION_CREDENTIALS (ou use --dry-run)');
    process.exit(1);
  }
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
    projectId: PROJECT_ID,
  });
}

async function main() {
  console.log('📡 Coletando DY 12m e DY preditivo (Sparta RI + Fundamentus)...\n');

  const results = [...(await collectSparta()), ...(await collectFundamentus())];

  if (!results.length) {
    console.error('\n❌ Nenhum dado coletado. Nada foi gravado.');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('🧪 DRY-RUN — nada será gravado no Firestore:\n');
    console.table(results.map((r) => ({
      fundo: r.ticker,
      'DY 12m (%)': Number.isFinite(r.dy_ttm) ? r.dy_ttm : '-',
      'DY prev. (%)': Number.isFinite(r.dy_preditivo) ? r.dy_preditivo : '-',
      'cota merc.': r.cotaMercado ?? r.preco ?? '-',
      'Σ 12m (R$)': r.soma12 ?? '-',
      fonte: r.dy_source,
      origem: r.dy_origem ?? '-',
    })));
    return;
  }

  initAdmin();
  const db = admin.firestore();

  for (const r of results) {
    // Só grava os campos com valor válido — nunca sobrescreve um dado bom com null
    const payload = {
      dy_source: r.dy_source,
      dy_updated_at: admin.firestore.FieldValue.serverTimestamp(),
    };
    if (Number.isFinite(r.dy_ttm)) payload.dy_ttm = r.dy_ttm;
    if (Number.isFinite(r.dy_preditivo)) payload.dy_preditivo = r.dy_preditivo;

    try {
      await db.collection('fundamentals').doc(r.ticker).set(payload, { merge: true });
      console.log(`✅ [${r.ticker}] dy_ttm=${payload.dy_ttm ?? '-'}%  dy_preditivo=${payload.dy_preditivo ?? '-'}%  (${r.dy_source})`);
    } catch (err) {
      console.error(`❌ [${r.ticker}] erro ao gravar: ${err.message}`);
    }
  }

  console.log(`\n🏁 Concluído: ${results.length} fundos processados.`);
}

// Exportado para o test_sparta.js validar exatamente o mesmo parser usado em produção
export {
  fetchText, parseNumber, readWpDataTables, extractSparta, computeSpartaDy,
  readFundamentusTable, readFundamentusProventos, SPARTA_FUNDS, FUNDAMENTUS,
};

// Só executa o pipeline quando chamado direto (node fetch_dy.js), não quando importado
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
