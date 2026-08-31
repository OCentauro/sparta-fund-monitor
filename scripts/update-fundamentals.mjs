/*
  Robô de Atualização de Fundamentos (Cota Patrimonial)
  Usa Puppeteer com Firefox para baixar planilhas Excel.
*/
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import puppeteer from "puppeteer";
import * as XLSX from "xlsx";
import fs from "fs";
import path from "path";

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
    console.log(` [${config.ticker}] Iniciando Firefox...`);
    
    browser = await puppeteer.launch({
      product: 'firefox', // ← USANDO FIREFOX!
      headless: true,
      args: ['--no-sandbox', '--disable-dev-shm-usage']
    });
    
    console.log(`🌐 [${config.ticker}] Navegador iniciado. Abrindo página...`);
    
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; rv:128.0) Gecko/20100101 Firefox/128.0');
    
    // Navegar para a página
    await page.goto(url, { 
      waitUntil: 'domcontentloaded', 
      timeout: 20000 
    });
    
    console.log(` [${config.ticker}] Página carregada. Procurando documento...`);
    await new Promise(resolve => setTimeout(resolve, 3000));
    
    // Encontrar o link
    const link = await page.evaluate((docName) => {
      const links = Array.from(document.querySelectorAll('a'));
      const found = links.find(a => 
        a.textContent && a.textContent.toLowerCase().includes(docName.toLowerCase())
      );
      return found ? found.href : null;
    }, config.documentName);
    
    if (!link) {
      console.error(`❌ [${config.ticker}] Documento "${config.documentName}" não encontrado`);
      return null;
    }
    
    console.log(` [${config.ticker}] Link encontrado`);
    
    // Configurar para aceitar downloads
    const downloadPath = '/tmp';
    await page._client().send('Page.setDownloadBehavior', {
      behavior: 'allow',
      downloadPath: downloadPath
    });
    
    // Clicar no link de download
    console.log(` [${config.ticker}] Iniciando download...`);
    await page.goto(link, { 
      waitUntil: 'networkidle0', 
      timeout: 15000 
    });
    
    await new Promise(resolve => setTimeout(resolve, 5000));
    
    // Procurar arquivo baixado
    const files = fs.readdirSync(downloadPath);
    const xlsxFile = files.find(f => f.endsWith('.xlsx') || f.endsWith('.xls'));
    
    if (!xlsxFile) {
      console.error(`❌ [${config.ticker}] Nenhum arquivo Excel encontrado no download`);
      console.log(` Arquivos em ${downloadPath}:`, files.join(', '));
      return null;
    }
    
    const tempFile = path.join(downloadPath, xlsxFile);
    console.log(`✅ [${config.ticker}] Arquivo baixado: ${xlsxFile}`);
    
    // Ler o Excel
    console.log(` [${config.ticker}] Lendo planilha...`);
    const workbook = XLSX.readFile(tempFile);
    
    if (!workbook.Sheets[config.sheetName]) {
      console.error(`❌ [${config.ticker}] Aba "${config.sheetName}" não encontrada`);
      console.log(`📋 Abas disponíveis:`, Object.keys(workbook.Sheets).join(', '));
      fs.unlinkSync(tempFile);
      return null;
    }
    
    const sheet = workbook.Sheets[config.sheetName];
    const data = XLSX.utils.sheet_to_json(sheet, { header: 1 });
    
    console.log(` [${config.ticker}] Planilha tem ${data.length} linhas`);
    
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
      console.error(`❌ [${config.ticker}] Rótulo "${config.rowLabel}" não encontrado`