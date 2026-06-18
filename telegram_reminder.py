# telegram_reminder.py
# Este script envia um lembrete via Telegram para atualizar os fundamentos dos FIIs monitorados.


import requests
from datetime import datetime

# ⚠️ SUBSTITUA pelos seus dados
TELEGRAM_BOT_TOKEN = '8908144574:AAEkO4OLTGUgxSnHZ0VBp-r26-0YJKwPrBg'
CHAT_ID = '200754126'

def send_reminder():
    today = datetime.now()
    
    # Usa HTML em vez de Markdown (mais tolerante)
    message = "<b>📊 Lembrete: Atualizar Fundamentos Sparta</b>\n\n"
    message += "📅 Data: " + today.strftime('%d/%m/%Y') + "\n\n"
    message += "Os informes mensais dos FIIs foram publicados.\n\n"
    message += "<b>Próximos passos:</b>\n"
    message += "1️⃣ Abra o terminal na pasta do projeto\n"
    message += "2️⃣ Execute: <code>python update_fundamentals.py</code>\n"
    message += "3️⃣ Valide os dados extraídos\n"
    message += "4️⃣ Commit e push:\n"
    message += "<pre>git add index.html\n"
    message += "git commit -m \"chore: update fundamentals " + today.strftime('%Y-%m') + "\"\n"
    message += "git push origin main</pre>\n\n"
    message += "📌 <b>Fundos monitorados:</b> JURO11, DIVS11, CRAA11, CDII11\n\n"
    message += "Bom investimento! 🚀"
    
    url = "https://api.telegram.org/bot" + TELEGRAM_BOT_TOKEN + "/sendMessage"
    data = {
        'chat_id': CHAT_ID,
        'text': message,
        'parse_mode': 'HTML'  # Mudou de Markdown para HTML
    }
    
    try:
        response = requests.post(url, json=data, timeout=10)
        response.raise_for_status()
        print("✅ Lembrete enviado com sucesso!")
        return True
    except Exception as e:
        print("❌ Erro ao enviar: " + str(e))
        return False

if __name__ == "__main__":
    send_reminder()