import requests
from bs4 import BeautifulSoup
import json
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
            # A tabela do Fundamentus tem muitas colunas. Vamos buscar pelo ticker na primeira célula
            if len(cells) > 0 and cells[0].text.strip() == ticker:
                # Índices aproximados para a tabela de FIIs do Fundamentus
                # Geralmente: 0=Ticker, 1=Cotação, 2=P/VP, 3=DY, 8=P/L (aproximado)
                # Vamos tentar pegar os valores de forma mais segura
                p_vp_text = cells[2].text.strip().replace(',', '.') if len(cells) > 2 else "0"
                dy_text = cells[3].text.strip().replace('%', '').replace(',', '.') if len(cells) > 3 else "0"
                p_l_text = cells[8].text.strip().replace(',', '.') if len(cells) > 8 else "0" # P/L como proxy de P/FFO
                
                return {
                    "pvp": float(p_vp_text),
                    "pffo": float(p_l_text), 
                    "dy": float(dy_text),
                    "updated": datetime.now().strftime('%Y-%m-%d')
                }
        return None
    except Exception as e:
        print(f"❌ Erro ao buscar {ticker}: {e}")
        return None

def update_html(fundamentals):
    with open('index.html', 'r', encoding='utf-8') as f:
        content = f.read()
    
    new_data = json.dumps(fundamentals, indent=4, ensure_ascii=False)
    
    # Regex corrigido para pegar o bloco inteiro até o };
    pattern = r'const FUNDAMENTALS\s*=\s*\{[\s\S]*?\n\};'
    replacement = f'const FUNDAMENTALS = {new_data};'
    
    new_content = re.sub(pattern, replacement, content)
    
    with open('index.html', 'w', encoding='utf-8') as f:
        f.write(new_content)
    print("✅ index.html atualizado com sucesso!")

if __name__ == "__main__":
    print("🔍 Extraindo dados do Fundamentus...")
    data = {}
    for t in FUNDS:
        print(f"Buscando {t}...")
        res = extract_from_fundamentus(t)
        if res:
            data[t] = res
            print(f"  -> P/VP: {res['pvp']}, P/L: {res['pffo']}, DY: {res['dy']}%")
        else:
            print(f"  -> Não encontrado")
            
    if data:
        update_html(data)
    else:
        print("⚠️ Nenhum dado extraído.")