/*
  Robô de Atualização de Fundamentos (Cota Patrimonial)
  v1.3.2 - Regex cirúrgica para HTML visível (ignora JSON config)
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
    console.log(` [${ticker}] Buscando via fetch...`);
    
    const response = await fetch(url, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      console.error(`❌ [${ticker}] Erro HTTP: ${response.status}`);
      return null;
    }

    const html = await response.text();

    // PATTERNS CORRIGIDOS:
    // 1. Procura o texto "Cota Patrimonial" entre tags HTML (ex: <h3>Cota Patrimonial</h3>)
    // Isso ignora o bloco JSON que tem "name":"Cota Patrimonial"
    const regexPatterns = [
      />Cota\s+Patrimonial<[\s\S]{0,150}?(\d{2,3}[.,]\d{2})/i,
      
      // 2. Fallback: Procura a classe CSS específica e pega o número dentro de 150 chars
      /class="[^"]*column-cota-patrimonial[^"]*"[\s\S]{0,150}?(\d{2,3}[.,]\d{2})/i,
      
      // 3. Fallback extremo: Procura "Cota Patrimonial" seguido de um número grande (90+)
      // para evitar pegar dividendos (que são números pequenos como 1,00)
      /Cota\s+Patrimonial[\s\S]{0,300}?(9\d[.,]\d{2}|1\d{2}[.,]\d{2})/i
    ];

    for (let i = 0; i < regexPatterns.length; i++) {
      const match = html.match(regexPatterns[i]);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(",", "."));
        // Validação de sanidade: Cota Patrimonial de FII geralmente é > 50
        if (val > 50) {
          console.log(`✅ [${ticker}] Pattern ${i+1} encontrou com sucesso: ${val}`);
          return val;
        } else {
          console.log(`️ [${ticker}] Pattern ${i+1} encontrou ${val}, mas parece baixo (dividendo?). Ignorando.`);
        }
      }
    }

    console.log(`⚠️ [${ticker}] Nenhum padrão válido encontrou o valor.`);
    return null;

  } catch (error) {
    console.error(`❌ [${ticker}] Exceção:`, error.message);
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
    
    console.log(` [${config.ticker}] Navegando para ${url}...`);
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 20000 });
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    console.log(`🔍 [${config.ticker}] Procurando documento: "${config.documentName}"...`);
    
    const linkElement = await page.locator(`a:has-text("${config.documentName}")`).first();
    const count = await linkElement.count();
    
    if (count === 0) {
      console.error(`❌ [${config.ticker}] Link não encontrado.`);
      await context.close();
      await browser.close();
      return null;
    }

    const href = await linkElement.getAttribute('href');
    console.log(`🔗 [${config.ticker}] URL: ${href}`);

    console.log(`⬇️ [${config.ticker}] Baixando...`);
    const response = await page.request.get(href, { timeout: 15000 });
    
    if (!response.ok()) {
      console.error(`❌ [${config.ticker}] Falha: HTTP ${response.status()}`);
      await context.close();
      await browser.close();
      return null;
    }

    const buffer = await response.body();
    const tempFile = `/tmp/${config.ticker}_fundamentos.xlsx`;
    fs.writeFileSync(tempFile, buffer);
    console.log(`✅ [${config.ticker}] Salvo: ${tempFile} (${buffer.length} bytes)`);
    
    console.log(`📖 [${config.ticker}] Lendo "${config.sheetName}"...`);
    const fileBuffer = fs.readFileSync(tempFile);
    const workbook = XLSX.read(fileBuffer, { type: 'buffer' });
    
    if (!workbook.Sheets[config.sheetName]) {
      console.error(` [${config.ticker}] Aba não encontrada`);
      fs.unlinkSync(tempFile);
      await context.close();
      await browser.close();
      return null;
    }
    
    const sheet = workbook.Sheets[config.sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    console.log(`📋 [${config.ticker}] ${data.length} linhas`);
    
    let vpRowIndex = -1;
    let vpLabelColumnIndex = 0;
    
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (!row) continue;
      
      for (let col = 0; col < row.length; col++) {
        if (row[col] && row[col].toString().toLowerCase().includes(config.rowLabel.toLowerCase())) {
          vpRowIndex = i;
          vpLabelColumnIndex = col;
          console.log(`✅ [${config.ticker}] VP: linha ${i}, coluna ${col}`);
          break;
        }
      }
      if (vpRowIndex !== -1) break;
    }
    
    if (vpRowIndex === -1) {
      console.error(` [${config.ticker}] Rótulo não encontrado`);
      fs.unlinkSync(tempFile);
      await context.close();
      await browser.close();
      return null;
    }
    
    const vpRow = data[vpRowIndex];
    let lastColumnIndex = -1;
    
    for (let j = vpRow.length - 1; j > vpLabelColumnIndex; j--) {
      if (vpRow[j] !== undefined && vpRow[j] !== null && vpRow[j] !== '' && vpRow[j] !== 0) {
        lastColumnIndex = j;
        break;
      }
    }
    
    if (lastColumnIndex === -1) {
      console.error(`❌ [${config.ticker}] Sem valor`);
      fs.unlinkSync(tempFile);
      await context.close();
      await browser.close();
      return null;
    }
    
    const vpValue = vpRow[lastColumnIndex];
    console.log(`📊 [${config.ticker}] VP bruto: ${vpValue}`);
    
    let vpNumber = typeof vpValue === 'string' ? parseFloat(vpValue.replace(',', '.')) : parseFloat(vpValue);
    
    if (isNaN(vpNumber)) {
      console.error(`❌ [${config.ticker}] VP inválido: ${vpValue}`);
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
    console.error(`❌ [${config.ticker}] Erro:`, error.message);
    if (browser) await browser.close();
    return null;
  }
}

async function runUpdate() {
  console.log("🚀 Iniciando atualização v1.3.2...");
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
  console.log(`🏁 Finalizado. ${successCount}/${FUNDS_CONFIG.length} fundos atualizados.`);
  console.log(`${'='.repeat(60)}`);
}

runUpdate().catch(err => {
  console.error("💥 Erro fatal:", err);
  process.exit(1);
});