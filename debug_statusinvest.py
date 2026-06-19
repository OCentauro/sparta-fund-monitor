import requests
from bs4 import BeautifulSoup

ticker = 'JURO11'
url = f"https://statusinvest.com.br/fundos-imobiliarios/{ticker.lower()}"
headers = {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'}

print(f" Buscando {ticker} no StatusInvest...")
resp = requests.get(url, headers=headers, timeout=15)
print(f"Status HTTP: {resp.status_code}")

soup = BeautifulSoup(resp.text, 'html.parser')

# Busca os blocos de dados (geralmente estão em divs com classe "data" ou "info")
print("\n📊 Procurando elementos com dados financeiros:")

# Tenta encontrar o bloco principal de indicadores
for div in soup.find_all('div', class_='info'):
    label = div.find('span', class_='label')
    value = div.find('span', class_='value')
    if label and value:
        print(f"  {label.text.strip()}: {value.text.strip()}")

# Alternativa: busca por texto específico
print("\n🔎 Buscando por 'P/VP', 'Dividend Yield', 'P/L':")
for element in soup.find_all(string=lambda text: text and any(kw in text for kw in ['P/VP', 'Dividend Yield', 'P/L', 'FFO'])):
    parent = element.parent
    print(f"  Encontrado: {parent.text.strip()[:100]}")