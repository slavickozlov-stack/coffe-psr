#!/usr/bin/env bash
cd "$(dirname "$0")"

if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
    ./venv/bin/pip install -r requirements.txt
fi

echo "=========================================================="
echo " Запуск ГОСТ-Документ: АРМ нормоконтроля и подготовки НД"
echo " Откройте в браузере: http://127.0.0.1:8000"
echo "=========================================================="

./venv/bin/python app.py
