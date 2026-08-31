import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
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
  { ticker: 'MXRF11', url: 'https://www.xpasset.com.br/fundos/maxi-renda/', type: 'manual' }
];

async function extractViaRegex(url, ticker) {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 8000);
    
    const response = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0" },
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

async function runUpdate() {
  console.log("🚀 Iniciando atualização...");
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;

  for (const fund of FUNDS_CONFIG) {
    console.log(`\n🔍 ${fund.ticker}...`);
    
    if (fund.type === 'manual') {
      console.log(`️ ${fund.ticker}: Atualização manual necessária. Pulando.`);
      console.log(` Baixe a planilha da XP Asset e atualize o Firestore manualmente.`);
      continue;
    }
    
    const docRef = doc(db, "fundamentals", fund.ticker);
    const docSnap = await getDoc(docRef);
    const currentData = docSnap.exists() ? docSnap.data() : {};

    const newCota = await extractViaRegex(fund.url, fund.ticker);

    if (newCota !== null && !isNaN(newCota)) {
      if (currentData.vp !== newCota) {
        await setDoc(docRef, {
          ...currentData,
          vp: newCota,
          updated: today,
          updatedAt: new Date()
        }, { merge: true });
        console.log(`✅ ${fund.ticker}: R$ ${newCota.toFixed(2)}`);
        successCount++;
      } else {
        console.log(`⏸️ ${fund.ticker}: inalterado (R$ ${newCota.toFixed(2)})`);
      }
    } else {
      console.log(`⚠️ ${fund.ticker}: Falha na extração.`);
    }
  }

  console.log(`\n Finalizado. ${successCount} fundos atualizados.`);
}

runUpdate().catch(err => {
  console.error("💥 Erro fatal:", err);
  process.exit(1);
});