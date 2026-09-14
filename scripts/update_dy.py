#!/usr/bin/env python3
"""
scripts/update_dy.py
Atualiza dividend yield (DY) dos fundos Sparta via Power BI oficial.

Fonte: Portal do Cotista Sparta (Power BI público)
Funcionamento:
  1. Abre o Power BI com Playwright (Chromium headless)
  2. Aguarda os visuais carregarem
  3. Extrai o DY de cada fundo do texto dos visuais
  4. Atualiza apenas o campo "dy" + "updated" no fundamentals.json

Uso: python3 scripts/update_dy.py [--dry-run]
"""

import json
import re
import sys
import os
from datetime import date

FUNDOS = ["JURO11", "DIVS11", "CRAA11", "CDII11", "MXRF11"]
JSON_PATH = "fundamentals.json"
POWERBI_URL = (
    "https://app.powerbi.com/view?r=eyJrIjoiNmI1OWFhNjktYmIyYS00OWI4LTgxYTUtYjcxY2MyYWU0N2ZiIiwidCI6IjNmYzE2YWZmLThlMWEtNDE4Yi1hNjVmLTBkOTNmMWE2YTlhMCJ9"
)
TIMEOUT_MS = 90_000  # 90 segundos para o Power BI carregar


def extrair_dy_powerbi() -> dict[str, float]:
    """
    Abre o Power BI oficial da Sparta no Playwright,
    aguarda renderização, coleta texto dos visuais e extrai DYs.
    """
    from playwright.sync_api import sync_playwright

    resultado: dict[str, float] = {}
    texto_coletado = ""

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=[
                "--no-sandbox",
                "--disable-setuid-sandbox",
                "--disable-dev-shm-usage",
                "--disable-accelerated-2d-canvas",
                "--disable-gpu",
            ],
        )
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080},
            locale="pt-BR",
        )
        page = context.new_page()

        page.goto(POWERBI_URL, wait_until="domcontentloaded", timeout=TIMEOUT_MS)

        # Aguardar visuais do relatório
        page.wait_for_selector(
            ".visualContainer, .visual, .textBoxContent",
            timeout=TIMEOUT_MS,
        )

        # Tempo extra para renderizar todos os visuais
        page.wait_for_timeout(5_000)

        # Coletar texto de todos os elementos visuais
        for seletor in [".visualContainer", ".visual", ".textBoxContent", "body"]:
            try:
                els = page.query_selector_all(seletor)
                for el in els:
                    try:
                        t = el.inner_text().strip()
                        if t and len(t) > 3:
                            texto_coletado += "\n" + t
                    except Exception:
                        pass
            except Exception:
                continue

        # Fallback: texto completo do body
        if not texto_coletado.strip():
            texto_coletado = page.inner_text("body")

        browser.close()

    # Parsear DY de cada fundo no texto coletado
    for fundo in FUNDOS:
        dy = _parse_dy(texto_coletado, fundo)
        if dy is not None:
            resultado[fundo] = dy
            print(f"   ✅ {fundo}: DY = {dy:.2f}%")
        else:
            print(f"   ⚠️ {fundo}: DY não encontrado no Power BI")

    return resultado


def _parse_dy(texto: str, fundo: str) -> float | None:
    """
    Procura o DY do fundo no texto usando múltiplos padrões.
    O Power BI formata números com vírgula decimal (ex: 11,69).
    """
    fu = fundo.upper()
    tu = texto.upper()

    padroes = [
        # "FUNDO: 11,69%" ou "FUNDO 11,69%"
        rf'{fu}\s*[:=]?\s*(\d+[.,]\d+)\s*%',
        # "11,69% FUNDO" (DY antes do nome)
        rf'(\d+[.,]\d+)\s*%.*?{fu}',
        # "FUNDO\n11,69\n%" (pulado por linha)
        rf'{fu}\s*\n+\s*(\d+[.,]\d+)\s*\n+\s*%',
        # "FUNDO ... 11,69 %"
        rf'{fu}[^%]*?(\d+[.,]\d+)\s*%',
    ]

    for padrao in padroes:
        m = re.search(padrao, tu)
        if m:
            try:
                return float(m.group(1).replace(",", "."))
            except ValueError:
                continue
    return None


def atualizar_fundamentals(dy_dict: dict[str, float], dry_run: bool = False) -> int:
    """
    Atualiza apenas o campo 'dy' + 'updated' no fundamentals.json.
    Retorna o número de fundos alterados.
    """
    if not os.path.exists(JSON_PATH):
        script_dir = os.path.dirname(os.path.abspath(__file__))
        alt = os.path.join(os.path.dirname(script_dir), JSON_PATH)
        if os.path.exists(alt):
            os.chdir(os.path.dirname(alt))
        else:
            print(f"❌ {JSON_PATH} não encontrado")
            sys.exit(1)

    with open(JSON_PATH, encoding="utf-8") as f:
        dados = json.load(f)

    hoje = date.today().isoformat()
    alterados = 0

    for fundo, dy_novo in dy_dict.items():
        if fundo not in dados:
            print(f"   ⚠️ {fundo} não existe no JSON — pulando")
            continue

        dy_antigo = dados[fundo].get("dy")
        if dy_antigo == dy_novo:
            print(f"   ✅ {fundo}: {dy_antigo} (inalterado)")
            continue

        dados[fundo]["dy"] = round(dy_novo, 2)
        dados[fundo]["updated"] = hoje
        alterados += 1
        print(f"   📝 {fundo}: {dy_antigo} → {dy_novo:.2f}")

    if alterados and not dry_run:
        with open(JSON_PATH, "w", encoding="utf-8") as f:
            json.dump(dados, f, indent=2, ensure_ascii=False)
            f.write("\n")
        print(f"\n✅ {alterados} fundo(s) atualizado(s) em {JSON_PATH}")
    elif alterados and dry_run:
        print(f"\n🔍 Dry-run: {alterados} fundo(s) seriam atualizados")
    else:
        print("\n✅ Nenhuma alteração necessária")

    return alterados


if __name__ == "__main__":
    dry_run = "--dry-run" in sys.argv

    print("🔍 Abrindo Power BI da Sparta...")
    print(f"   URL: {POWERBI_URL[:60]}...")
    print(f"   Timeout: {TIMEOUT_MS // 1000}s\n")

    dy_dict = extrair_dy_powerbi()

    if not dy_dict:
        print("\n❌ Nenhum DY encontrado. Mantendo valores anteriores.")
        print("   Isso pode ocorrer se o Power BI estiver lento ou com bloqueio.")
        sys.exit(0)  # Não falha o workflow — apenas alerta

    alterados = atualizar_fundamentals(dy_dict, dry_run)

    if dry_run and alterados:
        print("\n💡 Execute sem --dry-run para aplicar as alterações.")