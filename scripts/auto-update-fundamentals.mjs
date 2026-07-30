import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";

// 1. Configuração do Firebase (Vem das Variáveis de Ambiente do GitHub)
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

// 2. Configuração dos Fundos e URLs
const FUNDS_CONFIG = [
  { ticker: 'JURO11', url: 'https://www.sparta.com.br/sparta-fi-infra/' },
  { ticker: 'DIVS11', url: 'https://www.sparta.com.br/divs11/' },
  { ticker: 'CRAA11', url: 'https://www.sparta.com.br/craa11/' },
  { ticker: 'CDII11', url: 'https://www.sparta.com.br/sparta-cdii11/' },
  { ticker: 'MXRF11', url: 'https://www.xpasset.com.br/fundos/maxi-renda/' }
];

// 3. Função de Extração com Fallback Seguro
async function extractCotaPatrimonial(ticker, url) {
  console.log(`\n🔍 Analisando ${ticker} em: ${url}`);
  
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      redirect: 'follow'
    });

    if (!response.ok) {
      console.log(`   ⚠️ Erro HTTP ${response.status}. Usando valor em cache.`);
      return null;
    }

    const html = await response.text();
    
    // Verificação rápida: se o HTML for muito pequeno, é provável que seja uma SPA vazia
    if (html.length < 5000) {
      console.log(`   ⚠️ HTML muito pequeno (${html.length} chars). Provável SPA. Usando valor em cache.`);
      return null;
    }

    // Múltiplos padrões de Regex para maximizar a chance de encontrar o valor
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

    console.log(`   ⚠️ Nenhuma Regex encontrou a Cota Patrimonial. Usando valor em cache.`);
    return null;

  } catch (error) {
    console.log(`   ❌ Erro de rede ao buscar ${ticker}: ${error.message}. Usando valor em cache.`);
    return null;
  }
}

// 4. Função Principal
async function runAutoUpdate() {
  console.log("🤖 Iniciando Auto-Update de Fundamentos...\n");
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;
  let updateCount = 0;

  for (const fund of FUNDS_CONFIG) {
    // Busca valor atual no Firestore
    const docRef = doc(db, "fundamentals", fund.ticker);
    const docSnap = await getDoc(docRef);
    const currentData = docSnap.exists() ? docSnap.data() : {};
    const currentCota = currentData.vp || 0;

    // Tenta extrair novo valor
    const newCota = await extractCotaPatrimonial(fund.ticker, fund.url);

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

    // Pausa de 2 segundos para não sobrecarregar o servidor de destino
    await new Promise(resolve => setTimeout(resolve, 2000));
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