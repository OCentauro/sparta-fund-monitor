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
    type: 'regex' // Usa regex no HTML
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
    type: 'excel', // Usa download de Excel
    documentName: 'Planilha Fundamentos',
    sheetName: 'Rentabilidade',
    rowLabel: 'Valor patrimonial da cota'
  }
];

// 3. Função para extrair via Regex (fundos Sparta)
async function extractViaRegex(url, ticker) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    
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

// 4. Função para extrair via Excel (MXRF11)
async function extractViaExcel(url, config) {
  let browser;
  try {
    console.log(`🌐 Abrindo navegador para ${config.ticker}...`);
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36');
    
    // Acessar a página principal
    console.log(` Navegando para ${url}...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    // Aguardar um pouco para garantir que a página carregou completamente
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Encontrar o link do documento
    console.log(`🔍 Procurando documento: "${config.documentName}"...`);
    const link = await page.evaluate((docName) => {
      const links = Array.from(document.querySelectorAll('a'));
      const found = links.find(a => 
        a.textContent.toLowerCase().includes(docName.toLowerCase())
      );
      return found ? found.href : null;
    }, config.documentName);
    
    if (!link) {
      console.error(`❌ Documento "${config.documentName}" não encontrado na página`);
      return null;
    }
    
    console.log(` Link encontrado: ${link}`);
    
    // Baixar o arquivo Excel
    console.log(`⬇️ Baixando arquivo Excel...`);
    const response = await page.goto(link, { waitUntil: 'networkidle2', timeout: 30000 });
    
    if (!response.ok()) {
      throw new Error(`Falha ao baixar: HTTP ${response.status()}`);
    }
    
    const buffer = await response.buffer();
    const tempFile = path.join('/tmp', `${config.ticker}_fundamentos.xlsx`);
    fs.writeFileSync(tempFile, buffer);
    console.log(`✅ Arquivo baixado: ${tempFile}`);
    
    // Ler o Excel
    console.log(` Lendo planilha "${config.sheetName}"...`);
    const workbook = XLSX.readFile(tempFile);
    
    if (!workbook.Sheets[config.sheetName]) {
      throw new Error(`Aba "${config.sheetName}" não encontrada no Excel`);
    }
    
    const sheet = workbook.Sheets[config.sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    console.log(`📋 Planilha tem ${data.length} linhas`);
    
    // Encontrar a linha com o rótulo "Valor patrimonial da cota"
    let vpRowIndex = -1;
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      if (row && row[0] && row[0].toString().toLowerCase().includes(config.rowLabel.toLowerCase())) {
        vpRowIndex = i;
        console.log(`✅ Linha do VP encontrada: ${i} - "${row[0]}"`);
        break;
      }
    }
    
    if (vpRowIndex === -1) {
      throw new Error(`Linha "${config.rowLabel}" não encontrada na planilha`);
    }
    
    // Pegar a última coluna preenchida (mês mais recente)
    const vpRow = data[vpRowIndex];
    let lastColumnIndex = -1;
    
    for (let j = vpRow.length - 1; j >= 1; j--) {
      if (vpRow[j] !== undefined && vpRow[j] !== null && vpRow[j] !== '') {
        lastColumnIndex = j;
        break;
      }
    }
    
    if (lastColumnIndex === -1) {
      throw new Error('Nenhuma coluna com valor encontrada na linha do VP');
    }
    
    const vpValue = vpRow[lastColumnIndex];
    console.log(`📊 VP encontrado: ${vpValue} (coluna ${lastColumnIndex})`);
    
    // Converter para número (pode vir como string "9,23" ou número 9.23)
    let vpNumber;
    if (typeof vpValue === 'string') {
      vpNumber = parseFloat(vpValue.replace(',', '.'));
    } else {
      vpNumber = parseFloat(vpValue);
    }
    
    if (isNaN(vpNumber)) {
      throw new Error(`Valor do VP não é um número válido: ${vpValue}`);
    }
    
    console.log(`✅ VP convertido: ${vpNumber}`);
    
    // Limpar arquivo temporário
    fs.unlinkSync(tempFile);
    
    await browser.close();
    return vpNumber;
    
  } catch (error) {
    console.error(`❌ Erro ao processar Excel do ${config.ticker}:`, error.message);
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
    console.log(`\n🔍 Analisando ${fund.ticker}...`);
    
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
        console.log(`✅ ${fund.ticker} atualizado: R$ ${newCota.toFixed(2)}`);
        successCount++;
      } else {
        console.log(`⏸️ ${fund.ticker} inalterado (R$ ${newCota.toFixed(2)})`);
      }
    } else {
      console.log(`️ ${fund.ticker}: Não foi possível extrair o valor. Mantendo o anterior.`);
    }
  }

  console.log(`\n Processo finalizado. ${successCount} fundos atualizados.`);
}

runUpdate().catch(console.error);