import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import puppeteer from "puppeteer-core";

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
      executablePath: '/usr/bin/google-chrome-stable',
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
    });

    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    console.log(`   🌐 Navegando...`);
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 30000 });
    
    console.log(`   ⏳ Aguardando renderização do JavaScript...`);
    await new Promise(resolve => setTimeout(resolve, 5000));

    const html = await page.content();
    console.log(`   📄 HTML recebido: ${html.length} caracteres`);

    // Regex ultra-específicas para evitar falsos positivos como "Cotas negociadas"
    const regexes = [
      // 1. Procura por "Cota Patrimonial" ou "Valor Patrimonial" e o próximo número válido (10 a 200)
      /(?:Cota|Valor)\s+Patrimonial[\s\S]{0,300}?\b([0-9]{2,3}[.,][0-9]{2})\b/i,
      // 2. Fallback: procura apenas por "Patrimonial" e o próximo número válido
      /Patrimonial[\s\S]{0,300}?\b([0-9]{2,3}[.,][0-9]{2})\b/i,
      // 3. Fallback para formato com R$
      /Patrimonial[\s\S]{0,300}R\$\s*([0-9]{2,3}[.,][0-9]{2})/i
    ];

    for (const regex of regexes) {
      const match = html.match(regex);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(",", "."));
        // VALIDAÇÃO CRÍTICA: Cota de FII Sparta está entre 10 e 200. Ignora taxas (0.92) ou percentuais.
        if (!isNaN(val) && val > 10 && val < 200) {
          console.log(`   ✅ SUCESSO: Cota encontrada = R$ ${val.toFixed(2)}`);
          return val;
        } else {
          console.log(`   ⚠️ Regex encontrou ${val}, mas está fora da faixa válida (10-200). Ignorando.`);
        }
      }
    }

    console.log(`   ⚠️ Nenhuma Regex encontrou a Cota Patrimonial válida.`);
    return null;

  } catch (error) {
    console.error(`   ❌ Erro ao buscar ${ticker}:`, error.message);
    return null;
  } finally {
    if (browser) await browser.close();
  }
}

async function runAutoUpdate() {
  console.log("🤖 Iniciando Auto-Update de Fundamentos (Puppeteer Final)...\n");
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