const { onRequest } = require("firebase-functions/v2/https");
const https = require("https");

exports.triggerSpartaUpdate = onRequest({ cors: true }, async (req, res) => {
    console.log("🚀 [1] Função acionada com sucesso!");

    const pat = process.env.GITHUB_PAT;
    if (!pat) {
        console.error("❌ [2] ERRO CRÍTICO: GITHUB_PAT não foi encontrado no arquivo .env");
        return res.status(500).json({ error: "Token de configuração ausente" });
    }
    console.log("✅ [3] Token encontrado. Início do token:", pat.substring(0, 15) + "...");

    const data = JSON.stringify({
        event_type: "trigger-update"
    });

    const options = {
        hostname: "api.github.com",
        path: "/repos/OCentauro/sparta-fund-monitor/dispatches",
        method: "POST",
        headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": `token ${pat}`,
            "Content-Type": "application/json",
            "User-Agent": "Sparta-Fund-Monitor"
        }
    };

    try {
        console.log("📡 [4] Enviando requisição para o GitHub...");
        
        const githubResponse = await new Promise((resolve, reject) => {
            const reqHttps = https.request(options, resolve);
            reqHttps.on("error", (err) => {
                console.error("❌ [5] Erro de rede na requisição:", err.message);
                reject(err);
            });
            reqHttps.write(data);
            reqHttps.end();
        });

        console.log("📥 [6] Resposta do GitHub recebida. Status Code:", githubResponse.statusCode);

        if (githubResponse.statusCode === 204) {
            console.log("🎉 [7] SUCESSO! Workflow disparado no GitHub.");
            res.status(200).json({ success: true, message: "Robô acionado!" });
        } else {
            let errorBody = '';
            githubResponse.on('data', chunk => errorBody += chunk);
            githubResponse.on('end', () => {
                console.error(`⚠️ [8] GitHub retornou erro ${githubResponse.statusCode}. Detalhes:`, errorBody);
                res.status(500).json({ 
                    error: `GitHub API retornou ${githubResponse.statusCode}`, 
                    details: errorBody 
                });
            });
        }
    } catch (error) {
        console.error("💥 [9] Exceção não tratada capturada:", error.message);
        res.status(500).json({ error: error.message });
    }
});