/*
  Robô de Atualização de Fundamentos (Cota Patrimonial)
  Usa Playwright com Firefox para baixar planilhas Excel de forma robusta via page.request.
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
  { ticker: 'JURO11', url: 'https://www.sparta.com.br/sparta-fi-infra/', type: 'regex' },
  { ticker: 'DIVS11', url: 'https://www.sparta.com.br/divs11/', type: 'regex' },
  { ticker: 'CRAA11', url: 'https://www.sparta.com.br/craa11/', type: 'regex' },
  { ticker: 'CDII11', url: 'https://www.sparta.com.br/sparta-cdii11/', type: 'regex' },
  { 
    ticker: 'MXRF11', 
    url: 'https://www.xpasset.com.br/fundos/maxi-renda/',
    type: 'excel',
    documentName: 'Planilha de Fundamentos',
    sheetName: 'Rentabilidade',
    rowLabel: 'Valor patrimonial da cota'
  }
];

async function extractViaRegex(url, ticker) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    const regex = /cota\s+patrimonial[\s\S]{0,150}r\$\s*([0-9]{2,3}[.,][0-9]{2})/i;
    const match = html.match(regex);
    
    if (match && match[1]) {
      return parseFloat(match[1].replace(",", "."));
    }
    return null;
  } catch (error) {
    console.error(`❌ ${ticker}:`, error.message);
    return null;
  }
}

async function extractViaExcel(url, config) {
  let browser = null;
  try {
    console.log(`🦊 [${config.ticker}] Iniciando Firefox via Playwright...`);
    
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
    
    console.log(`🌐 [${config.ticker}] Navegando para ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(resolve => setTimeout(resolve, 2000)); // Aguarda renderização
    
    console.log(`🔍 [${config.ticker}] Procurando documento: "${config.documentName}"...`);
    
    // 1. Encontrar o elemento do link
    const linkElement = await page.locator(`a:has-text("${config.documentName}")`).first();
    const count = await linkElement.count();
    
    if (count === 0) {
      console.error(`❌ [${config.ticker}] Link com texto "${config.documentName}" não encontrado.`);
      // Debug: listar alguns links para entender o que há na página
      const links = await page.locator('a').all();
      const linkTexts = await Promise.all(links.slice(0, 15).map(async l => await l.textContent()));
      console.log(`🔗 Links encontrados na página:`, linkTexts.filter(t => t.trim() !== ''));
      
      await context.close();
      await browser.close();
      return null;
    }

    // 2. Pegar o href do link
    const href = await linkElement.getAttribute('href');
    console.log(`🔗 [${config.ticker}] URL do documento encontrada: ${href}`);

    // 3. Usar o request do contexto do Playwright para baixar o arquivo (MUITO mais robusto)
    console.log(`⬇️ [${config.ticker}] Baixando arquivo via request...`);
    const response = await page.request.get(href, { timeout: 15000 });
    
    if (!response.ok()) {
      console.error(`❌ [${config.ticker}] Falha ao baixar: HTTP ${response.status()}`);
      await context.close();
      await browser.close();
      return null;
    }

    // 4. Salvar o buffer diretamente no arquivo
    const buffer = await response.body();
    const tempFile = `/tmp/${config.ticker}_fundamentos.xlsx`;
    fs.writeFileSync(tempFile, buffer);
    console.log(`✅ [${config.ticker}] Arquivo salvo em: ${tempFile} (${buffer.length} bytes)`);
    
    // 5. Ler o Excel
    console.log(`📖 [${config.ticker}] Lendo planilha "${config.sheetName}"...`);
    //const workbook = XLSX.readFile(tempFile);  PODE APAGAR
    // CORREÇÃO: Ler como buffer e usar XLSX.read()
    const fileBuffer = fs.readFileSync(tempFile);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    
    if (!workbook.Sheets[config.sheetName]) {
      console.error(`❌ [${config.ticker}] Aba "${config.sheetName}" não encontrada`);
      console.log(`📋 Abas disponíveis:`, Object.keys(workbook.Sheets).join(', '));
      fs.unlinkSync(tempFile);
      await context.close();
      await browser.close();
      return null;
    }
    
    const sheet = workbook.Sheets[config.sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`📋 [${config.ticker}] Planilha tem ${data.length} linhas`);
    
    // Encontrar linha do VP
    let vpRowIndex = -1;
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row && row[0] && row[0].toString().toLowerCase().includes(config.rowLabel.toLowerCase())) {
        vpRowIndex = i;
        console.log(`✅ [${config.ticker}] Linha do VP encontrada: índice ${i}`);
        break;
      }
    }
    
    if (vpRowIndex === -1) {
      console.error(`❌ [${config.ticker}] Rótulo "${config.rowLabel}" não encontrado`);
      fs.unlinkSync(tempFile);
      await context.close();
      await browser.close();
      return null;
    }
    
    // Pegar última coluna com valor
    const vpRow = data[vpRowIndex];
    let lastColumnIndex = -1;
    for (let j = vpRow.length - 1; j >= 1; j--) {
      if (vpRow[j] !== undefined && vpRow[j] !== null && vpRow[j] !== '') {
        lastColumnIndex = j;
        break;
      }
    }
    
    if (lastColumnIndex === -1) {
      console.error(`❌ [${config.ticker}] Nenhuma coluna com valor encontrada`);
      fs.unlinkSync(tempFile);
      await context.close();
      await browser.close();
      return null;
    }
    
    const vpValue = vpRow[lastColumnIndex];
    console.log(`📊 [${config.ticker}] VP bruto: ${vpValue} (coluna ${lastColumnIndex})`);
    
    // Converter para número
    let vpNumber = typeof vpValue === 'string' ? parseFloat(vpValue.replace(',', '.')) : parseFloat(vpValue);
    
    if (isNaN(vpNumber)) {
      console.error(`❌ [${config.ticker}] VP não é número válido: ${vpValue}`);
      fs.unlinkSync(tempFile);
      await context.close();
      await browser.close();
      return null;
    }
    
    console.log(`✅ [${config.ticker}] VP convertido: ${vpNumber}`);
    
    fs.unlinkSync(tempFile);
    await context.close();
    await browser.close();
    
    return vpNumber;
    
  } catch (error) {
    console.error(`❌ [${config.ticker}] Erro crítico:`, error.message);
    if (browser) await browser.close();
    return null;
  }
}

async function runUpdate() {
  console.log("🚀 Iniciando atualização de fundamentos...");
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;

  for (const fund of FUNDS_CONFIG) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`🔄 Processando ${fund.ticker}...`);
    console.log(`${'='.repeat(60)}`);
    
    const docRef = doc(db, "fundamentals", fund.ticker);
    const docSnap = await getDoc(docRef);
    const currentData = docSnap.exists() ? docSnap.data() : {};

    let newCota = null;
    
    if (fund.type === 'excel') {
      newCota = await extractViaExcel(fund.url, fund);
    } else {
      newCota = await extractViaRegex(fund.url, fund.ticker);
    }

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
  console.log(`🏁 Processo finalizado. ${successCount}/${FUNDS_CONFIG.length} fundos atualizados.`);
  console.log(`${'='.repeat(60)}`);
}

runUpdate().catch(err => {
  console.error("💥 Erro fatal:", err);
  process.exit(1);
});