/*
  Robô de Atualização de Fundamentos (Cota Patrimonial)
  Roda via GitHub Actions diariamente.
  Usa Puppeteer para baixar planilhas Excel e extrair VP.
*/
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import puppeteer from "puppeteer";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

// 1. Configuração do Firebase
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

// 2. Configuração dos Fundos
const FUNDS_CONFIG = [
  { 
    ticker: 'JURO11', 
    url: 'https://www.sparta.com.br/sparta-fi-infra/',
    type: 'regex'
  },
  { 
    ticker: 'DIVS11', 
    url: 'https://www.sparta.com.br/divs11/',
    type: 'regex'
  },
  { 
    ticker: 'CRAA11', 
    url: 'https://www.sparta.com.br/craa11/',
    type: 'regex'
  },
  { 
    ticker: 'CDII11', 
    url: 'https://www.sparta.com.br/sparta-cdii11/',
    type: 'regex'
  },
  { 
    ticker: 'MXRF11', 
    url: 'https://www.xpasset.com.br/fundos/maxi-renda/',
    type: 'excel',
    documentName: 'Planilha Fundamentos',
    sheetName: 'Rentabilidade',
    rowLabel: 'Valor patrimonial da cota'
  }
];

// 3. Função para extrair via Regex
async function extractViaRegex(url, ticker) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);
    
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
    console.error(`❌ Erro ao buscar ${ticker}:`, error.message);
    return null;
  }
}

// 4. Função para extrair via Excel (MXRF11) - OTIMIZADA
async function extractViaExcel(url, config) {
  let browser = null;
  try {
    console.log(`🌐 [${config.ticker}] Iniciando Puppeteer...`);
    
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox', 
        '--disable-setuid-sandbox', 
        '--disable-dev-shm-usage',
        '--disable-accelerated-2d-canvas',
        '--disable-gpu'
      ]
    });
    
    console.log(`🌐 [${config.ticker}] Navegador iniciado. Abrindo página...`);
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    // Timeout mais curto
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 15000 
    });
    
    console.log(` [${config.ticker}] Página carregada. Procurando documento...`);
    
    // Aguardar pouco tempo
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    // Encontrar o link do documento
    const link = await page.evaluate((docName) => {
      const links = Array.from(document.querySelectorAll('a'));
      const found = links.find(a => 
        a.textContent && a.textContent.toLowerCase().includes(docName.toLowerCase())
      );
      return found ? found.href : null;
    }, config.documentName);
    
    if (!link) {
      console.error(`❌ [${config.ticker}] Documento "${config.documentName}" não encontrado`);
      console.log(`💡 Dica: Verifique se o nome do documento mudou no site`);
      return null;
    }
    
    console.log(` [${config.ticker}] Link encontrado: ${link.substring(0, 80)}...`);
    
    // Tentar download
    console.log(`️ [${config.ticker}] Baixando arquivo...`);
    
    const responsePromise = page.waitForResponse(
      res => res.url().includes('.xlsx') || res.url().includes('.xls'),
      { timeout: 10000 }
    );
    
    await page.goto(link, { 
      waitUntil: 'networkidle0', 
      timeout: 15000 
    });
    
    let buffer;
    try {
      const response = await responsePromise;
      buffer = await response.buffer();
      console.log(`✅ [${config.ticker}] Arquivo baixado com sucesso`);
    } catch (e) {
      console.error(`❌ [${config.ticker}] Falha ao capturar buffer: ${e.message}`);
      console.log(`💡 Tentando método alternativo...`);
      
      // Método alternativo: navegar e pegar o conteúdo
      await page.goto(link, { timeout: 10000 });
      const bodyHandle = await page.$('body');
      buffer = await bodyHandle.evaluate(el => {
        // Isso não vai funcionar bem para binário, mas tentamos
        return null;
      });
      
      if (!buffer) {
        throw new Error('Não foi possível baixar o arquivo Excel');
      }
    }
    
    // Salvar temporariamente
    const tempFile = `/tmp/${config.ticker}_fundamentos_${Date.now()}.xlsx`;
    fs.writeFileSync(tempFile, buffer);
    console.log(` [${config.ticker}] Arquivo salvo em: ${tempFile}`);
    
    // Ler o Excel
    console.log(` [${config.ticker}] Lendo planilha "${config.sheetName}"...`);
    const workbook = XLSX.readFile(tempFile);
    
    if (!workbook.Sheets[config.sheetName]) {
      console.error(`❌ [${config.ticker}] Aba "${config.sheetName}" não encontrada`);
      console.log(`📋 Abas disponíveis:`, Object.keys(workbook.Sheets).join(', '));
      fs.unlinkSync(tempFile);
      return null;
    }
    
    const sheet = workbook.Sheets[config.sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    console.log(`📋 [${config.ticker}] Planilha tem ${data.length} linhas`);
    
    // Encontrar a linha do VP
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
      return null;
    }
    
    const vpValue = vpRow[lastColumnIndex];
    console.log(`📊 [${config.ticker}] VP bruto: ${vpValue} (coluna ${lastColumnIndex})`);
    
    // Converter para número
    let vpNumber;
    if (typeof vpValue === 'string') {
      vpNumber = parseFloat(vpValue.replace(',', '.'));
    } else {
      vpNumber = parseFloat(vpValue);
    }
    
    if (isNaN(vpNumber)) {
      console.error(`❌ [${config.ticker}] VP não é número válido: ${vpValue}`);
      fs.unlinkSync(tempFile);
      return null;
    }
    
    console.log(`✅ [${config.ticker}] VP convertido: ${vpNumber}`);
    
    // Limpar
    fs.unlinkSync(tempFile);
    await browser.close();
    
    return vpNumber;
    
  } catch (error) {
    console.error(`❌ [${config.ticker}] Erro crítico:`, error.message);
    if (browser) await browser.close();
    return null;
  }
}

// 5. Função Principal
async function runUpdate() {
  console.log("🚀 Iniciando atualização de fundamentos...");
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;

  for (const fund of FUNDS_CONFIG) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(` Processando ${fund.ticker}...`);
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
      console.log(`⚠️ ${fund.ticker}: Falha na extração. Mantendo ${currentData.vp || 'N/A'}`);
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`🏁 Processo finalizado. ${successCount}/${FUNDS_CONFIG.length} fundos atualizados.`);
  console.log(`${'='.repeat(60)}`);
}

runUpdate().catch(err => {
  console.error("💥 Erro fatal no script:", err);
  process.exit(1);
});