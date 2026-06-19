import requests
from bs4 import BeautifulSoup

url = "https://fundamentus.com.br/fii_resultado.php"
headers = {'User-Agent': 'Mozilla/5.0'}
resp = requests.get(url, headers=headers, timeout=10)
soup = BeautifulSoup(resp.text, 'html.parser')

table = soup.find('table')
print("📋 Todos os tickers disponíveis no Fundamentus:")
tickers = []
for row in table.find_all('tr')[1:]:
    cells = row.find_all('td')
    if len(cells) > 0:
        ticker = cells[0].text.strip()
        tickers.append(ticker)

# Filtra apenas os que contêm "11" (FIIs)
fii_tickers = [t for t in tickers if '11' in t]
print(f"Total de FIIs na tabela: {len(fii_tickers)}")
print("\nPrimeiros 20:")
for t in fii_tickers[:20]:
    print(f"  - {t}")

# Busca específica pelos nossos fundos
print("\n Buscando nossos fundos:")
for target in ['JURO11', 'DIVS11', 'CRAA11', 'CDII11']:
    found = [t for t in tickers if target in t.upper()]
    if found:
        print(f"  ✅ {target}: encontrado como {found}")
    else:
        print(f"  ❌ {target}: NÃO encontrado")