# 🛡️ CONTEXTO DO PROJETO: Sparta Fund Monitor

## 1. 🎯 Visão Geral
App web (PWA) para monitoramento de Fundos Imobiliários (FIIs), focado em análise de P/VP, DY e fundamentos em tempo real. O app já se provou útil na prática, evitando compras acima do valor patrimonial.

## 2. 🏗️ Arquitetura Atual (Híbrida e Otimizada - v2.0)
- **Frontend:** HTML5, CSS3, JavaScript (Vanilla), hospedado no GitHub Pages.
- **Dados Estáticos/Fundamentos:** Firebase Firestore (Coleções: `fundamentals`, `config/macro`). Atualizados via automação.
- **Dados Dinâmicos (Preço de Mercado):** API Brapi.dev, consumida **via Cloud Function v2** (`getMarketPrice`) no Google Cloud Run com **cache de 15 minutos no Firestore** (NUNCA direto do frontend para não expor token).
- **Automação (Backend):** GitHub Actions + **Playwright** (Node.js) que faz scraping dos sites oficiais (Sparta, XP) e atualiza o Firestore diariamente.
- **Ponte Segura:** Firebase Cloud Function (`triggerSpartaUpdate`) que recebe o clique do botão no frontend e aciona o GitHub Actions via webhook, mantendo o `GITHUB_PAT` seguro no `.env` do Firebase.

## 3. 📂 Estrutura de Arquivos e Seções
O código foi **refatorado** e desmembrado em arquivos separados:
- `index.html`: Estrutura principal (limpa, sem CSS/JS inline).
- `app.js`: Lógica principal do frontend (carregamento do Firestore, fetch de preços via Cloud Function, renderização de cards).
- `style.css`: Estilos da aplicação (modo escuro/claro, skeletons, responsividade).
- `functions/index.js`: Contém `getMarketPrice` (busca BrAPI com cache) e `triggerSpartaUpdate` (webhook para GitHub Actions).
- `functions/package.json`: Configurado com `"engines": {"node": "20"}`, `firebase-admin` e `firebase-functions`. **NÃO deve conter `"type": "module"`.**
- `firebase.json`: Configurado com `"runtime": "nodejs20"` na seção de functions.
- `scripts/update-fundamentals.mjs`: Script Node.js (Playwright + XLSX) rodado pelo GitHub Actions.
- `.gitignore`: **CRUCIAL:** Deve ignorar `sparta-fund-monitor-*.json` (chaves de serviço) e `.env`.

## 4. ⚠️ Decisões Técnicas e "Gotchas" (Regras de Ouro - CRÍTICO)
1. **Cloud Functions v2 e CORS:** O `{ cors: true }` nativo **falha** em funções v2. É **obrigatório** implementar headers manuais (`Access-Control-Allow-Origin: '*'`) e tratar a requisição `OPTIONS` (preflight) retornando status 204.
2. **Permissões do Cloud Run:** A função `getMarketPrice` deve estar configurada como **"Permitir invocações não autenticadas"** (Allow unauthenticated invocations) no Google Cloud Console, caso contrário, retornará Erro 403 (Forbidden).
3. **Variáveis de Ambiente:** O token da BrAPI **NÃO** pode estar no código. Deve ser injetado como Variável de Ambiente (`BRAPIDEV_TOKEN`) no Google Cloud Console (aba Variáveis e secrets do serviço Cloud Run) e o serviço deve ser **reimplantado** após a alteração.
4. **Git e PowerShell:** O PowerShell do Windows pode adicionar caracteres BOM (`\ufeff`) ao salvar JSON, quebrando o build do Firebase. Usar `node -e` ou o VS Code com encoding UTF-8 sem BOM para editar `package.json`.
5. **Segurança:** NUNCA fazer commit de arquivos `.json` de Service Account do Firebase ou arquivos `.env` com tokens.

## 5. ✅ Conquistas Recentes (Versão 2.0)
- ✅ Implementação de Cloud Function v2 (`getMarketPrice`) com cache inteligente de 15min.
- ✅ Correção definitiva de CORS manual para Cloud Functions v2.
- ✅ Configuração de IAM (acesso público) no Google Cloud Run.
- ✅ Injeção segura de variáveis de ambiente (`BRAPIDEV_TOKEN`).
- ✅ Resolução de conflitos de Node.js e BOM no PowerShell.
- ✅ Automação migrada de Puppeteer para Playwright (mais robusto).
- ✅ Validação prática: o app está fornecendo dados de P/VP em tempo real superiores a plataformas de mercado.

## 6. 🗺️ Road Map Pendente (Próximos Passos)
1. **UX/UI - Tabela Responsiva:** Substituir a visualização atual de "Cards" por uma Tabela Responsiva com dropdown/accordion para exibir detalhes dos fundamentos sem poluir a tela.
2. **Dinamismo Total:** Mover o array hardcoded de tickers (`FUND_LINKS`, `FUNDS_CONFIG`) para uma coleção no Firestore (ex: `config/funds_list`), permitindo adicionar/remover fundos via painel, sem alterar o código-fonte.
3. **Tratamento de Erros de Scraping:** Melhorar o fallback do `update-fundamentals.mjs` para casos em que o site da Sparta/XP muda o layout (já possui regex, mas pode ser reforçado com seletores CSS do Playwright).