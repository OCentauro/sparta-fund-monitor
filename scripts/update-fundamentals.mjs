async function extractViaRegex(url, ticker) {
  try {
    console.log(`🌐 [${ticker}] Tentando buscar via fetch...`);
    
    const response = await fetch(url, {
      headers: { 
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
      }
    });

    if (!response.ok) {
      console.error(`❌ [${ticker}] Erro HTTP: ${response.status}`);
      return null;
    }

    const html = await response.text();
    console.log(`📄 [${ticker}] HTML recebido: ${html.length} caracteres`);

    // DEBUG: Encontrar todas as ocorrências de "cota" e mostrar o contexto
    const cotaRegex = /cota[\s\S]{0,200}/gi;
    const matches = html.match(cotaRegex);
    
    if (matches && matches.length > 0) {
      console.log(`🔍 [${ticker}] Encontradas ${matches.length} ocorrências de "cota":`);
      matches.slice(0, 5).forEach((match, i) => {
        console.log(`   [${i+1}] "${match.substring(0, 150)}..."`);
      });
    } else {
      console.log(`⚠️ [${ticker}] NENHUMA ocorrência de "cota" encontrada no HTML!`);
    }

    // Regex principal mais flexível
    const regex = /cota\s+patrimonial[\s\S]{0,500}r\$\s*([0-9]{1,3}[.,][0-9]{2})/i;
    const match = html.match(regex);

    if (match && match[1]) {
      const val = parseFloat(match[1].replace(",", "."));
      console.log(`✅ [${ticker}] Regex encontrou: ${val}`);
      return val;
    }

    console.log(`⚠️ [${ticker}] Regex principal NÃO encontrou.`);
    return null;

  } catch (error) {
    console.error(`❌ [${ticker}] Exceção:`, error.message);
    return null;
  }
}