const { onRequest } = require("firebase-functions/v2/https");
const https = require("https");

exports.triggerSpartaUpdate = onRequest({ cors: true }, async (req, res) => {
    console.log("🚀 [1] Função acionada com sucesso!");

    const pat = process.env.GITHUB_PAT || process.env.BRAPIDEV_TOKEN;
    if (!pat) {
        console.error("❌ [2] ERRO CRÍTICO: Token não encontrado nas variáveis de ambiente");
        return res.status(500).json({ error: "Token de configuração ausente" });
    }
    console.log("✅ [3] Token encontrado. Início do token:", pat.substring(0, 15) + "...");

    const data = JSON.stringify({
        ref: "main" // Obrigatório para o novo endpoint
    });

    // ️ ATENÇÃO: Verifique se o nome do arquivo está correto!
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
            console.log(" [7] SUCESSO! Workflow disparado no GitHub.");
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