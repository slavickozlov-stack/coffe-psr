#!/usr/bin/env bash
cd "$(dirname "$0")"

echo "=========================================================="
echo " Запуск ГОСТ-Документ (последняя версия)"
echo " Сайт автоматически откроется по адресу: http://localhost:3000"
echo "=========================================================="

if command -v node >/dev/null 2>&1; then
    if [ ! -d "node_modules" ]; then
        echo "Установка зависимостей Node.js..."
        npm install
    fi
    node server.js
elif command -v python3 >/dev/null 2>&1; then
    if [ ! -d "venv" ]; then
        echo "Создание виртуального окружения Python..."
        python3 -m venv venv
        ./venv/bin/pip install -r requirements.txt
    fi
    ./venv/bin/python app.py
else
    python app.py
fi
