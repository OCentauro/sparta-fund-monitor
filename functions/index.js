const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const https = require("https");

admin.initializeApp();

// ── Preço de Mercado com Cache Inteligente (15 min TTL) ──
function setCorsHeaders(res) {
  res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

exports.getMarketPrice = onRequest({ cors: true }, async (req, res) => {
  setCorsHeaders(res);

  // Handle preflight
  if (req.method === 'OPTIONS') {
    res.set('Access-Control-Max-Age', '3600');
    return res.status(204).send('');
  }

  const { ticker } = req.query;
  if (!ticker) return res.status(400).json({ error: "Parâmetro 'ticker' obrigatório" });

  const TTL = 15 * 60 * 1000;
  const now = Date.now();

  try {
    const cacheRef = admin.firestore().collection("priceCache").doc(ticker.toUpperCase());
    const cacheDoc = await cacheRef.get();

    if (cacheDoc.exists) {
      const data = cacheDoc.data();
      const age = now - data.timestamp;
      if (age < TTL) {
        console.log(`📦 Cache hit: ${ticker} = R$ ${data.price}`);
        return res.json({ price: data.price, source: "cache" });
      }
      console.log(`🔄 Cache expirado: ${ticker}`);
    }

    const brapiToken = process.env.BRAPIDEV_TOKEN;
    if (!brapiToken) return res.status(500).json({ error: "BRAPIDEV_TOKEN não configurado" });

    const price = await new Promise((resolve, reject) => {
      const url = `https://brapi.dev/api/quote/${ticker.toUpperCase()}?token=${brapiToken}`;
      https.get(url, (res) => {
        let body = "";
        res.on("data", chunk => body += chunk);
        res.on("end", () => {
          try {
            const json = JSON.parse(body);
            json.results?.[0]?.regularMarketPrice
              ? resolve(json.results[0].regularMarketPrice)
              : reject(new Error("Preço não encontrado"));
          } catch (e) { reject(e); }
        });
      }).on("error", reject);
    });

    await cacheRef.set({ price, ticker: ticker.toUpperCase(), timestamp: now });
    console.log(`💰 BrAPI: ${ticker} = R$ ${price}`);
    res.json({ price, source: "brapi" });

  } catch (err) {
    console.error(`❌ getMarketPrice(${ticker}):`, err.message);
    const stale = await admin.firestore().collection("priceCache").doc(ticker.toUpperCase()).get();
    if (stale.exists) {
      return res.json({ price: stale.data().price, source: "cache-expirado", warning: err.message });
    }
    res.status(502).json({ error: err.message });
  }
});

// ── Proxy de Preços (legado) ──
exports.getPrices = onRequest({ cors: true }, async (req, res) => {
  const token = process.env.BRAPIDEV_TOKEN;
  const tickers = (req.query.tickers || "JURO11,DIVS11,CRAA11,CDII11,MXRF11").split(",");
  const results = [];
  for (const ticker of tickers) {
    try {
      const data = await new Promise((resolve, reject) => {
        const url = `https://brapi.dev/api/quote/${ticker.trim()}?token=${token}`;
        https.get(url, (res) => {
          let body = "";
          res.on("data", chunk => body += chunk);
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              json.results?.length ? resolve(json.results[0]) : reject(new Error("Sem resultados"));
            } catch (e) { reject(e); }
          });
        }).on("error", reject);
      });
      results.push({ symbol: data.symbol, regularMarketPrice: data.regularMarketPrice });
    } catch (e) {
      results.push({ symbol: ticker.trim(), regularMarketPrice: null, error: e.message });
    }
  }
  res.json({ results });
});

// ── Trigger de deploy (autenticado) ──
exports.triggerSpartaUpdate = onRequest({ cors: true }, async (req, res) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) return res.status(401).json({ error: "Token ausente" });
    try {
      const decoded = await admin.auth().verifyIdToken(authHeader.split("Bearer ")[1]);
      console.log("✅ Autenticado:", decoded.uid);
    } catch (err) {
      return res.status(401).json({ error: "Token inválido" });
    }
    const pat = process.env.HERMES_PAT || process.env.BRAPIDEV_TOKEN;
    if (!pat) return res.status(500).json({ error: "Token de configuração ausente" });
    const data = JSON.stringify({ ref: "main" });
    const options = {
      hostname: "api.github.com",
      path: "/repos/OCentauro/sparta-fund-monitor/actions/workflows/deploy.yml/dispatches",
      method: "POST",
      headers: { "Accept": "application/vnd.github.v3+json", "Authorization": `Bearer ${pat}`, "Content-Type": "application/json" }
    };
    try {
      const githubResponse = await new Promise((resolve, reject) => {
        const reqHttps = https.request(options, (res) => {
          let body = "";
          res.on("data", chunk => body += chunk);
          res.on("end", () => resolve({ statusCode: res.statusCode, body }));
        });
        reqHttps.on("error", reject);
        reqHttps.write(data);
        reqHttps.end();
      });
      githubResponse.statusCode === 204
        ? res.status(200).json({ success: true })
        : res.status(500).json({ error: `GitHub retornou ${githubResponse.statusCode}` });
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
});