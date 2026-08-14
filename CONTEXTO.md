# 🛡️ CONTEXTO DO PROJETO: Sparta Fund Monitor

## 1. Visão Geral
App web (PWA) para monitoramento de Fundos Imobiliários (FIIs), focado em análise de P/VP, DY e fundamentos em tempo real. O app já se provou útil na prática, evitando compras acima do valor patrimonial.

## 2. Arquitetura Atual (Híbrida e Otimizada)
- **Frontend:** HTML5, CSS3, JavaScript (Vanilla), hospedado no GitHub Pages.
- **Dados Estáticos/Fundamentos:** Firebase Firestore (Coleções: `fundamentals`, `config/macro`). Atualizados via automação.
- **Dados Dinâmicos (Preço de Mercado):** API Brapi.dev (`https://brapi.dev/api/quote`), consumida via `fetch` no frontend.
- **Automação (Backend):** GitHub Actions + Puppeteer (Node.js) que faz scraping e atualiza o Firestore.
- **Ponte Segura:** Firebase Cloud Function (`triggerSpartaUpdate`) que recebe o clique do botão no frontend e aciona o GitHub Actions via webhook, mantendo o `GITHUB_PAT` seguro no `.env` do Firebase.

## 3. Estrutura de Arquivos e Seções do `index.html`
O código está atualmente em um único arquivo `index.html`, mas organizado com comentários de seção para facilitar a manutenção:
- `[SEÇÃO 14]` Dados Fundamentais (Fallback)
- `[SEÇÃO 15]` Elementos do DOM
- `[SEÇÃO 16]` Firebase - Carregar Fundamentos
- `[SEÇÃO 16.5]` Carregar Dados Macro do Firestore
- `[SEÇÃO 18]` Autenticação
- *(Outras seções de UI e lógica de fetch de preços seguem este padrão)*

## 4. Conquistas Recentes (Versão 1.2.0)
- ✅ Implementação segura da Cloud Function para acionar o robô (sem expor tokens).
- ✅ Resolução de problemas de CORS e permissões no Google Cloud Run.
- ✅ Limpeza do console (remoção de avisos de depreciação e correção do ícone `icon-192.png`).
- ✅ Validação prática: o app está fornecendo dados de P/VP em tempo real superiores a plataformas de mercado.

## 5. Road Map Pendente (Próximos Passos)
1. **Refatoração:** Desmembrar `index.html` em `index.html`, `style.css` e `app.js`.
2. **UX/UI:** Transformar a visualização de Cards em uma Tabela Responsiva (com dropdown para detalhes).
3. **Dinamismo:** Mover a lista de tickers (JURO11, DIVS11, etc.) do código hardcoded para uma coleção no Firestore, permitindo adicionar novos fundos sem alterar o código.