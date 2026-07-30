import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import puppeteer from "puppeteer";

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
  { ticker: 'JURO11', url: 'https://www.sparta.com.br/sparta-fi-infra/' },
  { ticker: 'DIVS11', url: 'https://www.sparta.com.br/divs11/' },
  { ticker: 'CRAA11', url: 'https://www.sparta.com.br/craa11/' },
  { ticker: 'CDII11', url: 'https://www.sparta.com.br/sparta-cdii11/' }
];

async function extractCotaPatrimonialPuppeteer(ticker, url) {
  console.log(`\n🔍 [Puppeteer] Analisando ${ticker} em: ${url}`);
  
  let browser = null;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`   🌐 Navegando...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });

    // Espera extra de 5 segundos para garantir que o JavaScript renderizou a tabela
    await page.waitForTimeout(5000);

    const html = await page.content();
    console.log(`   📄 HTML recebido: ${html.length} caracteres`);

    // DEBUG: Mostra um trecho do HTML onde a palavra "cota" ou "patrimonial" aparece
    const lowerHtml = html.toLowerCase();
    const cotaIndex = lowerHtml.indexOf('cota');
    const patrIndex = lowerHtml.indexOf('patrimonial');
    
    if (cotaIndex !== -1) {
      console.log(`   🔍 Trecho do HTML com "cota": ...${html.substring(Math.max(0, cotaIndex - 40), cotaIndex + 120)}...`);
    } else if (patrIndex !== -1) {
      console.log(`   🔍 Trecho do HTML com "patrimonial": ...${html.substring(Math.max(0, patrIndex - 40), patrIndex + 120)}...`);
    } else {
      console.log(`   ⚠️ Palavras "cota" ou "patrimonial" NÃO encontradas no HTML renderizado.`);
    }

    // Regex mais agressivas para capturar o valor
    const regexes = [
      /Cota\s+Patrimonial[\s\S]{0,200}([0-9]{2,3}[.,][0-9]{2})/i,
      /Valor\s+Patrimonial[\s\S]{0,200}([0-9]{2,3}[.,][0-9]{2})/i,
      /Cota[\s\S]{0,100}R\$\s*([0-9]{2,3}[.,][0-9]{2})/i,
      /([0-9]{2,3}[.,][0-9]{2})\s*\(Cota/i
    ];

    for (const regex of regexes) {
      const match = html.match(regex);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(",", "."));
        if (!isNaN(val) && val > 0 && val < 500) { // Validação de sanidade (cota não pode ser 5000)
          console.log(`   ✅ SUCESSO: Cota encontrada = R$ ${val.toFixed(2)}`);
          return val;
        }
      }
    }

    console.log(`   ⚠️ Nenhuma Regex encontrou a Cota Patrimonial.`);
    return null;

  } catch (error) {
    console.error(`   ❌ Erro ao buscar ${ticker}:`, error.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

async function runAutoUpdate() {
  console.log("🤖 Iniciando Auto-Update de Fundamentos (Puppeteer Debug)...\n");
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;
  let updateCount = 0;

  for (const fund of FUNDS_CONFIG) {
    const docRef = doc(db, "fundamentals", fund.ticker);
    const docSnap = await getDoc(docRef);
    const currentData = docSnap.exists() ? docSnap.data() : {};
    const currentCota = currentData.vp || 0;

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
      console.log(`   🛡️ ${fund.ticker} MANTIDO em cache (R$ ${currentCota.toFixed(2)})`);
    }

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