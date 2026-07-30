/*
  Auto-Update Fundamentals Script (Puppeteer Version)
  Usa Chrome Headless para renderizar SPAs e extrair dados
*/
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import puppeteer from "puppeteer";

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
  { ticker: 'JURO11', url: 'https://www.sparta.com.br/sparta-fi-infra/' },
  { ticker: 'DIVS11', url: 'https://www.sparta.com.br/divs11/' },
  { ticker: 'CRAA11', url: 'https://www.sparta.com.br/craa11/' },
  { ticker: 'CDII11', url: 'https://www.sparta.com.br/sparta-cdii11/' }
];

// 3. Função de Extração com Puppeteer
async function extractCotaPatrimonialPuppeteer(ticker, url) {
  console.log(`\n🔍 [Puppeteer] Analisando ${ticker} em: ${url}`);
  
  let browser = null;
  try {
    // Lança o Chrome headless
    browser = await puppeteer.launch({
      headless: true,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu',
        '--disable-extensions'
      ]
    });

    const page = await browser.newPage();
    
    // Configura User-Agent para parecer um navegador real
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`   🌐 Navegando até a página...`);
    await page.goto(url, { 
      waitUntil: 'networkidle2', // Espera até não haver requisições de rede por 500ms
      timeout: 30000 
    });

    // Aguarda um pouco mais para garantir que o conteúdo dinâmico carregou
    await page.waitForTimeout(3000);

    // Extrai o conteúdo da página
    const html = await page.content();
    console.log(`   📄 HTML recebido: ${html.length} caracteres`);

    // Tenta múltiplas estratégias de extração
    const regexes = [
      /Cota Patrimonial[\s\S]{0,150}\|\s*([0-9]{2,3}[.,][0-9]{2})/i,
      /Cota Patrimonial[\s\S]{0,150}([0-9]{2,3}[.,][0-9]{2})/i,
      /Valor Patrimonial[\s\S]{0,150}R?\$\s*([0-9]{2,3}[.,][0-9]{2})/i,
      /Cota de Fechamento[\s\S]{0,150}([0-9]{2,3}[.,][0-9]{2})/i,
      /Cota Patrimonial[\s\S]{0,100}R\$\s*([0-9]{2,3}[.,][0-9]{2})/i
    ];

    for (const regex of regexes) {
      const match = html.match(regex);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(",", "."));
        if (!isNaN(val) && val > 0) {
          console.log(`   ✅ SUCESSO: Cota encontrada via Regex = R$ ${val.toFixed(2)}`);
          return val;
        }
      }
    }

    // Estratégia alternativa: tentar extrair via seletores CSS comuns
    const selectors = [
      'table td',
      '.cota-patrimonial',
      '[data-testid="cota-patrimonial"]',
      '.valor-patrimonial'
    ];

    for (const selector of selectors) {
      const elements = await page.$$(selector);
      for (const element of elements) {
        const text = await element.evaluate(el => el.textContent);
        const match = text.match(/([0-9]{2,3}[.,][0-9]{2})/);
        if (match) {
          const val = parseFloat(match[1].replace(",", "."));
          if (val > 0 && val < 200) { // Validação básica
            console.log(`   ✅ SUCESSO: Cota encontrada via selector "${selector}" = R$ ${val.toFixed(2)}`);
            return val;
          }
        }
      }
    }

    console.log(`   ⚠️ Nenhuma estratégia encontrou a Cota Patrimonial`);
    return null;

  } catch (error) {
    console.error(`   ❌ Erro ao buscar ${ticker}:`, error.message);
    return null;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// 4. Função Principal
async function runAutoUpdate() {
  console.log(" Iniciando Auto-Update de Fundamentos (Puppeteer)...\n");
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;
  let updateCount = 0;

  for (const fund of FUNDS_CONFIG) {
    // Busca valor atual no Firestore
    const docRef = doc(db, "fundamentals", fund.ticker);
    const docSnap = await getDoc(docRef);
    const currentData = docSnap.exists() ? docSnap.data() : {};
    const currentCota = currentData.vp || 0;

    // Tenta extrair novo valor com Puppeteer
    const newCota = await extractCotaPatrimonialPuppeteer(fund.ticker, fund.url);

    if (newCota !== null && !isNaN(newCota)) {
      successCount++;
      if (currentCota !== newCota) {
        await setDoc(docRef, {
          ...currentData,
          vp: newCota,
          updated: today,
          updatedAt: new Date(),
          autoUpdated: true
        }, { merge: true });
        console.log(`   💾 ${fund.ticker} ATUALIZADO: R$ ${currentCota.toFixed(2)} → R$ ${newCota.toFixed(2)}`);
        updateCount++;
      } else {
        console.log(`   ⏸️ ${fund.ticker} inalterado (R$ ${newCota.toFixed(2)})`);
      }
    } else {
      console.log(`   ️ ${fund.ticker} MANTIDO em cache (R$ ${currentCota.toFixed(2)})`);
    }

    // Pausa entre fundos para não sobrecarregar
    await new Promise(resolve => setTimeout(resolve, 3000));
  }

  console.log("\n" + "=".repeat(60));
  console.log("🏁 Auto-Update Concluído!");
  console.log(`✅ Fundos analisados com sucesso: ${successCount}/${FUNDS_CONFIG.length}`);
  console.log(`📝 Fundos efetivamente atualizados no DB: ${updateCount}`);
  console.log("=".repeat(60));
}

runAutoUpdate().catch(err => {
  console.error("❌ Erro crítico no script:", err);
  process.exit(1);
});