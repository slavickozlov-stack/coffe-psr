@echo off
chcp 65001 >nul
cd /d "%~dp0"

echo ==========================================================
echo  Запуск ГОСТ-Документ (последняя версия)
echo  Сайт автоматически откроется по адресу: http://localhost:3000
echo ==========================================================

where node >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    if not exist "node_modules" (
        echo Установка пакетов Node.js...
        call npm install
    )
    node server.js
    goto :eof
)

where python >nul 2>nul
if %ERRORLEVEL% EQU 0 (
    if not exist "venv" (
        echo Создание виртуального окружения Python...
        python -m venv venv
        call venv\Scripts\pip install -r requirements.txt
    )
    venv\Scripts\python app.py
    goto :eof
)

echo Ошибка: Установите Node.js или Python для локального запуска.
pause
