/* 
  Robô de Atualização de Fundamentos (Cota Patrimonial)
  Roda via GitHub Actions diariamente.
*/
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
// Usando o banco de dados padrão (default) para alinhar com seu app atual
const db = getFirestore(app); 

// 2. Definição dos Fundos e suas Hot Pages
const FUNDS_CONFIG = [
  { ticker: 'JURO11', url: 'https://www.sparta.com.br/sparta-fi-infra/' },
  { ticker: 'DIVS11', url: 'https://www.sparta.com.br/divs11/' },
  { ticker: 'CRAA11', url: 'https://www.sparta.com.br/craa11/' },
  { ticker: 'CDII11', url: 'https://www.sparta.com.br/sparta-cdii11/' },
  { ticker: 'MXRF11', url: 'https://www.xpasset.com.br/fundos/maxi-renda/' }
];

// 3. Função para extrair a Cota Patrimonial via Regex
async function extractCotaPatrimonial(url, ticker) {
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36" }
    });
    
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    
    const html = await response.text();
    
    // Regex robusta para encontrar "Cota Patrimonial R$ XX,XX"
    const regex = /cota\s+patrimonial[\s\S]{0,100}r\$\s*([0-9]{2,3}[.,][0-9]{2})/i;
    const match = html.match(regex);
    
    if (match && match[1]) {
      // Substitui vírgula por ponto para o Firestore
      return parseFloat(match[1].replace(",", "."));
    }
    
    // Fallback específico para MXRF11 (XP Asset às vezes muda o layout)
    if (ticker === 'MXRF11') {
      const regexXp = /valor\s+patrimonial[\s\S]{0,100}r\$\s*([0-9]{1,2}[.,][0-9]{2})/i;
      const matchXp = html.match(regexXp);
      if (matchXp && matchXp[1]) return parseFloat(matchXp[1].replace(",", "."));
    }

    return null;
  } catch (error) {
    console.error(`❌ Erro ao buscar ${ticker}:`, error.message);
    return null;
  }
}

// 4. Função Principal
async function runUpdate() {
  console.log(" Iniciando atualização de fundamentos...");
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;

  for (const fund of FUNDS_CONFIG) {
    console.log(`\n🔍 Analisando ${fund.ticker}...`);
    
    // Busca o valor atual no Firestore para não sobrescrever se falhar
    const docRef = doc(db, "fundamentals", fund.ticker);
    const docSnap = await getDoc(docRef);
    const currentData = docSnap.exists() ? docSnap.data() : {};

    const newCota = await extractCotaPatrimonial(fund.url, fund.ticker);

    if (newCota !== null && !isNaN(newCota)) {
      // Só atualiza se o valor mudou ou se é a primeira vez
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
      console.log(`⚠️ ${fund.ticker}: Não foi possível extrair o valor. Mantendo o anterior.`);
    }
  }

  console.log(`\n🏁 Processo finalizado. ${successCount} fundos atualizados.`);
}

runUpdate().catch(console.error);