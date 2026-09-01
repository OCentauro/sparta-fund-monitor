/*
  Robô de Atualização de Fundamentos (Cota Patrimonial)
  v1.5.0 - Abordagem nativa do Playwright (Seletores DOM) + Correção de Timeout
*/
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { firefox } from "playwright";
import * as XLSX from "xlsx";
import fs from "fs";

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY,
  authDomain: process.env.FIREBASE_AUTH_DOMAIN,
  projectId: process.env.FIREBASE_PROJECT_ID,
  storageBucket: process.env.FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

const FUNDS_CONFIG = [
  { ticker: 'JURO11', url: 'https://www.sparta.com.br/sparta-fi-infra/', type: 'sparta' },
  { ticker: 'DIVS11', url: 'https://www.sparta.com.br/divs11/', type: 'sparta' },
  { ticker: 'CRAA11', url: 'https://www.sparta.com.br/craa11/', type: 'sparta' },
  { ticker: 'CDII11', url: 'https://www.sparta.com.br/sparta-cdii11/', type: 'sparta' },
  { 
    ticker: 'MXRF11', 
    url: 'https://www.xpasset.com.br/fundos/maxi-renda/',
    type: 'excel',
    documentName: 'Planilha de Fundamentos',
    sheetName: 'Rentabilidade',
    rowLabel: 'Valor patrimonial da cota'
  }
];

async function extractFundData(fund) {
  let browser = null;
  try {
    console.log(`🦊 [${fund.ticker}] Iniciando navegador...`);
    
    browser = await firefox.launch({ 
      headless: true,
      firefoxUserPrefs: {
        "browser.download.folderList": 2,
        "browser.download.dir": "/tmp",
        "browser.helperApps.neverAsk.saveToDisk": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
      }
    });
    
    const context = await browser.newContext({
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0'
    });
    
    const page = await context.newPage();
    
    if (fund.type === 'sparta') {
      console.log(`🌐 [${fund.ticker}] Navegando (timeout estendido para 60s)...`);
      
      // NOVIDADE: Tenta carregar a página com 60s. Se der timeout, tenta novamente em modo 'commit'
      try {
        await page.goto(fund.url, { waitUntil: 'domcontentloaded', timeout: 60000 });
      } catch (navError) {
        console.log(`⚠️ [${fund.ticker}] Primeira tentativa falhou (${navError.message.split('\n')[0]}). Tentando novamente em modo 'commit'...`);
        await page.goto(fund.url, { waitUntil: 'commit', timeout: 60000 });
        await new Promise(resolve => setTimeout(resolve, 5000)); // Dá tempo extra para o JS renderizar
      }
      
      console.log(`🔍 [${fund.ticker}] Aguardando a tabela renderizar...`);
      
      try {
        await page.waitForSelector('.column-cota-patrimonial', { timeout: 15000 });
        
        let element = page.locator('td.column-cota-patrimonial').first();

        if (await element.count() === 0) {
          console.log(`💡 [${fund.ticker}] Fallback: buscando o segundo elemento da classe...`);
          element = page.locator('.column-cota-patrimonial').nth(1);
        }
        
        const rawText = await element.innerText();
        console.log(`📝 [${fund.ticker}] Texto bruto extraído: "${rawText}"`);
        
        const cleanText = rawText.replace(/[^\d,]/g, '').replace(',', '.');
        const val = parseFloat(cleanText);
        
        if (!isNaN(val) && val >= 50) {
          console.log(`✅ [${fund.ticker}] Valor extraído com sucesso via seletor DOM: ${val}`);
          return val;
        } else {
          console.log(`⚠️ [${fund.ticker}] Valor inválido ou muito baixo (< 50): ${val}`);
        }
      } catch (selectorError) {
        console.log(`⚠️ [${fund.ticker}] Não foi possível encontrar o seletor. Erro: ${selectorError.message}`);
      }
      
      console.log(`⚠️ [${fund.ticker}] Falha na extração.`);
      return null;

    } else if (fund.type === 'excel') {
      console.log(`🌐 [${fund.ticker}] Navegando para buscar planilha...`);
      await page.goto(fund.url, { waitUntil: 'domcontentloaded', timeout: 30000 });
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const linkElement = await page.locator(`a:has-text("${fund.documentName}")`).first();
      if (await linkElement.count() === 0) {
        console.error(`❌ [${fund.ticker}] Link não encontrado.`);
        return null;
      }

      const href = await linkElement.getAttribute('href');
      console.log(`⬇️ [${fund.ticker}] Baixando...`);
      
      const response = await page.request.get(href, { timeout: 15000 });
      if (!response.ok()) {
        console.error(`❌ [${fund.ticker}] Falha no download: HTTP ${response.status()}`);
        return null;
      }

      const buffer = await response.body();
      const workbook = XLSX.read(buffer, { type: 'buffer' });
      if (!workbook.Sheets[fund.sheetName]) {
        console.error(`❌ [${fund.ticker}] Aba não encontrada.`);
        return null;
      }
      
      const data = XLSX.utils.sheet_to_json(workbook.Sheets[fund.sheetName], { header: 1 });
      let vpRowIndex = -1;
      let vpLabelColIndex = 0;
      
      for (let i = 0; i < data.length; i++) {
        const row = data[i];
        if (!row) continue;
        for (let col = 0; col < row.length; col++) {
          if (row[col] && row[col].toString().toLowerCase().includes(fund.rowLabel.toLowerCase())) {
            vpRowIndex = i;
            vpLabelColIndex = col;
            break;
          }
        }
        if (vpRowIndex !== -1) break;
      }
      
      if (vpRowIndex === -1) return null;
      
      const vpRow = data[vpRowIndex];
      let lastColIndex = -1;
      for (let j = vpRow.length - 1; j > vpLabelColIndex; j--) {
        if (vpRow[j] !== undefined && vpRow[j] !== null && vpRow[j] !== '' && vpRow[j] !== 0) {
          lastColIndex = j;
          break;
        }
      }
      
      if (lastColIndex === -1) return null;
      
      const vpValue = vpRow[lastColIndex];
      const vpNumber = typeof vpValue === 'string' ? parseFloat(vpValue.replace(',', '.')) : parseFloat(vpValue);
      
      if (isNaN(vpNumber)) return null;
      
      console.log(`✅ [${fund.ticker}] VP extraído: ${vpNumber}`);
      return vpNumber;
    }
    
  } catch (error) {
    console.error(`❌ [${fund.ticker}] Erro crítico:`, error.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

async function runUpdate() {
  console.log("🚀 Iniciando atualização v1.5.2...");
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;

  for (const fund of FUNDS_CONFIG) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 Processando ${fund.ticker}...`);
    console.log(`${'='.repeat(60)}`);
    
    const docRef = doc(db, "fundamentals", fund.ticker);
    const docSnap = await getDoc(docRef);
    const currentData = docSnap.exists() ? docSnap.data() : {};

    const newCota = await extractFundData(fund);

    if (newCota !== null && !isNaN(newCota)) {
      if (currentData.vp !== newCota) {
        await setDoc(docRef, {
          ...currentData,
          vp: newCota,
          updated: today,
          updatedAt: new Date()
        }, { merge: true });
        console.log(`✅ ${fund.ticker} ATUALIZADO: R$ ${newCota.toFixed(2)}`);
        successCount++;
      } else {
        console.log(`⏸️ ${fund.ticker} inalterado (R$ ${newCota.toFixed(2)})`);
      }
    } else {
      console.log(`⚠️ ${fund.ticker}: Falha na extração.`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏁 Finalizado. ${successCount}/${FUNDS_CONFIG.length} fundos atualizados.`);
  console.log(`${'='.repeat(60)}`);
}

runUpdate().catch(err => {
  console.error("💥 Erro fatal:", err);
  process.exit(1);
});