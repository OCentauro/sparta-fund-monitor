#!/usr/bin/env python3
"""
scripts/update_dy.py
Extrai dividend yield (DY) dos fundos Sparta via Power BI oficial.
Fonte: Portal do Cotista Sparta (Power BI público)
Uso: python3 scripts/update_dy.py
"""

import re
import sys
from datetime import date

FUNDOS = ["JURO11", "DIVS11", "CRAA11", "CDII11", "MXRF11"]
POWERBI_URL = "https://app.powerbi.com/view?r=eyJrIjoiNmI1OWFhNjktYmIyYS00OWI4LTgxYTUtYjcxY2MyYWU0N2ZiIiwidCI6IjNmYzE2YWZmLThlMWEtNDE4Yi1hNjVmLTBkOTNmMWE2YTlhMCJ9"
TIMEOUT_MS = 90_000


def extrair_dy_powerbi() -> dict[str, float]:
    """Abre o Power BI oficial da Sparta e extrai DYs dos visuais."""
    from playwright.sync_api import sync_playwright

    resultado: dict[str, float] = {}
    texto_coletado = ""

    with sync_playwright() as p:
        browser = p.chromium.launch(
            headless=True,
            args=["--no-sandbox", "--disable-setuid-sandbox",
                  "--disable-dev-shm-usage", "--disable-accelerated-2d-canvas",
                  "--disable-gpu"],
        )
        context = browser.new_context(
            viewport={"width": 1920, "height": 1080}, locale="pt-BR",
        )
        page = context.new_page()
        page.goto(POWERBI_URL, wait_until="domcontentloaded", timeout=TIMEOUT_MS)
        page.wait_for_selector(".visualContainer, .visual, .textBoxContent", timeout=TIMEOUT_MS)
        page.wait_for_timeout(5_000)

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

        if not texto_coletado.strip():
            texto_coletado = page.inner_text("body")
        browser.close()

    hoje = date.today().isoformat()
    for fundo in FUNDOS:
        dy = _parse_dy(texto_coletado, fundo)
        if dy is not None:
            resultado[fundo] = dy
            print(f"   ✅ {fundo}: DY = {dy:.2f}% (extraído em {hoje})")
        else:
            print(f"   ⚠️ {fundo}: DY não encontrado no Power BI")
    return resultado


def _parse_dy(texto: str, fundo: str) -> float | None:
    fu = fundo.upper()
    tu = texto.upper()
    padroes = [
        rf'{fu}\s*[:=]?\s*(\d+[.,]\d+)\s*%',
        rf'(\d+[.,]\d+)\s*%.*?{fu}',
        rf'{fu}\s*\n+\s*(\d+[.,]\d+)\s*\n+\s*%',
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


if __name__ == "__main__":
    print("🔍 Abrindo Power BI da Sparta...\n")
    dy_dict = extrair_dy_powerbi()
    if not dy_dict:
        print("\n❌ Nenhum DY encontrado. Power BI pode estar lento.")
        sys.exit(0)
    print(f"\n✅ Extração concluída. {len(dy_dict)} fundos lidos.")