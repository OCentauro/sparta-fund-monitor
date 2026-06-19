import json
import asyncio
from playwright.async_api import async_playwright
from bs4 import BeautifulSoup

FUNDS = ['JURO11', 'DIVS11', 'CRAA11', 'CDII11']

async def extract_fundamentals():
    fundamentals = {}
    
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page()
        
        for ticker in FUNDS:
            print(f"🔍 Extraindo {ticker}...")
            url = f"https://statusinvest.com.br/fundos-imobiliarios/{ticker.lower()}"
            
            try:
                await page.goto(url, wait_until='networkidle', timeout=30000)
                
                # Aguarda os dados carregarem (ajuste o seletor se necessário)
                await page.wait_for_selector('.info', timeout=10000)
                
                html = await page.content()
                soup = BeautifulSoup(html, 'html.parser')
                
                # Extrai os dados (ajuste os seletores conforme o HTML real)
                data = {}
                for div in soup.find_all('div', class_='info'):
                    label = div.find('span', class_='label')
                    value = div.find('span', class_='value')
                    if label and value:
                        label_text = label.text.strip()
                        value_text = value.text.strip().replace(',', '.')
                        
                        if 'P/VP' in label_text:
                            data['pvp'] = float(value_text)
                        elif 'P/L' in label_text:
                            data['pffo'] = float(value_text)
                        elif 'Dividend Yield' in label_text:
                            data['dy'] = float(value_text.replace('%', ''))
                
                data['updated'] = asyncio.get_event_loop().time() # Timestamp
                fundamentals[ticker] = data
                print(f"  ✅ {ticker}: {data}")
                
            except Exception as e:
                print(f"  ❌ Erro ao extrair {ticker}: {e}")
        
        await browser.close()
    
    return fundamentals

async def main():
    print("🚀 Iniciando extração...")
    data = await extract_fundamentals()
    
    with open('fundamentals.json', 'w', encoding='utf-8') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    
    print(" Dados salvos em fundamentals.json")

if __name__ == "__main__":
    asyncio.run(main())
