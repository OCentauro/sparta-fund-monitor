# update_fundamentals.py
import requests
from bs4 import BeautifulSoup
import re
from datetime import datetime

FUNDS = ['JURO11', 'DIVS11', 'CRAA11', 'CDII11']

def extract_from_fundamentus(ticker):
    try:
        url = "https://fundamentus.com.br/fii_resultado.php"
        headers = {'User-Agent': 'Mozilla/5.0'}
        resp = requests.get(url, headers=headers, timeout=10)
        soup = BeautifulSoup(resp.text, 'html.parser')
        
        for row in soup.select('table tr'):
            cells = row.find_all('td')
            if len(cells) >= 10 and cells[0].text.strip() == ticker:
                return {
                    "pvp": float(cells[7].text.replace(',', '.')),
                    "pffo": float(cells[8].text.replace(',', '.')), # P/L como proxy
                    "dy": float(cells[9].text.replace('%', '').replace(',', '.')),
                    "updated": datetime.now().strftime('%Y-%m-%d')
                }
        return None
    except Exception as e:
        print(f"❌ Erro ao buscar {ticker}: {e}")
        return None

def update_html(fundamentals):
    with open('index.html', 'r', encoding='utf-8') as f:
        content = f.read()
    
    import json
    new_data = json.dumps(fundamentals, indent=6, ensure_ascii=False)
    pattern = r'const FUNDAMENTALS = \{[^}]+\};'
    new_content = re.sub(pattern, f'const FUNDAMENTALS = {new_data};', content, flags=re.DOTALL)
    
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("✅ index.html atualizado com sucesso!")

if __name__ == "__main__":
    print("🔍 Extraindo dados do Fundamentus...")
    data = {t: extract_from_fundamentus(t) for t in FUNDS if extract_from_fundamentus(t)}
    if data:
        update_html(data)
    else:
        print("⚠️ Nenhum dado extraído. Verifique conexão ou layout do site.")