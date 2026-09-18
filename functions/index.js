const { onRequest } = require("firebase-functions/v2/https");
const admin = require("firebase-admin");
const https = require("https");

admin.initializeApp();

// ── Proxy de Preços: busca da Brapi server-side (sem CORS) ──
exports.getPrices = onRequest({ cors: true }, async (req, res) => {
  const token = process.env.BRAPIDEV_TOKEN || "7EpuGco9ML58FkFmZVyBWY";
  const tickers = (req.query.tickers || "JURO11,DIVS11,CRAA11,CDII11,MXRF11").split(",");
  const results = [];

  for (const ticker of tickers) {
    try {
      const data = await new Promise((resolve, reject) => {
        const url = `https://brapi.dev/api/quote/${ticker.trim()}?token=${token}`;
        https.get(url, (res) => {
          let body = "";
          res.on("data", (chunk) => (body += chunk));
          res.on("end", () => {
            try {
              const json = JSON.parse(body);
              if (json.results?.length) {
                resolve(json.results[0]);
              } else {
                reject(new Error(`Sem resultados para ${ticker}`));
              }
            } catch (e) {
              reject(e);
            }
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

// ── Trigger de deploy (autenticado via Firebase) ──
exports.triggerSpartaUpdate = onRequest({ cors: true }, async (req, res) => {
    console.log("🚀 [1] Função acionada com sucesso!");

    // ── Verificar autenticação Firebase ──
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        console.error("❌ Token de autenticação ausente");
        return res.status(401).json({ error: "Token de autenticação ausente" });
    }

    const idToken = authHeader.split("Bearer ")[1];
    try {
        const decodedToken = await admin.auth().verifyIdToken(idToken);
        console.log("✅ Usuário autenticado:", decodedToken.uid, decodedToken.email || "(sem email)");
    } catch (err) {
        console.error("❌ Token inválido:", err.message);
        return res.status(401).json({ error: "Token inválido ou expirado" });
    }

    // ── Lógica existente de acionamento do robô ──
    const pat = process.env.HERMES_PAT || process.env.BRAPIDEV_TOKEN;
    if (!pat) {
        console.error("❌ [2] ERRO CRÍTICO: Token não encontrado nas variáveis de ambiente");
        return res.status(500).json({ error: "Token de configuração ausente" });
    }
    console.log("✅ [3] Token encontrado. Início do token:", pat.substring(0, 15) + "...");

    const data = JSON.stringify({ ref: "main" });
    const workflowFile = "deploy.yml";

    const options = {
        hostname: "api.github.com",
        path: `/repos/OCentauro/sparta-fund-monitor/actions/workflows/${workflowFile}/dispatches`,
        method: "POST",
        headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": `Bearer ${pat}`,
            "Content-Type": "application/json",
            "User-Agent": "Sparta-Fund-Monitor"
        }
    };

    try {
        console.log("📡 [4] Enviando requisição para o GitHub...");
        const githubResponse = await new Promise((resolve, reject) => {
            const reqHttps = https.request(options, (res) => {
                let body = '';
                res.on('data', chunk => body += chunk);
                res.on('end', () => resolve({ statusCode: res.statusCode, body: body }));
            });
            reqHttps.on("error", (err) => {
                console.error("❌ [5] Erro de rede na requisição:", err.message);
                reject(err);
            });
            reqHttps.write(data);
            reqHttps.end();
        });

        console.log("📥 [6] Resposta do GitHub recebida. Status Code:", githubResponse.statusCode);

        if (githubResponse.statusCode === 204) {
            console.log("✅ [7] SUCESSO! Workflow disparado no GitHub.");
            res.status(200).json({ success: true, message: "Robô acionado com sucesso!" });
        } else {
            console.error(`⚠️ [8] GitHub retornou erro ${githubResponse.statusCode}. Detalhes:`, githubResponse.body);
            res.status(500).json({
                error: `GitHub API retornou ${githubResponse.statusCode}`,
                details: githubResponse.body
            });
        }
    } catch (error) {
        console.error("💥 [9] Exceção não tratada capturada:", error.message);
        res.status(500).json({ error: error.message });
    }
});