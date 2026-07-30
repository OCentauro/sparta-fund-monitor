/*
  Auto-Update Fundamentals Script
  Baseado na lógica do server.ts do Gemini
  Roda via GitHub Actions diariamente
*/
import { initializeApp } from "firebase/app";
import { getFirestore, doc, setDoc, getDoc } from "firebase/firestore";
import { GoogleGenAI } from "@google/genai";

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

// 2. Inicializar Gemini (opcional - para fallback)
let ai = null;
if (process.env.GEMINI_API_KEY) {
  ai = new GoogleGenAI({
    apiKey: process.env.GEMINI_API_KEY,
    httpOptions: {
      headers: { 'User-Agent': 'Sparta-Fund-Monitor-Auto-Update' }
    }
  });
  console.log('✅ Gemini API inicializada');
} else {
  console.log('⚠️  GEMINI_API_KEY não configurada - usando apenas Regex');
}

// 3. Configuração dos Fundos (igual ao server.ts)
const HOT_PAGES = {
  "CDII11": "https://www.sparta.com.br/sparta-cdii11/",
  "JURO11": "https://www.sparta.com.br/sparta-fi-infra/",
  "DIVS11": "https://www.sparta.com.br/divs11/",
  "CRAA11": "https://www.sparta.com.br/craa11/",
  "MXRF11": "https://www.xpasset.com.br/fundos/maxi-renda/"
};

// 4. Função de Extração (mesma lógica do server.ts)
async function extractCotaPatrimonial(ticker, url, steps = []) {
  console.log(`\n🔍 Analisando ${ticker}...`);
  
  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
        "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
      },
      redirect: 'follow'
    });
    
    if (!response.ok) {
      console.log(`❌ Erro HTTP ${response.status} para ${ticker}`);
      return null;
    }
    
    const html = await response.text();
    console.log(`📄 HTML recebido: ${html.length} caracteres`);
    
    // PRIORIDADE 1: Regex (super rápido e robusto)
    const regexes = [
      /cota\s+patrimonial[\s\S]{0,100}r\$\s*([0-9]{2,3}[.,][0-9]{2})/i,
      /valor\s+patrimonial[\s\S]{0,100}r\$\s*([0-9]{2,3}[.,][0-9]{2})/i,
      /([0-9]{2,3}[.,][0-9]{2})\s*\(cota\s+patrimonial\)/i,
      /cota\s+patrimonial[^\d]*([0-9]{2,3}[.,][0-9]{2})/i
    ];
    
    for (const rx of regexes) {
      const match = html.match(rx);
      if (match && match[1]) {
        const val = parseFloat(match[1].replace(",", "."));
        if (!isNaN(val) && val > 0) {
          console.log(`✅ ${ticker}: R$ ${val.toFixed(2)} (via Regex)`);
          return val;
        }
      }
    }
    
    // PRIORIDADE 2: Gemini (fallback quando Regex falha)
    if (ai) {
      try {
        const cleanText = html
          .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
          .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .substring(0, 10000);
        
        const prompt = `Você é um robô de extração de dados financeiros.
Encontre o valor mais recente da "Cota Patrimonial" do fundo ${ticker}.
Retorne APENAS um objeto JSON: {"cota": 101.13}
Se não encontrar, retorne {"cota": null}.

CONTEÚDO:
${cleanText}`;
        
        const res = await ai.models.generateContent({
          model: "gemini-3.5-flash",
          contents: prompt,
          config: { responseMimeType: "application/json" }
        });
        
        const parsed = JSON.parse(res.text?.trim() || "{}");
        if (parsed.cota && typeof parsed.cota === "number" && parsed.cota > 0) {
          console.log(`✅ ${ticker}: R$ ${parsed.cota.toFixed(2)} (via Gemini)`);
          return parsed.cota;
        }
      } catch (err) {
        console.log(`⚠️  Gemini falhou para ${ticker}: ${err.message}`);
      }
    }
    
    console.log(`❌ ${ticker}: Não foi possível extrair`);
    return null;
    
  } catch (err) {
    console.log(`❌ Erro ao buscar ${ticker}: ${err.message}`);
    return null;
  }
}

// 5. Função Principal
async function runAutoUpdate() {
  console.log("🤖 Iniciando Auto-Update de Fundamentos...\n");
  console.log(`📅 Data: ${new Date().toISOString()}\n`);
  
  const today = new Date().toISOString().split('T')[0];
  let successCount = 0;
  let updateCount = 0;
  
  for (const [ticker, url] of Object.entries(HOT_PAGES)) {
    // Buscar valor atual no Firestore
    const docRef = doc(db, "fundamentals", ticker);
    const docSnap = await getDoc(docRef);
    const currentData = docSnap.exists() ? docSnap.data() : {};
    const currentCota = currentData.vp || 0;
    
    // Extrair nova cota
    const newCota = await extractCotaPatrimonial(ticker, url);
    
    if (newCota !== null && !isNaN(newCota)) {
      successCount++;
      
      // Só atualiza se mudou
      if (currentCota !== newCota) {
        await setDoc(docRef, {
          ...currentData,
          vp: newCota,
          updated: today,
          updatedAt: new Date(),
          autoUpdated: true
        }, { merge: true });
        
        console.log(`💾 ${ticker} atualizado: R$ ${currentCota.toFixed(2)} → R$ ${newCota.toFixed(2)}`);
        updateCount++;
      } else {
        console.log(`️  ${ticker} inalterado (R$ ${newCota.toFixed(2)})`);
      }
    } else {
      console.log(`⚠️  ${ticker} mantido (R$ ${currentCota.toFixed(2)})`);
    }
    
    // Pausa para não sobrecarregar
    await new Promise(resolve => setTimeout(resolve, 2000));
  }
  
  console.log("\n" + "=".repeat(60));
  console.log("🏁 Auto-Update Concluído!");
  console.log(`✅ Fundos analisados: ${successCount}/${Object.keys(HOT_PAGES).length}`);
  console.log(`📝 Fundos atualizados: ${updateCount}`);
  console.log("=".repeat(60));
}

// Executar
runAutoUpdate().catch(err => {
  console.error("❌ Erro crítico:", err);
  process.exit(1);
});