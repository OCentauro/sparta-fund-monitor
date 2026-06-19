import requests
from bs4 import BeautifulSoup
import re

ticker = 'JURO11'
url = f"https://statusinvest.com.br/fundos-imobiliarios/{ticker.lower()}"
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
    'Accept-Language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
}

print(f"🔍 Buscando {ticker} no StatusInvest...")
resp = requests.get(url, headers=headers, timeout=15)

# Salva o HTML completo para análise
with open('statusinvest_debug.html', 'w', encoding='utf-8') as f:
    f.write(resp.text)
print(f"✅ HTML salvo em: statusinvest_debug.html")

soup = BeautifulSoup(resp.text, 'html.parser')

# Estratégia 1: Busca por IDs que contenham indicadores
print("\n📊 Buscando por IDs com 'pvp', 'dy', 'ffo', 'pl':")
for element in soup.find_all(id=re.compile(r'(pvp|dy|ffo|pl|dividend)', re.I)):
    print(f"  ID: {element.get('id')} | Texto: {element.get_text(strip=True)[:50]}")

# Estratégia 2: Busca por classes que contenham indicadores
print("\n🔎 Buscando por classes com 'indicator', 'data', 'value':")
for element in soup.find_all(class_=re.compile(r'(indicator|data|value|info)', re.I)):
    text = element.get_text(strip=True)
    if len(text) < 100 and any(char.isdigit() for char in text):
        print(f"  Classe: {element.get('class')} | Texto: {text[:80]}")

# Estratégia 3: Busca por texto específico seguido de números
print("\n💰 Buscando padrões 'Texto: Número':")
for element in soup.find_all(string=re.compile(r'(P/VP|Dividend|FFO|P/L|DY)', re.I)):
    parent = element.parent
    next_sibling = parent.find_next_sibling()
    if next_sibling:
        print(f"  Label: {element.strip()} | Value: {next_sibling.get_text(strip=True)[:30]}")

# Estratégia 4: Busca por spans com números que parecem indicadores
print("\n📈 Buscando spans com números decimais (possíveis indicadores):")
count = 0
for span in soup.find_all('span'):
    text = span.get_text(strip=True)
    # Padrão: número com vírgula ou ponto decimal
    if re.match(r'^\d+[,.]\d+$', text) and count < 20:
        parent_text = span.parent.get_text(strip=True)[:50]
        print(f"  Número: {text} | Contexto: {parent_text}")
        count += 1

print(f"\n✅ Debug completo. Abra 'statusinvest_debug.html' no navegador para inspecionar.")