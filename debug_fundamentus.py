import requests
from bs4 import BeautifulSoup

url = "https://fundamentus.com.br/fii_resultado.php"
headers = {'User-Agent': 'Mozilla/5.0'}
resp = requests.get(url, headers=headers, timeout=10)
soup = BeautifulSoup(resp.text, 'html.parser')

# Encontra a primeira tabela
table = soup.find('table')

# Imprime o cabeçalho (primeira linha)
header_row = table.find('tr')
headers = [th.text.strip() for th in header_row.find_all('th')]
print("📋 CABEÇALHOS DA TABELA:")
for i, h in enumerate(headers):
    print(f"  Índice {i}: {h}")

print("\n📊 PRIMEIRA LINHA DE DADOS (exemplo JURO11):")
# Encontra a linha do JURO11
for row in table.find_all('tr')[1:]:  # Pula o cabeçalho
    cells = row.find_all('td')
    if len(cells) > 0 and 'JURO11' in cells[0].text:
        for i, cell in enumerate(cells):
            print(f"  Índice {i}: {cell.text.strip()}")
        break