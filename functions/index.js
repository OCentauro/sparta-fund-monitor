const { onRequest } = require("firebase-functions/v2/https");
const https = require("https");

exports.triggerSpartaUpdate = onRequest(async (req, res) => {
    // 1. Configurar CORS para permitir chamadas do seu site
    res.set("Access-Control-Allow-Origin", "*");
    res.set("Access-Control-Allow-Methods", "GET, POST");
    
    if (req.method === "OPTIONS") {
        res.status(204).send("");
        return;
    }

    // 2. Preparar a chamada para a API do GitHub
    const data = JSON.stringify({
        event_type: "trigger-update"
    });

    const options = {
        hostname: "api.github.com",
        path: "/repos/OCentauro/sparta-fund-monitor/dispatches",
        method: "POST",
        headers: {
            "Accept": "application/vnd.github.v3+json",
            "Authorization": `token ${process.env.GITHUB_PAT}`,
            "Content-Type": "application/json",
            "User-Agent": "Sparta-Fund-Monitor"
        }
    };

    try {
        // 3. Executar a chamada
        const githubResponse = await new Promise((resolve, reject) => {
            const req = https.request(options, resolve);
            req.on("error", reject);
            req.write(data);
            req.end();
        });

        // 4. Retornar o resultado para o seu app
        if (githubResponse.statusCode === 204) {
            res.status(200).json({ success: true, message: "Robô acionado!" });
        } else {
            res.status(500).json({ error: `GitHub API error: ${githubResponse.statusCode}` });
        }
    } catch (error) {
        console.error("Erro na Cloud Function:", error);
        res.status(500).json({ error: error.message });
    }
});