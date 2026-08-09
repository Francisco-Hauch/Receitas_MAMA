@echo off
REM O que o Agendador de Tarefas chama de madrugada.
REM
REM Diferente do executar.cmd, este aqui nao mostra nada na tela: guarda tudo
REM num log com a data no nome. Se algo der errado as 3h, o log e a unica
REM testemunha.

setlocal
cd /d "%~dp0"

if not exist "logs" mkdir "logs"

REM %date% muda de formato conforme a regiao do Windows, entao a data do nome
REM do arquivo vem do proprio Python, que e previsivel.
for /f %%d in ('..\.venv\Scripts\python.exe -c "import datetime;print(datetime.date.today().isoformat())"') do set HOJE=%%d

call "%~dp0executar.cmd" --enriquecer >> "logs\%HOJE%.log" 2>&1

echo [%time%] terminou com codigo %errorlevel% >> "logs\%HOJE%.log"
endlocal
